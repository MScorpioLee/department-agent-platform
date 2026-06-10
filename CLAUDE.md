# Department Agent Platform — 开发约定

## 项目结构
- `server/` — Agent Server(Python 3.11+,FastAPI,SQLAlchemy;开发期 SQLite,生产 PostgreSQL)
- `runner/` — Runner 客户端(Python,websockets + httpx)
- `web/` — WebUI(Next.js + Tailwind + shadcn/ui),由 Codex 按任务卡实现
- `desktop/`(规划中,M7)— Tauri 2 桌面壳,复用 web/ 前端,Codex 实现,依赖 M4 用户系统
- `docs/` — **protocol.md 与 security.md 是协议/安全的唯一权威来源**,README 仅为概览
- `docs/tasks/` — 给 Codex(GPT-5.5)的任务卡;Codex 只允许改动任务卡中指定的目录

## 分工
- Claude:协议/安全设计、server、runner、review Codex 产出
- Codex:WebUI 及任务卡指定的独立模块,**不得改动 server/、runner/、docs/**

## 不可破坏的安全不变量
1. 路径校验必须先 `os.path.realpath()` 规范化,再比对 allowed_roots / blocked_paths(顺序见 docs/security.md §2)
2. allowed_roots / blocked_paths 只来自 Runner 本地配置,拒绝服务器远程修改
3. runner_token 服务器只存哈希;enrollment token 限次限期
4. 任务幂等:Runner 对重复 task_id 绝不重复执行
5. 命令黑名单只是审计/审批触发层,代码注释和文档不得将其描述为安全边界

## 开发环境
- Python 用 `uv` 管理(`uv venv` / `uv pip install`);测试用 pytest
- README.md 是 CRLF 行尾 + 全角标点,编辑时注意
- 文档、提交信息用中文
