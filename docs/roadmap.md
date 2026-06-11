# Roadmap

## Milestone 1：Runner 通信闭环

- Runner 注册
- WebSocket 连接
- 心跳
- remote_exec
- 执行结果回传

## Milestone 2：远程文件工具

- remote_read_file
- remote_write_file
- remote_patch_file
- allowed_roots 检查
- blocked_paths 检查

## Milestone 3：模型对话闭环

- 接入 LiteLLM / OpenAI-compatible API
- 构造 Agent 上下文
- 模型调用远程工具
- 工具结果回填上下文

## Milestone 4：WebUI

- 登录
- 模型选择
- 机器选择
- 聊天窗口
- 工具调用时间线

## Milestone 5：审计后台

- 会话日志
- 命令日志
- 文件修改日志
- 模型用量统计

## Milestone 6：权限与授权

- 用户默认只能控制自己的机器
- 临时授权其他人控制机器
- 高风险操作审批

## Milestone 7:多端桌面客户端

- Tauri 2 壳复用 web/ 前端(Windows / macOS / Linux)
- 用户登录凭据(依赖 M4 用户系统,不内置共享 API Key),存 OS keychain
- 系统托盘、任务完成通知
- 移动端远期,同一 API,暂不排期

## Milestone 8/9/10:三大管理面(设计见 docs/management.md)

- M8 模型管理:DB 化模型后端 + admin API + 管理页(界面增删改/分配/热生效,key 加密不回显)
- M9 机器能力:Runner 工具插件化(git/node/python… 可装可启用)+ 动态 schema;只来自本地配置
- M10 插件/连接器:服务端 MCP client 连外部服务(Slack/Notion/GitHub/Web…),市场+凭据+按用户授权审计
- M11 技能:可启停的任务能力包(封装连接器/提示词,对标 Codex 技能)
