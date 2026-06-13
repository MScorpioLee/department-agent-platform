# T-DESK-04:聚焦编码客户端 UI(独立用户端 App「Agent Coder」)

> 执行者:Codex(前端 UI)。**只允许改动 `web/`(及构建配置)。** 不动 server/runner/Rust。
> 已就绪:Rust 本地工具命令(T-DESK-03)、Agent Loop(`web/lib/desktop-agent.ts`)、
> 构建变体(`desktop` 的 `build:coder:mac` + `tauri.coder.conf.json`,品牌 = "Agent Coder")、
> profile 标志 `isCoderProfile()`(`web/lib/client-target.ts`,构建期 `NEXT_PUBLIC_CLIENT_PROFILE=coder`)。

目标:做一个**聚焦的编码 Agent 客户端**(形态参考 Codex / OpenClaw / Hermes 那类编码工作台:
左会话栏 + 中对话 + 右代码/diff)。这是**面向员工的独立用户端 App**,不带任何管理/开发者菜单。
> 只对齐**功能与布局形态**(三栏是编码 agent 通用模式),不要逐像素复制任何特定产品外观。

## 1. profile 门控(coder 画像 = 纯编码工具)

- `isCoderProfile()` 为真时(独立用户端构建):
  - **绕过现有 AppShell 的多栏导航**;整个应用就是编码工作台(类似 `/desktop-agent` 但做成三栏完整版)。
  - 登录后直接进编码工作台;不显示 机器/控制台/技能/审批/模型/连接器/审计/用户 等任何菜单。
  - 仍需登录(连服务器),登录页复用现有;登录态走桌面 keychain(已现成)。
- `isCoderProfile()` 为假(默认 console 画像):现有 AppShell 完全不变(管理端那套照旧)。

## 2. 三栏布局(编码工作台)

> 复用 `web/lib/desktop-agent.ts`(Agent Loop + 工具命令)与 `@tauri-apps/plugin-dialog` 选目录。

- **左栏 · 会话 / 项目**:
  - 「打开项目」(目录选择器)→ `setAgentWorkspace`;显示当前项目路径。
  - 会话列表(多轮对话,前端本地维护即可:localStorage 存会话标题+消息);「新对话」。
- **中栏 · 对话**:
  - 用户输入 + 助手回复(整段,后端暂无 stream);
  - **工具调用卡**:`run_command`(命令 + 内联审批 允许/拒绝 + 结果折叠)、文件类工具(读/写/列)显示路径与结果;
  - **写文件出 diff 卡**(before/after);可点开。
- **右栏 · 代码 / diff 视图**:
  - 文件树(`listAgentFiles` 懒加载)+ 点文件只读预览(`readAgentFile`);
  - 选中某次 `write_file` 改动时,右栏展示该文件 diff。
- 底部输入框;Esc 中止本轮(`shouldStop`)。
- 空态:「打开一个项目目录开始」。

## 3. 验收标准

1. `NEXT_PUBLIC_CLIENT_PROFILE=coder` 构建/运行时,应用是纯编码工作台,无任何管理菜单;
   默认构建(无该标志)管理端 AppShell 不回归。
2. 选目录 → 让模型在该目录建/改文件、跑命令(命令有审批);文件树/预览/diff 可用。
3. 多会话可切换(本地持久化即可);越界路径由 Rust 挡(展示错误不崩)。
4. `pnpm build` 通过;`MOCK_API=1` 下 web 端正常(coder 画像在 web 端可不暴露,或给降级提示);
   既有 vitest 全绿;仅改 `web/`。

## 4. 明确不做

语法高亮编辑器(只读预览即可)、Git 集成、多窗口、`/v1` 流式、IDE 插件。
品牌/打包(productName "Agent Coder"、图标、identifier)已在 desktop 构建变体里,无需在 UI 处理。
