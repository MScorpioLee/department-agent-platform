# T-WEB-01:WebUI 控制台 MVP(机器列表 + 任务下发 + 输出查看)

> 执行者:Codex。本任务卡自包含,按此实现即可,不需要读仓库其他代码。
> **只允许改动 `web/` 目录。** 不得改动 server/、runner/、docs/。
> 如发现本卡与实际 API 不一致,在 PR 描述中列出问题,不要自行更改契约。

## 1. 目标

为内部 AI Agent 平台做一个运维/调试用 Web 控制台:查看 Runner 机器在线状态、向指定机器下发工具任务、查看执行输出。这是平台 WebUI 的第一块,聊天界面在后续任务卡中。

## 2. 技术栈(固定,不要替换)

- Next.js 14+(App Router)+ TypeScript
- Tailwind CSS + shadcn/ui
- 不引入额外状态管理库(用 React 内置即可);轮询用 SWR 或自写 hook 均可
- **所有 API 调用收敛到单一模块 `web/lib/api-client.ts`**,页面/组件不得散落 fetch——后续桌面客户端(Tauri,T-DESK-01)会复用本前端,仅替换该传输层(代理 → 直连)

## 3. 后端 API 契约(已冻结,不得自行增改字段)

Base URL 由环境变量提供。认证:每个请求带 `X-API-Key` 头。
**API Key 不得暴露到浏览器**:所有请求经 Next.js Route Handler 服务端代理转发(`web/app/api/proxy/[...path]/route.ts`),代理从服务端环境变量 `AGENT_API_KEY` 注入头,浏览器只调代理。

```text
GET  /api/machines
  → 200 [{"machine_id":"m_01H...","machine_name":"alice-laptop","os":"darwin",
          "status":"online|offline","last_seen_at":"2026-06-10T12:00:00Z",
          "capabilities":["remote_exec","remote_read_file","remote_write_file","remote_patch_file","remote_list_files"]}]

POST /api/tasks
  body: {"machine_id":"m_01H...","tool":"remote_exec","payload":{...}}
  → 200 {"task_id":"t_01H...","status":"queued"}

GET  /api/tasks/{task_id}
  → 200 {"task_id":"...","machine_id":"...","tool":"...","payload":{...},
         "status":"queued|dispatched|running|completed|failed|timeout|cancelled|lost",
         "result":{...}|null,"created_at":"...","finished_at":"...|null"}

GET  /api/tasks/{task_id}/output
  → 200 {"stdout":"...","stderr":"...","truncated":false}

GET  /api/tasks?machine_id=m_01H...&limit=50
  → 200 [任务对象数组,创建时间倒序]
```

错误统一为 `{"error":{"code":"...","message":"..."}}`,状态码 401/403/404/409/422。

各工具的 payload 字段:

| tool | payload 字段 |
|---|---|
| remote_exec | workdir(string), command(string), timeout_seconds(number,默认60) |
| remote_read_file | path, offset(行,可选), limit(行,可选) |
| remote_write_file | path, content |
| remote_patch_file | path, old_string, new_string, replace_all(boolean,默认false) |
| remote_list_files | path, max_entries(可选) |

## 4. Mock 模式(必须实现,先于真实后端开发)

环境变量 `MOCK_API=1` 时,代理层不转发而是返回内置 fixture:2 台机器(1 在线 1 离线)、可下发任务(返回假 task_id,3 秒后状态变 completed,exit_code 0,stdout 为固定文本)。真实后端就绪后去掉 `MOCK_API` 即切换,前端代码零改动。

## 5. 页面

### 5.1 `/machines` 机器列表
- 表格:机器名、OS、状态徽章(在线绿/离线灰)、最后心跳时间(相对时间)、capabilities 标签
- 5 秒轮询刷新;每行有"去下发任务"跳转到 `/console?machine_id=...`

### 5.2 `/console` 任务控制台
- 顶部:机器下拉(仅在线机器)、工具下拉(上表 5 种)
- 中部:按所选工具动态渲染 payload 表单(字段见上表;remote_write_file 的 content 与 remote_patch_file 的 old/new_string 用多行文本框)
- 提交后:下方面板 1 秒轮询任务状态直到终态;状态徽章 + stdout/stderr 等宽字体黑底面板分开展示;显示 exit_code、duration_ms、truncated 提示
- 页面底部:该机器最近 20 条任务历史(轮询 `/api/tasks?machine_id=`),点击可展开看输出

### 5.3 布局
- 左侧导航(机器 / 控制台),中文界面,深色模式可选但非必需

## 6. 环境变量

```text
AGENT_API_BASE=http://127.0.0.1:8700   # 服务端代理用
AGENT_API_KEY=dev-key                  # 服务端代理用,绝不下发浏览器
MOCK_API=1                             # 开发期
```

提供 `web/.env.example` 与 `web/README.md`(安装、启动、mock 说明)。

## 7. 验收标准

1. `MOCK_API=1` 下 `pnpm dev` 启动,/machines 能看到 2 台机器,状态徽章正确
2. /console 对 5 种工具都能渲染正确表单并提交,mock 任务 3 秒后变 completed 并显示输出
3. 浏览器 DevTools 网络面板中**看不到 X-API-Key**,所有请求走 /api/proxy/
4. 任务历史能展开查看输出;404/422 错误在 UI 上有可读提示(显示 error.message)
5. `pnpm build` 通过,无 TS 错误
6. 不存在对 server/、runner/、docs/ 的任何改动

## 8. 明确不做(后续任务卡)

登录页、用户系统、聊天界面、WebSocket 实时推送(本期全部轮询)、任务取消按钮、审批流、桌面端打包(Tauri,见 T-DESK-01)。
