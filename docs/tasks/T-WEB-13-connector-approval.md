# T-WEB-13:连接器"每次调用需审批"开关 + 审批页连接器结果

> 执行者:Codex。前置:T-WEB-12(连接器页)。**只允许改动 `web/`。**
> 后端已就绪(M10-b 加固):连接器可标记 `require_approval`,模型调用时先生成审批,批准后**在服务端执行**并返回结果(不下发机器)。

## 1. 后端契约(已就绪)

```text
# 连接器对象新增字段(GET/POST/PATCH /api/admin/connectors 均含):
  require_approval: bool        # 默认 false;true=该连接器每次工具调用先走审批

# 审批列表(已有 GET /api/approvals)里连接器审批的特征:
  tool 以 "mcp__" 开头;risk_rule = "connector_requires_approval"

# 批准连接器审批的响应(与机器任务不同,没有 task_id):
POST /api/approvals/{id}/approve
  → {approval_id, status:"approved", result:{content,...}, tool_status:"completed"|"failed"}
  (机器任务审批仍返回 {task_id, task_status},两种都要兼容)
```

## 2. 改动点

1. **连接器表单**(新建/编辑):加「每次调用需审批」复选框(默认不勾),提交带 `require_approval`。
2. **连接器列表**:`require_approval=true` 的行加「需审批」徽章(琥珀色)。
3. **审批页**:
   - 连接器审批(tool 以 `mcp__` 开头)展示规则文案"连接器调用审批"。
   - 批准后:响应若含 `result`(连接器),把 `result.content` 摘要展示(成功绿/失败红);若含 `task_id`(机器任务)保持现有行为。
4. **Mock**:mock 连接器加 require_approval 字段;mock 审批里加一条 `mcp__` 工具的待审批,approve 返回 `{result:{content:"echo: hi"}, tool_status:"completed"}`。

## 3. 验收标准

1. 能勾选/取消「每次调用需审批」,列表有徽章
2. 审批页能批准连接器审批并看到执行结果摘要;机器任务审批行为不回归
3. `pnpm build` 通过;`MOCK_API=1` 全流程可走;既有测试全绿;仅改 `web/`
