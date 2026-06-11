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
| [T-WEB-01](T-WEB-01-webui-console.md) | 机器列表 + 任务控制台 | — | ✅ 已完成(Claude review 通过) |
| [T-WEB-02](T-WEB-02-login.md) | 登录 + token(httpOnly cookie)+ 代理改用用户 token | T-WEB-01 | 待做 |
| [T-WEB-03](T-WEB-03-audit.md) | 管理员审计后台(用量/会话/命令) | T-WEB-02 | 待做 |
| [T-WEB-04](T-WEB-04-chat.md) | 对话界面(模型驱动远程工具) | T-WEB-02 | 待做 |
| [T-WEB-05](T-WEB-05-approvals-grants.md) | 审批收件箱 + 跨机器授权 UI | T-WEB-02 | 待做 |
| [T-DESK-01](T-DESK-01-desktop-client.md) | Tauri 2 桌面客户端(原生直连 + keychain) | T-WEB-02 + M4(已就绪) | 可开工 |

建议顺序:**02 → 03 / 04 / 05 可并行 → DESK-01**。

## 本地起后端(供前端联调)

```bash
scripts/dev_up.sh        # 拉起 Server+Runner+WebUI,详见 scripts/README.md
```
默认管理员 `admin / admin12345`,Server 在 `http://127.0.0.1:8700`。
