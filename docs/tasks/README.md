# Codex 前端任务卡索引

> 给 Codex(GPT-5.5)的前端任务清单。后端 M1–M6 已由 Claude 完成,API 契约见
> [../protocol.md](../protocol.md)(权威)、安全模型见 [../security.md](../security.md)。

## 铁律(所有任务卡通用)

- **只允许改动 `web/`**(桌面端卡为 `desktop/`)。**不得改动 `server/`、`runner/`、`docs/`。**
- API 契约已冻结,以各卡与 `docs/protocol.md` 为准;若发现契约对不上,在 PR 描述中列出,**不要自行改后端或改契约**。
- 每张卡都要求带 `MOCK_API=1` 离线模式、`pnpm build` 通过、验收标准全绿。
- API Key / token 绝不暴露到浏览器:统一走 `web/app/api/proxy` 服务端代理(见 T-WEB-01/02)。

## 顺序与依赖

| 卡 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| [T-WEB-01](T-WEB-01-webui-console.md) | 机器列表 + 任务控制台 | — | ✅ 已完成(review 通过) |
| [T-WEB-02](T-WEB-02-login.md) | 登录 + token(httpOnly cookie)+ 代理改用用户 token | T-WEB-01 | ✅ 已完成 |
| [T-WEB-03](T-WEB-03-audit.md) | 管理员审计后台(用量/会话/命令) | T-WEB-02 | ✅ 已完成 |
| [T-WEB-04](T-WEB-04-chat.md) | 对话界面(模型驱动远程工具) | T-WEB-02 | ✅ 已完成 |
| [T-WEB-05](T-WEB-05-approvals-grants.md) | 审批收件箱 + 跨机器授权 UI | T-WEB-02 | ✅ 已完成 |
| [T-DESK-01](T-DESK-01-desktop-client.md) | Tauri 2 桌面客户端(原生直连 + keychain) | T-WEB-02 + M4 | ✅ 已完成(review 通过) |
| [T-WEB-06](T-WEB-06-admin-onboarding.md) | 管理控制台:用户/Enrollment 上线引导/机器归属/取消任务 | T-WEB-02 | ✅ 已完成 |
| [T-DESK-02](T-DESK-02-hardening.md) | 桌面端加固:限制性 CSP + 收窄 http 权限 | T-DESK-01 | ✅ 已完成 |
| [T-PKG-01](T-PKG-01-runner-binary.md) | Runner 打单文件可执行(纯打包,不改逻辑) | — | 🟢 可交 Codex |
| [T-DEPLOY-01](T-DEPLOY-01-compose.md) | 生产编排 Docker Compose(只新增 deploy/) | — | 🟢 可交 Codex |
| [T-WEB-07](T-WEB-07-streaming.md) | 对话实时流(消费 /ws/client 事件) | T-WEB-04 | 🟢 可交 Codex(后端就绪) |
| [T-WEB-08](T-WEB-08-model-admin.md) | 模型管理页(增删改/默认/用户路由,key 脱敏) | T-WEB-02 + M8 后端 | ✅ 已完成(review 通过) |
| [T-WEB-09](T-WEB-09-connectors.md) | 插件/连接器管理页(MCP,状态/作用域,env 不回显) | T-WEB-02 + M10 后端 | ✅ 已完成(review 通过) |
| [T-WEB-10](T-WEB-10-skills.md) | 技能页(启停 + 管理 + GitHub 导入) | T-WEB-02 + M11 后端 | 🟢 **待做**(后端就绪) |

> 注:T-PKG-01 / T-DEPLOY-01 是**受控例外**——纯打包/运维,带硬护栏(不改安全逻辑/不动应用源码)。
> 协议版本校验、Alembic 迁移、流式输出仍属 server/runner 应用层,由 Claude 完成。

下一批建议:**T-WEB-06 优先**(管理员才能把人/机器拉进平台);T-DESK-02 可并行。

## 本地起后端(供前端联调)

```bash
scripts/dev_up.sh        # 拉起 Server+Runner+WebUI,详见 scripts/README.md
```
默认管理员 `admin / admin12345`,Server 在 `http://127.0.0.1:8700`。
