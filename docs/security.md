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
  - 机器归属由 `owner_user_id` 决定:enrollment token 可绑定 owner,或由管理员事后分配。
  - 普通用户:只能列出/操作归属自己的机器;**无主机器(owner 为空)普通用户不可用**,需管理员先分配。
  - 管理员 / `X-API-Key` 管理通道:可见并可操作全部(后者用于服务集成与 WebUI MVP,生产应收敛)。
  - 任务、会话同样按其机器/创建者归属做隔离(跨用户访问返回 403)。
- **跨机器临时授权**:机器所有者可把访问临时授权给他人(`machine_grants`,带有效期,可随时撤销)。
  被授权人能使用机器,但**不能裁决审批**(高风险操作仍须机器所有者/管理员批准,防止自批)。
- **高风险操作审批**:命中风险规则的 remote_exec / 敏感路径访问不直接执行,转为 `pending` 审批,
  由机器所有者或管理员 approve 后才下发(见 §3)。再次强调:风险规则是审批触发层,不是拦截边界。
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

**插件(机器能力)同源**:Runner 启用哪些插件(及其工具)只来自本地 `plugins` 配置;
服务器只能看到 Runner 上报的工具,**不能远程启用插件给机器加能力**(同 allowed_roots 原则)。

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
- secret redaction:对常见凭据形态(API key、Bearer token、私钥块、password/secret 键值)打码。
  - **两条数据路径**:功能性输出(资源所有者在控制台看自己机器的 stdout)保留原文,否则无法调试;
    面向管理员的跨用户审计接口(`/api/audit/*`)在**读路径统一脱敏**。
  - 脱敏是尽力而为的纵深防御,不替代前置控制(Runner 低权限账号运行 + 不读敏感路径)。
- 日志访问受权限控制,保存周期可配置;审计表不可被业务代码 UPDATE/DELETE。

## 5. 审计内容

用户输入、模型回复、工具调用(参数与结果)、命令执行、文件读/写/patch(含前后哈希与 diff)、
审批记录、token 用量、Runner 上下线、认证失败。
