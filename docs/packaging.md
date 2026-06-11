# 发布与打包(权威)

> 定义本项目对外发布几个版本、各装什么、谁装、如何升级与兼容。
> 与 [architecture.md](architecture.md) 的客户端形态、[protocol.md](protocol.md) 的协议版本一致。

## 0. 一句话

对外是**两个安装包**:**管理端**(那台 LLM Server 电脑)和**用户端**(每个员工电脑)。
但**客户端 App 只有一套**——管理员与普通用户用同一个程序,区别由登录账号的**角色**(admin/user)决定,
不是两个不同的程序。真正的"两个版本"差别在**「这台机器上装了什么」**,不在 UI 有两份。

## 1. 构件清单(底层积木)

| 构件 | 角色 | 进程/形态 | 数量 |
|---|---|---|---|
| Agent Server(`server/`) | 大脑:鉴权/对话/调度/审计/审批 | FastAPI 服务 | 1(每部门一处) |
| WebUI(`web/`) | 操作端·浏览器版 | 随 Server 部署,Next 服务端代理 | 随 Server |
| Desktop(`desktop/`) | 操作端·桌面版 | Tauri 原生 App,直连 Server | 多 |
| Runner(`runner/`) | 手脚·**执行端** | 装在被控机器上的客户端 | 多 |

> 注意"client"有**两种**:**Runner=执行端**(跑在被控机器、真的执行命令)与
> **Web/Desktop=操作端**(用户用来对话/审批)。两者职责、权限、安装对象都不同,分开发布。

## 2. 两个发布版本(安装包)

### 🖥️ 管理端安装包(装在 LLM Server 电脑)

```
Agent Server + 数据库 + 模型网关 + WebUI    ← 核心后端,Docker Compose 一键起整套
(可选)Runner                              ← 若这台机器也想被调度
(可选)Desktop 客户端                       ← 管理员也可用浏览器 WebUI,以 admin 登录
```

- 部署者:管理员。一个部门一台(或一组高可用)。
- 管理入口:浏览器开 WebUI 或桌面端,以 **admin 账号**登录 → 多出审计、审批管理、用户/机器管理。

### 💻 用户端安装包(装在每个员工电脑,轻量)

```
Runner(单文件可执行)   ← 让本机能被 AI 执行任务(手脚);用本人 enrollment token 自动注册并归属本人
Desktop 客户端          ← 本人对话/看结果/处理自己机器的审批(或直接浏览器开 Server 的 WebUI,免安装)
```

- 装 Runner = 这台机器愿意被调度;不想被调度的纯操作者可只用操作端。
- 装完 Runner 首次用 enrollment token 注册(M4-b:可绑定 owner),凭据存本地 0600 状态文件。

## 3. 客户端 App 只有一套(角色门控)

- Web 与 Desktop 复用**同一套 React 前端**;admin 与 user **不是两个程序**。
- 权限边界在**服务器**:按登录账号的 `role` 返回不同数据与可见功能;前端据 `role` 显示/隐藏管理入口。
- 好处:一套代码、一处鉴权,杜绝"两份 UI 权限判断不一致"导致的越权。
- **不要**做"管理员版 App"和"用户版 App"两个程序。

## 4. 操作端两种形态:WebUI vs Desktop(传输差异)

同一前端,传输层不同(见 [T-DESK-01](tasks/T-DESK-01-desktop-client.md)):

| | WebUI | Desktop(Tauri) |
|---|---|---|
| 传输 | 浏览器 → Next 服务端代理 → Server | 原生 App → **直连** Server REST |
| 凭据 | httpOnly cookie(服务端注入) | token 存 **OS keychain**,前端取出作 Bearer |
| 部署 | 随 Server 发布 | 三平台安装包,独立分发,可滞后于 Server |
| CORS | 无(同源代理) | Tauri Rust 侧 HTTP 绕过,**服务端无需改动** |

## 5. 版本与兼容

### 唯一要保证向后兼容的边界:Server ↔ Runner

原因:**无法同时升级所有员工机上的 Runner**。策略:

- 帧含 `protocol_version`(当前 = 1)。Server **接受旧小版本** Runner;
  仅当**主版本不兼容**时拒绝连接并回提示要求升级 Runner。
- 协议做加法式演进(新增可选字段、新消息类型),不破坏旧 Runner。

### 其他边界

- **WebUI ↔ Server**:WebUI 随 Server 同版本发布,版本锁死,**无兼容问题**。
- **Desktop/第三方 ↔ Server**:会滞后 → 依赖**冻结的 REST 契约**;若未来引入破坏性变更,启用 `/api/v1` 前缀并保留旧版一段时间。

### 版本号与兼容矩阵

- 各构件**独立语义化版本**:`server`、`runner`、`desktop` 各自一条版本线。
- 在本文维护一张 Server↔Runner 兼容矩阵(示例):

| Server | 兼容 Runner 协议 | 备注 |
|---|---|---|
| 0.1.x | protocol_version 1 | MVP |

## 6. 打包技术(开发 vs 生产)

| | 开发/演示 | 生产 |
|---|---|---|
| 形态 | **一份仓库 + `scripts/dev_up.sh` 一键全起**,不分版本 | **分构件发布** |
| Server | uvicorn + SQLite | Docker Compose:Server + PostgreSQL + 模型网关 + WebUI + 反代(Nginx/Caddy) |
| Runner | `uv venv` 跑源码 | **单文件可执行**(先 PyInstaller,正式版可换 Go);员工无需装 Python/uv |
| Desktop | `next build` 静态导出 + `tauri dev` | 三平台安装包(`.msi`/`.dmg`/`.AppImage` 等) |
| WebUI | `next dev` | 随 Server 镜像 |

## 7. 现状与待办

- ✅ 已具备:构件在仓库中物理分离;`protocol_version` 已在帧中;REST 契约冻结;角色门控(server + 前端)已实现;`dev_up.sh` 一键全栈。
- ✅ Server↔Runner 主版本兼容校验(连接时校 `protocol_version`,不兼容 close 4426)。
- ✅ **Alembic 迁移**:开发 `create_all`、生产 `AGENT_AUTO_CREATE_TABLES=false` + `alembic upgrade head`(见 server/README.md)。
- ⬜ 生产前补:Runner 打**单文件可执行**(部署第一痛点,任务卡 T-PKG-01);SQLite → PostgreSQL(切 `AGENT_DATABASE_URL` + 装 asyncpg,见 T-DEPLOY-01);聊天流式输出。
- ⬜ Desktop 安装包:见 [T-DESK-01](tasks/T-DESK-01-desktop-client.md)(可开工)。
