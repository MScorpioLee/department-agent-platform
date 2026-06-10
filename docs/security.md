# 安全设计

## 基本原则

- 默认最小权限
- 用户默认只能控制自己的机器
- 跨机器必须授权
- 每台 Runner 独立 token
- 每个会话绑定用户、机器、模型、工作目录
- 所有操作必须审计
- 高风险操作必须审批
- Runner 不使用管理员权限运行

## 路径限制

Runner 只能访问 allowed_roots，不能访问 blocked_paths。

```yaml
allowed_roots:
  - D:/projects
  - C:/Users/Alice/work

blocked_paths:
  - C:/Windows
  - C:/Users/Alice/.ssh
  - C:/Users/Alice/AppData
  - C:/Users/Alice/.aws
```

## 高风险命令

以下操作需要审批或禁止：

- rm -rf
- del /s
- format
- diskpart
- reg delete
- powershell -enc
- curl | bash
- Invoke-WebRequest | iex
- 读取 .ssh
- 读取 .env
- 读取浏览器 cookies

## 审计日志

必须记录：

- 用户输入
- 模型回复
- 工具调用
- 命令执行
- 文件读取
- 文件修改
- 审批记录
- token 用量
