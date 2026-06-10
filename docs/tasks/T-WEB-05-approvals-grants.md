# T-WEB-05:审批与跨机器授权 UI

> 执行者:Codex。前置:T-WEB-02(登录)。**只允许改动 `web/`。**
> 后端 M6 已就绪;面向**机器所有者**(及管理员)。

## 1. 目标

两块面向机器所有者的管理界面:
1. **审批收件箱**:处理高风险操作的待审批请求。
2. **跨机器授权**:把自己机器的临时访问授予同事 / 撤销。

## 2. 后端 API 契约(已冻结)

```text
# 审批
GET  /api/approvals?status=pending     → [{approval_id, machine_id, requested_by_user_id, tool, payload, risk_rule, status, created_at}]
POST /api/approvals/{id}/approve       → {approval_id, status:"approved", task_id, task_status}
POST /api/approvals/{id}/reject        → {approval_id, status:"rejected"}

# 授权(机器所有者/admin)
POST   /api/machines/{id}/grants       {grantee_user_id, expires_in_hours}  → {grant_id, ...expires_at}
GET    /api/machines/{id}/grants       → [{grant_id, grantee_user_id, granted_by_user_id, expires_at, created_at}]
DELETE /api/grants/{grant_id}          → {revoked}

GET  /api/users  (admin)               → [{id, username, display_name, role}]   # 选择被授权人用
```

非所有者/非 admin 调用相关接口返回 403;前端据此提示无权限。

## 3. 页面

### `/approvals` 审批收件箱
- 列出 `pending` 审批:机器、发起人、工具、**命中的风险规则**、命令/参数(等宽展示)、时间。
- 每条「批准」「拒绝」按钮;批准成功显示生成的 `task_id`(可跳任务详情/控制台查看结果)。
- 空态友好提示。轮询刷新(5s)。

### `/machines/{id}/access` 或机器详情内的「授权」区
- 当前有效授权列表(被授权人、有效期),每条可「撤销」。
- 「新增授权」:选用户(`/api/users`,admin;非 admin 可手填 user_id 或仅在 admin 下启用)+ 有效小时数 → 创建。
- 仅在当前用户是该机器所有者或 admin 时显示。

## 4. Mock 模式

`MOCK_API=1`:提供 2 条假待审批(含一条 `rm -rf` 规则)、批准/拒绝就地改状态;授权列表可增删假数据。

## 5. 验收标准

1. 待审批列表正确展示风险规则与命令,批准/拒绝生效并刷新
2. 授权:能新增(带有效期)、能撤销,列表实时更新
3. 非所有者访问相关操作有 403 友好提示
4. `pnpm build` 通过;`MOCK_API=1` 全流程可走通
5. 仅改动 `web/`

## 6. 明确不做

审批历史检索、审批通知推送、授权范围(子目录)细化(后端暂未细分 scope)。
