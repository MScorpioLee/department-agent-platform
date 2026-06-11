# Runner 通信协议 v1(权威定义)

> 本文件是协议的唯一权威来源。README 中的协议示例如与本文冲突,以本文为准。
> 所有 JSON 帧均包含 `protocol_version: 1`(示例中省略)。

## 0. 传输层

- Runner ↔ Server:WebSocket(生产环境必须 WSS)。
- 消息格式:UTF-8 JSON,一帧一条消息。
- 单帧上限 256 KiB;超过的数据(如命令输出)必须分块通过 `task_output` 传输。

## 1. 注册与认证

### 1.1 首次注册(enroll,一次性)

Runner 首次启动时通过 HTTPS 注册,携带管理员发放的 **enrollment token**:

```http
POST /api/runners/enroll
Authorization: Bearer <enrollment_token>
```

```json
{
  "machine_name": "alice-laptop",
  "os": "darwin",
  "arch": "arm64",
  "runner_version": "0.1.0"
}
```

成功响应(runner_token 仅此一次下发,服务器只存哈希):

```json
{
  "machine_id": "m_01HXXX",
  "runner_token": "rt_xxxxxxxxxxxxxxxx"
}
```

Runner 将 `machine_id` + `runner_token` 写入本地状态文件(`runner_state.json`,权限 0600)。
enrollment token 可设使用次数与有效期;runner_token 可由管理员吊销。

enrollment token 可**绑定 owner**:管理员用 `POST /api/enrollment-tokens {owner_user_id, max_uses, expires_in_days}`
签发,用此 token 注册的机器自动归属该用户;不绑定(或用静态兜底 token)则注册为**无主**,需管理员
`POST /api/machines/{id}/assign` 分配。机器归属决定谁能操作该机器(见 security.md)。

### 1.2 WebSocket 连接

```text
GET /ws/runner
Authorization: Bearer <runner_token>
```

认证失败直接关闭连接(code 4401)。连接成功后 Runner 发送第一帧:

```json
{
  "type": "hello",
  "machine_id": "m_01HXXX",
  "runner_version": "0.1.0",
  "capabilities": ["remote_exec", "remote_read_file", "remote_write_file", "remote_patch_file", "remote_list_files"],
  "allowed_roots": ["/Users/alice/projects"]
}
```

Server 回复:

```json
{ "type": "hello_ack", "machine_id": "m_01HXXX", "server_time": "2026-06-10T12:00:00Z" }
```

**协议版本校验**:hello 的 `protocol_version` 大版本若不在服务端支持集合内,Server 以 close code
`4426` 关闭连接并在 reason 中说明,Runner 据此日志提示"请升级 Runner"。服务端对旧版应尽量向后兼容
(无法同时升级所有 Runner),仅在大版本不兼容时拒绝(见 security.md / packaging.md)。

> 注意:capabilities / allowed_roots 由 Runner 上报仅作展示与工具列表裁剪;
> **安全检查始终在 Runner 本地基于本地配置执行**,不信任服务器下发的路径约束。

## 2. 心跳与在线状态

- Runner 每 10 秒发送一次心跳;Server 超过 30 秒未收到则标记 `offline`,
  并将该机器上所有非终态任务标记为 `lost`。

```json
{ "type": "heartbeat", "machine_id": "m_01HXXX", "status": "idle", "running_task_ids": [] }
```

## 3. 任务生命周期

### 3.1 状态机(Server 侧权威)

```text
queued → dispatched → running → completed | failed | timeout | cancelled
                    ↘ (连接断开/心跳丢失) lost
```

- 终态:completed / failed / timeout / cancelled / lost。
- `lost` 任务**不自动重试**(remote_exec 非幂等);由用户或上层逻辑决定是否重发。

### 3.2 下发任务(Server → Runner)

```json
{
  "type": "task",
  "task_id": "t_01HYYY",
  "tool": "remote_exec",
  "payload": {
    "workdir": "/Users/alice/projects/app",
    "command": "npm test",
    "timeout_seconds": 120
  }
}
```

### 3.3 确认与幂等(Runner → Server)

```json
{ "type": "task_accepted", "task_id": "t_01HYYY" }
```

幂等规则:Runner 维护最近 N=200 条任务的结果缓存。
收到重复 `task_id`:已完成 → 直接重发缓存的 `task_result`;执行中 → 忽略。**绝不重复执行。**

### 3.4 流式输出(Runner → Server,长任务必需)

```json
{ "type": "task_output", "task_id": "t_01HYYY", "stream": "stdout", "seq": 3, "data": "..." }
```

- `seq` 单调递增,用于排序与去重。
- 每个 stream 累计上限 1 MiB,超出后 Runner 停止发送增量并在结果中置 `truncated: true`。

### 3.5 结果回传(Runner → Server)

```json
{
  "type": "task_result",
  "task_id": "t_01HYYY",
  "status": "completed",
  "result": {
    "exit_code": 1,
    "stdout_tail": "...(末尾 8 KiB)",
    "stderr_tail": "",
    "truncated": false,
    "duration_ms": 5321
  }
}
```

`status=failed` 时 `result` 含 `error_code` / `error_message`(如 `path_denied`、`tool_not_supported`、`payload_invalid`)。

### 3.6 取消(Server → Runner)

```json
{ "type": "task_cancel", "task_id": "t_01HYYY" }
```

Runner 终止进程(先 SIGTERM,5 秒后 SIGKILL),回 `task_result` 且 `status: "cancelled"`。

## 4. 工具 payload 定义(M1–M2)

| tool | payload | result |
|---|---|---|
| `remote_exec` | `workdir`, `command`, `timeout_seconds` (默认 60,上限 600) | `exit_code`, `stdout_tail`, `stderr_tail`, `truncated`, `duration_ms` |
| `remote_read_file` | `path`, `offset`(行,1 起), `limit`(行,默认 500) | `content`, `total_lines`, `sha256` |
| `remote_write_file` | `path`, `content` | `bytes_written`, `sha256_before`(新文件为 null), `sha256_after` |
| `remote_patch_file` | `path`, `old_string`, `new_string`, `replace_all`(默认 false) | `changed`, `replacements`, `diff`(unified), `sha256_before`, `sha256_after` |
| `remote_list_files` | `path`, `max_entries`(默认 500) | `entries: [{name, type, size}]` |

所有涉路径工具:Runner 必须先 **realpath 规范化**再做 allowed_roots / blocked_paths 校验(见 security.md)。
读取上限 2 MiB/文件;二进制文件拒绝读取(`error_code: binary_file`)。

## 5. REST API 契约(WebUI / 管理用,已冻结 v1)

认证(M4 起为**双通道**,二选一):
- `Authorization: Bearer <auth_token>` —— 用户登录态,按机器归属受限(普通用户只能访问自己名下机器)。
- `X-API-Key: <key>` —— 管理/服务通道,等同管理员,可见全部(向后兼容 WebUI MVP)。

```text
POST /api/auth/login    {username, password}     → {token, user:{id,username,role}}
GET  /api/auth/me                                → {id, username, display_name, role}
POST /api/users         {username,password,role} → 创建用户(admin)
POST /api/enrollment-tokens {owner_user_id?,max_uses,expires_in_days} → {enrollment_token}  (admin)
POST /api/machines/{id}/assign {user_id}         → 重新分配机器归属(admin)

GET  /api/audit/usage?user_id=                    → token 用量按 user/backend 聚合(admin)
GET  /api/audit/sessions?user_id=&limit=          → 会话列表含消息数(admin)
GET  /api/audit/tool-calls?session_id=&machine_id= → 工具调用审计,脱敏(admin)
GET  /api/audit/commands?machine_id=&limit=       → remote_exec 命令与输出,脱敏(admin)

POST /api/tasks  命中高风险 → {status:"needs_approval", approval_id, risk_rule}(不下发)
GET  /api/approvals?status=pending                → 我可裁决的审批(自己名下机器/admin)
POST /api/approvals/{id}/approve                  → 批准并下发,返回 {task_id}(仅机器所有者/admin)
POST /api/approvals/{id}/reject                   → 拒绝(仅机器所有者/admin)

POST /api/machines/{id}/grants {grantee_user_id,expires_in_hours} → 临时授权他人(仅所有者/admin)
GET  /api/machines/{id}/grants                    → 有效授权列表
DELETE /api/grants/{grant_id}                     → 撤销授权

GET  /api/machines                      → [{machine_id, machine_name, owner_user_id, os, status, last_seen_at, capabilities}]
POST /api/tasks                         body: {machine_id, tool, payload}
                                        → {task_id, status}   (status 为当前状态,通常是 dispatched)
GET  /api/tasks/{task_id}               → {task_id, machine_id, tool, payload, status, result, created_at, finished_at}
GET  /api/tasks/{task_id}/output        → {stdout, stderr, truncated}   (按 seq 聚合)
GET  /api/tasks?machine_id=&limit=50    → 任务列表(倒序)
```

错误响应统一:`{"error": {"code": "...", "message": "..."}}`,HTTP 状态码语义化(401/403/404/409/422)。

计划中(M3–M4,未冻结):`/api/sessions`、`/api/sessions/{id}/messages`、`GET /ws/client`(浏览器实时通道:任务状态变更、流式输出、模型流式回复)。
