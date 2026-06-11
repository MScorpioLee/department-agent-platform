# T-WEB-06:管理控制台与上线引导(用户 / Enrollment / 机器归属 / 取消任务)

> 执行者:Codex。前置:T-WEB-02(登录)。**只允许改动 `web/`。**
> 补齐后端已有、但前端缺入口的管理能力;均为 admin 功能(取消任务除外)。

## 1. 背景与目标

后端已有这些能力,但 WebUI 没有页面,管理员只能手敲 API。补上之后,管理员才能在界面里
**把人和机器拉进平台**(这是真实部署的第一道坎):
1. 用户管理(创建/列出)
2. **Enrollment token 签发 + Runner 上线引导**(最关键)
3. 机器归属重新分配
4. 控制台「取消任务」按钮(普通能力,非 admin)

## 2. 后端 API 契约(已冻结)

```text
# 用户(admin)
GET  /api/users                         → [{id, username, display_name, role}]
POST /api/users   {username,password,display_name?,role}  → {id,username,display_name,role}
   role ∈ "user"|"admin";password 最少 6 位;重名 409 user_exists

# Enrollment token(admin)—— 注意:只有「签发」,无列表/撤销;明文只返回一次
POST /api/enrollment-tokens  {owner_user_id?, max_uses=1, expires_in_days=7}
   → {enrollment_token:"et_...", owner_user_id, max_uses}
   owner_user_id 省略=注册为无主(需事后分配);不存在的 user → 404 user_not_found

# 机器归属(admin)
POST /api/machines/{id}/assign  {user_id|null}   → {machine_id, owner_user_id}   # null=置无主

# 取消任务(机器所有者/admin/被授权人)
POST /api/tasks/{task_id}/cancel  → {task_id, status}
   非终态才可取消;已终态 → 409 already_finished
```

## 3. 页面与交互

入口仅在 `role==admin` 时显示(取消任务按钮对所有有权用户显示)。

### 3.1 `/admin/users` 用户管理
- 表格列出用户(用户名、显示名、角色)。
- 「新建用户」表单:用户名 + 密码(≥6)+ 显示名(可选)+ 角色;成功后刷新列表;重名/弱密码显示后端 error.message。

### 3.2 `/admin/onboarding` 上线引导(**重点**)
- 「签发 enrollment token」表单:可选归属用户(下拉 `/api/users`,留空=无主)+ max_uses + 有效天数。
- 签发后**醒目展示明文 token,提示"仅此一次,请立即复制"**。
- 同屏给出 **Runner 上线指引**(纯展示文本,把刚签发的 token 填进去),例如:
  ```yaml
  # runner/config.yaml
  server_url: <当前 Server 地址>
  machine_name: <本机名>
  enrollment_token: et_xxx        # 刚签发的
  allowed_roots:
    - <填写本机可被操作的目录>
  ```
  并附一句"装好 Runner 后执行 `python -m agent_runner --config config.yaml` 自动注册"。

### 3.3 机器归属(在 `/machines/access` 或机器详情内,admin)
- 在现有机器访问/详情页加「重新分配归属」:选用户(或置无主)→ `POST .../assign`,刷新。

### 3.4 取消任务(控制台)
- 控制台任务历史/详情里,对**非终态**任务显示「取消」按钮 → `POST /api/tasks/{id}/cancel`,轮询状态变化。

## 4. Mock 模式

`MOCK_API=1`:用户列表/创建、enrollment 签发(返回假 `et_mock_xxx`)、assign、cancel 均返回合理假数据并就地更新。

## 5. 验收标准

1. admin 能在 UI 创建用户,新用户可登录
2. admin 能签发 enrollment token,token 明文展示并提示一次性;上线指引带入该 token
3. admin 能重新分配/置空机器归属,机器列表归属随之变化
4. 非终态任务可在控制台点「取消」,状态推进到 cancelled
5. 非 admin 看不到 `/admin/*` 入口,直达显示无权限
6. `pnpm build` 通过;`MOCK_API=1` 全流程可走通;**既有 web/desktop 测试仍全绿**
7. 仅改动 `web/`

## 6. 明确不做

enrollment token 列表/撤销(后端暂无端点)、用户改密/禁用、批量操作、Runner 一键安装包下载(那属打包,见 docs/packaging.md)。
