# T-DESK-01:桌面客户端(Tauri 2,Win/macOS/Linux)【暂缓,勿开工】

> 执行者:Codex。**前置条件全部满足前不要开始本任务:**
> 1. T-WEB-01 验收通过(前端已收敛 API 调用到 `web/lib/api-client.ts`)
> 2. Server 用户系统与按用户登录凭据上线(M4)

## 范围(概要,届时补全细节)

- `desktop/` 目录,Tauri 2 壳,复用 `web/` 前端(同一 React 代码,不复制)
- 登录使用**用户个人凭据**,绝不内置共享 API Key;凭据存 OS keychain(macOS Keychain / Windows Credential Manager / Secret Service)
- 传输层替换:Next 服务端代理 → 直连 Agent Server(HTTPS)
- 系统托盘、任务完成通知
- 三平台构建产物(Windows / macOS / Linux)

## 明确不做

自动更新、移动端、离线模式。

技术选型说明:选 Tauri 2 而非 Electron——体积小一个数量级、用系统 WebView、三平台一份配置;若构建工具链遇到不可解决的阻碍,经确认后可降级 Electron。
