# 安全设计(权威定义)

## 0. 信任模型(必读)

**能向某台 Runner 下发任务 ≈ 拥有该 Runner 进程所属 OS 账号的全部权限。**

原因:`remote_exec` 可以执行任意命令,任何对文件工具的路径限制都无法约束命令本身
(例如 `cat ~/.ssh/id_rsa` 一条命令即可绕过文件工具的 allowed_roots)。
因此:

1. **真正的安全边界在 Server 侧**:谁能登录、谁有权对哪台机器下发任务、高风险操作是否需要审批。
2. **第二道边界是 Runner 的运行账号**:Runner 必须以专用低权限 OS 账号运行
   (而不是员工自己的日常账号),该账号只能访问工作目录,无法读取 `.ssh`、浏览器数据、凭据文件。
   做不到专用账号时,必须明确告知机器所有者上述风险。
3. **命令黑名单只是审计与审批触发层,不是安全边界**(字符串匹配可被轻易绕过:
   `rm -fr`、写脚本再执行、`python -c` 等)。它的作用是:标记风险、触发人工审批、留痕。

## 1. 基本原则

- 默认最小权限;用户默认只能控制自己名下的机器。
- 跨机器操作必须由机器 owner 显式授权(范围 + 有效期 + 审批要求)。
- 每台 Runner 独立 token(服务器只存哈希,可单独吊销);enrollment token 限次限期。
- 每个会话绑定:用户、机器、模型、工作目录。
- 所有操作写审计日志;审计日志 append-only,普通用户不可删改。
- Server 不暴露公网;Runner→Server 必须 WSS/HTTPS。

## 2. 路径校验(Runner 本地强制执行)

校验顺序,**任何一步失败即拒绝**(`error_code: path_denied`):

1. 对目标路径执行 `os.path.realpath()` 规范化 —— 解析符号链接、`..`、
   Windows 8.3 短名(如 `C:\PROGRA~1`)等,**先规范化、后比对**。
2. 规范化后的路径必须位于某个 `allowed_roots` 之内(Windows/macOS 比对忽略大小写)。
3. 规范化后的路径不得位于任何 `blocked_paths` 之内。
4. 写入不存在的文件时,对**父目录**执行同样校验。
5. `remote_exec` 的 `workdir` 同样必须通过 1–3。

allowed_roots / blocked_paths 来自 **Runner 本地配置文件**,不接受服务器远程修改
(防止 Server 被攻破后放宽 Runner 约束)。

```yaml
allowed_roots:
  - /Users/alice/projects
blocked_paths:
  - /Users/alice/projects/secrets
```

## 3. 高风险命令(审计/审批层)

以下模式触发标记与(M6 起)审批,但**不视为可靠拦截**:

`rm -rf` / `del /s` / `format` / `diskpart` / `reg delete` / `powershell -enc` /
`curl … | bash` / `Invoke-WebRequest … | iex` / 读取 `.ssh`、`.env`、浏览器凭据 / 打包上传敏感目录。

## 4. 输出与日志

- 命令输出每流上限 1 MiB,防日志爆炸与敏感数据大批量外带。
- secret redaction:日志入库前对常见凭据形态(API key、Bearer token、私钥块)打码。
- 日志访问受权限控制,保存周期可配置;审计表不可被业务代码 UPDATE/DELETE。

## 5. 审计内容

用户输入、模型回复、工具调用(参数与结果)、命令执行、文件读/写/patch(含前后哈希与 diff)、
审批记录、token 用量、Runner 上下线、认证失败。
