# Department Agent Desktop

Tauri 2 桌面壳复用 `../web` 的静态导出产物。桌面模式下前端通过 Tauri invoke 调用 Rust 命令,由 Rust 侧直连 Agent Server 并注入 keychain 中的用户 token。

## 命令

- `corepack pnpm --dir desktop install`
- `corepack pnpm --dir desktop dev`
- `corepack pnpm --dir desktop build`
- `corepack pnpm --dir desktop check`

## 凭据与配置

- Server 地址默认 `http://127.0.0.1:8700`,可在桌面客户端设置页修改。
- 本地配置文件只保存 Server 地址。
- 登录 token 存入系统 keychain,service 为 `department-agent-desktop`,account 为 `agent-token`。
- 登出会删除 keychain 中的 token。
