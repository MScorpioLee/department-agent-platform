# 架构设计

## 核心架构

```text
WebUI / Desktop Client
        ↓
Agent Server
        ↓
Runner Gateway
        ↓
Runner Client
```

## Server 职责

- 用户登录
- 会话存档
- 模型调用
- 权限检查
- 工具调度
- 审计日志
- 用量统计

## Runner 职责

- 主动连接服务器
- 执行远程工具
- 上报本机能力
- 本地安全检查
- 回传执行结果

## Agent 工具

模型不直接访问服务器终端，而是调用远程工具：

- remote_exec
- remote_read_file
- remote_write_file
- remote_patch_file
- remote_list_files

## 动态工具暴露

工具列表由以下条件决定：

```text
目标机器能力 ∩ 用户权限 ∩ 会话策略 ∩ Runner 本地策略
```
