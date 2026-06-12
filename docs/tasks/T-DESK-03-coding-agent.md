# T-DESK-03:桌面编码 Agent(类 Codex/Claude Code 的 GUI 客户端)

> 执行者:Codex(前端 UI)。**只允许改动 `desktop/`(及其复用的 `web/` 前端代码,不动 server/runner)。**
> 后端/Rust 已就绪(Claude 实现):Tauri 已暴露本地工具命令 + 模型中转命令,安全边界(路径锁定)在 Rust 强制。
> 目标:做一个**装机即用的编码 Agent 窗口应用**——选项目目录,在里面对话式编码,流式输出、diff、命令审批。

## 1. Rust 命令契约(已就绪,`@tauri-apps/api` 的 `invoke` 调用)

```ts
// 工作区(目录选择用 @tauri-apps/plugin-dialog 的 open({directory:true}) 拿路径,再 set)
invoke("agent_set_workspace", { path })        // → string(规范化后的目录),非目录/无效报错
invoke("agent_get_workspace")                  // → string | null
// 本地工具(全部锁定在工作区内;越界 → {code:"path_denied"})
invoke("agent_list_files", { path })           // path 相对工作区,"" = 根 → string[](目录带尾 /)
invoke("agent_read_file", { path })            // → string(已截断到 30KB)
invoke("agent_write_file", { path, content })  // → number(写入字节)
invoke("agent_run_command", { command })       // → {exit_code, stdout, stderr}(在工作区 cwd 执行)
// 模型:经平台 /v1 中转(token 在 Rust 钥匙串,前端不碰)
invoke("agent_model_chat", { messages, tools }) // → OpenAI chat/completions 响应 JSON
```

错误对象形如 `{status, code, message}`(沿用桌面既有 DesktopError)。未登录时 model_chat 返回 401;
未选目录时工具返回 `{code:"no_workspace"}`。

## 2. Agent Loop(在前端 TS 实现,不要在 Rust 里)

工具 schema(传给 `agent_model_chat` 的 `tools`,OpenAI function 格式):
`run_command{command}`、`read_file{path}`、`write_file{path,content}`、`list_files{path?}`。

循环:`agent_model_chat(messages, tools)` → 若有 `tool_calls`:
- `run_command` **先弹审批**(显示命令,允许/拒绝;拒绝则回 `{error:"用户拒绝"}` 给模型);允许 → `invoke("agent_run_command",...)`。
- 文件类工具直接 invoke(写文件可在 UI 展示 diff/确认,但非强制)。
- 把工具结果作为 `role:"tool"` 追加,继续循环;无 tool_calls 即本轮结束。最多 ~12 步防失控。

## 3. 界面(对标 Codex 桌面 / Claude Code)

- **顶部**:当前项目目录 + 「打开项目」(目录选择器)+ 服务器/登录状态(复用现有 desktop 登录)。
- **左侧**:文件树(`agent_list_files` 懒加载);点文件可只读预览(`agent_read_file`)。
- **中间**:对话区——用户输入 + 助手流式文字 + 工具调用卡(命令/文件名 + 结果折叠)+ **写文件的 diff 视图**。
- **命令审批**:`run_command` 前内联弹「允许执行?允许/拒绝」(可勾「本会话自动允许」)。
- **底部**:输入框 + 发送;Esc 中止本轮。
- 空态(未选目录):引导「打开一个项目目录开始」。

## 4. 路由/模式

桌面已复用 `web/` 前端。新增一个 `/desktop-agent`(或桌面专属入口)承载本页;
仅桌面端(`isDesktopClient()`)可见,Web 端不显示(它没有这些 invoke 命令)。

## 5. 验收标准

1. 选目录后能对话让模型在该目录内创建/修改文件并运行命令(如"建个 hello.py 并运行")
2. `run_command` 有审批弹窗;拒绝则不执行
3. 越界路径(`../`、绝对路径)被 Rust 挡(展示 path_denied,不崩)
4. 写文件有 diff 展示;文件树能浏览
5. `pnpm build`(desktop 前端)通过;既有桌面功能(登录/控制台)不回归;只改 `desktop/`(含其引用的 web 前端)

## 6. 明确不做

多项目标签页、Git 集成视图、IDE 插件、`/v1` 流式(后端暂不支持 stream,用整段返回)。
