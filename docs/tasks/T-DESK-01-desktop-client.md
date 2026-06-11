# T-DESK-01:桌面客户端(Tauri 2,Win/macOS/Linux)

> 执行者:Codex。前置已满足:T-WEB-02(登录)完成、M4 用户系统就绪。
> **允许改动 `desktop/`,并可在 `web/` 内新增「桌面传输层」相关的最小改动**(见 §3);
> 不得改动 `server/`、`runner/`、`docs/`。

## 1. 目标

把现有 Web 前端打包成跨平台桌面客户端:复用 `web/` 的 React 界面,登录用**用户个人凭据**(不内置共享 key),
凭据存 **OS keychain**,增加系统托盘与任务完成通知。

## 2. 架构决定(已定,务必照此)

Web 版依赖 **Next.js 服务端 Route Handlers**(`/api/auth/*` 设 httpOnly cookie、`/api/proxy` 注入 token)。
Tauri 包里**没有 Next 服务端**,因此桌面版采用「原生直连」方案,而不是把 Next 服务塞进去:

- 前端在**桌面模式**下不走 `/api/proxy`,而是**直接请求 Agent Server**。
- 用 **Tauri 的 HTTP 能力(Rust 侧 `tauri-plugin-http`)发请求**,绕开浏览器 CORS,
  因此**服务端无需任何改动**(关键:不要为此改 server/)。
- token 登录后存 **OS keychain**(`tauri-plugin-keyring` 或等价),每次请求由前端从 keychain 取出,
  作为 `Authorization: Bearer <token>` 注入。**不使用 httpOnly cookie**(桌面无浏览器 cookie 语义,keychain 更合适)。
- Agent Server 地址由用户在设置里填写(默认 `http://127.0.0.1:8700`),存本地配置。

## 3. 前端改动(`web/`,最小化)

当前 `web/lib/api-client.ts` 已把调用收敛到一处。新增一层**传输适配**:

- 引入运行模式开关(如 `NEXT_PUBLIC_CLIENT_TARGET=web|desktop` 或运行时检测 `window.__TAURI__`)。
- `web` 模式:维持现状(走 `/api/proxy`、`/api/auth/*`,httpOnly cookie),**完全不变**。
- `desktop` 模式:
  - 数据请求:`baseUrl = <用户配置的 Server>`,用 Tauri HTTP 发,`Authorization` 从 keychain 取。
  - 登录:直接 `POST {server}/api/auth/login`,成功后把返回的 `token` 写入 keychain;`/api/auth/me` 同理直连。
  - 登出:删除 keychain 中的 token。
- 桌面构建产物:`next build && next export`(静态导出)或等价方式产出纯静态前端供 Tauri 加载;
  Route Handlers 在桌面包中不参与。

> 约束:web 模式行为与现有测试**必须保持不变**;桌面适配只在 desktop 分支生效。

## 4. desktop/(Tauri 2)

- `desktop/` 下初始化 Tauri 2 项目,`distDir` 指向 web 的静态导出产物(构建脚本串起来)。
- 集成:`tauri-plugin-http`(直连请求)、keychain 插件(凭据)、系统托盘、原生通知(任务/审批完成时)。
- 三平台构建配置(Windows `.msi`/`.exe`、macOS `.dmg`/`.app`、Linux `.AppImage`/`.deb`)。
- 设置界面:填写/修改 Agent Server 地址、登出。

## 5. 验收标准

1. 桌面 App 启动 → 输入 Server 地址 → 用真实账号登录 → token 存入 OS keychain(可在系统钥匙串中看到条目)
2. 登录后能用机器列表 / 控制台 / 对话 / 审批等页面,数据来自真实 Server(直连,非 Next 代理)
3. token **不**出现在任何明文文件 / localStorage;退出登录清除 keychain 条目
4. 系统托盘存在;任务或审批完成有原生通知
5. `web` 模式回归不受影响:`web/` 既有 `pnpm test` / `pnpm build` 仍全绿
6. 至少在当前开发机平台(macOS)产出可运行安装包;另两平台构建配置就绪(CI 可出包即可)
7. 未改动 `server/`、`runner/`、`docs/`

## 6. 明确不做

自动更新、深链/协议注册、多账号切换、移动端。

## 7. 技术选型说明

选 Tauri 2 而非 Electron:体积小一个数量级、用系统 WebView、Rust 侧 HTTP 天然绕 CORS。
若 keychain 或 HTTP 插件在某平台遇到不可解决的阻碍,记录在 PR 中并经确认后再决定降级方案,不要擅自改服务端。
