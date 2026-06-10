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
