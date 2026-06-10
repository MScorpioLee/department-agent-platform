# T-WEB-04:对话界面(模型驱动)

> 执行者:Codex。前置:T-WEB-02(登录)。**只允许改动 `web/`。**
> 后端 M3 已就绪;本卡是「发一句话让模型自己调工具干活」的聊天 UI。

## 1. 目标

在控制台之外提供**对话式**入口:用户选一台机器开会话,发自然语言,模型自动调用远程工具完成任务,
界面按时间线展示用户消息、模型回复、工具调用与结果。

## 2. 后端 API 契约(已冻结)

```text
POST /api/sessions                 {machine_id, title?}  → {session_id, machine_id, status}
POST /api/sessions/{id}/messages   {content}             → {reply, steps, stopped}
GET  /api/sessions/{id}/messages                          → [{seq, role, content, tool_calls, tool_call_id, created_at}]
```

- 角色:`user` / `assistant`(可能带 `tool_calls`)/ `tool`(`content` 是工具结果 JSON,`tool_call_id` 对应调用)。
- **本期非流式**:`POST .../messages` 同步返回整轮结果(可能耗时数秒到数十秒,需 loading 态与合理超时,建议 120s)。
- 模型后端由后端按登录用户自动路由,**前端无需选模型**。
- 若返回 `stopped:"max_steps"` 或某 tool 结果含 `needs_approval`,如实展示(见下)。

## 3. 页面与交互

`/chat`:
- 左:会话列表(可由本地维护或后续接 `/api/sessions` 列表端点;MVP 可只保留当前会话)。
- 新建会话:选一台**在线**机器(复用 `/api/machines`)+ 可选标题 → `POST /api/sessions`。
- 消息区按 `seq` 渲染:
  - `user`:右对齐气泡。
  - `assistant` 含 `tool_calls`:展示"调用了 remote_exec(...)"卡片(工具名 + 参数)。
  - `tool`:折叠展示结果 JSON;若解析出 `needs_approval:true`,高亮提示"该操作需审批",带 `approval_id`,
    并提供跳转到审批页(T-WEB-05)的链接。
  - `assistant` 纯文本:左对齐气泡,即最终回复。
- 发送框:回车发送;发送中禁用并显示"模型执行中…";完成后追加新消息(可重新拉 `GET messages` 全量渲染)。

## 4. Mock 模式

`MOCK_API=1`:`POST messages` 返回一条假 reply,并在历史里塞入 user→assistant(tool_call)→tool→assistant 四条假消息,
其中一条 tool 结果演示 `needs_approval`。

## 5. 验收标准

1. 能选在线机器建会话、发消息、看到模型最终回复
2. 工具调用与结果按时间线正确展示;`needs_approval` 有醒目提示与审批入口
3. 发送中有 loading 态,长任务不超时误报(≥120s)
4. `pnpm build` 通过;`MOCK_API=1` 全流程可走通
5. 仅改动 `web/`

## 6. 明确不做

流式输出(后端暂同步,后续加 `/ws/client` 再做)、多会话持久化侧栏的全功能、重命名/删除会话。
