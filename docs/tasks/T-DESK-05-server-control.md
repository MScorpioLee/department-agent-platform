# T-DESK-05:管理端「服务器」启停开关(本机 Agent Server 控制器)

> 执行者:Codex(前端 UI)。**只允许改动 `web/`。** 后端/Rust 已就绪(Claude)。
> 目标:Department Agent(管理端,console 画像)里加一个「服务器」面板——开关启停本机 Agent Server、显示状态。
> 像 Hermes/OpenClaw 那样手动控制,不开机自启。

## 1. Rust 命令契约(已就绪,`invoke`)

```ts
invoke("server_get_config")                    // → {server_dir, port, database_url, models_config_path, secret_key_set}
invoke("server_set_config", { patch: {serverDir?, port?, databaseUrl?, modelsConfigPath?} })  // → 同上(脱敏)
invoke("server_status")                        // → {running, reachable, pid, port, configured}
invoke("server_start")                         // → {running:true, pid, port}  | 错误 {code:"not_configured"|"port_in_use"|"bad_server_dir"}
invoke("server_stop")                          // → {running:false}
```
- 这些**仅桌面端**有(`isDesktopClient()`);secret_key/api_key/token 后端不回显(只回 `secret_key_set:bool`)。
- `running`=本 app 托管的进程在跑;`reachable`=端口能连上(可能是外部已起的 server)。
- 启动会用 `server_dir/.venv/bin/python -m uvicorn`(没有则 `python3`);**首次设置流程**生效(不预置管理员)。

## 2. UI(管理端新增「服务器」入口/面板,仅 console 画像 + 桌面端)

- **状态卡**:大号开关 + 状态徽章
  - 已运行(running 或 reachable)→ 绿「运行中 · 端口 N · PID」+「停止」按钮。
  - 未运行 → 灰「已停止」+「启动」按钮。
  - 轮询 `server_status`(如每 3s)刷新。
- **启动/停止**:点开关 → `server_start` / `server_stop`;loading 态;错误显示后端 message
  (`not_configured` 引导去设置填 server 目录;`port_in_use` 提示端口占用)。
- **设置(折叠区)**:
  - server 目录(必填,选目录用 `@tauri-apps/plugin-dialog` 的 open({directory:true}))
  - 端口(默认 8700)、可选 database_url / models_config_path。
  - secret_key 不显示明文,只显示「已自动生成」(secret_key_set)。
  - 保存 → `server_set_config`。
- 文案点明:**这是把本机当服务器主机;启动后本机/同局域网的客户端都连它**;关掉 app 后 server 仍在跑(进程独立),要停就点「停止」。

## 3. 入口

- 仅 console 画像 + 桌面端可见(coder 画像/Web 端不显示)。放在导航(如「服务器」)或设置页内。
- 首次进入若 `configured=false`,引导先填 server 目录。

## 4. Mock 模式

`MOCK_API=1` 或非桌面端:这些 invoke 不可用——面板显示「仅桌面端可用」或隐藏;
mock 可给个假状态(running:false, configured:false)预览 UI。

## 5. 验收标准

1. 桌面端管理端能看到「服务器」面板;填好 server 目录后「启动」能拉起、状态变运行中、「停止」能停
2. 端口占用/未配置等错误有可读提示
3. Web 端/coder 画像不显示该面板;`pnpm build` 通过;既有测试全绿;仅改 `web/`

## 6. 明确不做

开机自启(有意不做,手动控制)、多 server 实例、远程 server 的启停(只管本机进程)。
