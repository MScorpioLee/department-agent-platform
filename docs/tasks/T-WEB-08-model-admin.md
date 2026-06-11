# T-WEB-08:模型管理页(管理员)

> 执行者:Codex。前置:T-WEB-02(登录)。**只允许改动 `web/`。**
> 后端 M8 已就绪;管理员在界面里增删改模型后端、设默认、给用户分配路由,改完即时生效(后端热加载)。

## 1. 目标

`/admin/models` 页(仅 admin 可见,复用 `AdminGuard`):管理"大脑"——LLM 后端。不再改 models.yaml + 重启。

## 2. 后端 API 契约(已冻结,均需 admin)

```text
GET    /api/admin/models
  → [{id,name,base_url,model,api_key,max_concurrency,enabled,is_default,created_at}]
     注意:api_key 是【脱敏】值(如 "sk-…cdef"),仅供展示,不可编辑回传

POST   /api/admin/models   {name,base_url,model,api_key,max_concurrency,is_default}
PATCH  /api/admin/models/{id}  {任意子集;api_key 仅在"要改"时传明文,留空/不传=保持原值}
DELETE /api/admin/models/{id}  → {deleted}

GET    /api/admin/model-routes → [{user_id, backend_id}]
PUT    /api/admin/model-routes {user_id, backend_id | null}   # null = 删路由,回落默认
GET    /api/users   (已有)  → 给路由选用户
```

要点:
- **api_key 单向**:GET 只回脱敏值;新建/编辑时由你**发明文**,服务端加密存。编辑时"密码框留空 = 不改 key"。
- `is_default` 全局唯一:把某后端设默认会自动取消其他默认。
- 改动**即时生效**(后端热加载网关),无需重启。

## 3. 页面

### 模型后端列表
- 表格:名称、base_url、model、key(脱敏)、并发、启用开关、默认徽章。
- 「新建后端」表单:name / base_url / model / api_key / max_concurrency / 设为默认。
- 每行:编辑(api_key 留空=不改)、删除、设为默认。

### 用户路由(同页或子区)
- 列出 `user_id → backend`;「分配」:选用户(`/api/users`)+ 选后端 → PUT;可「清除」(置 null)。
- 说明文案:未分配的用户用默认后端。

## 4. Mock 模式

`MOCK_API=1`:内置 1-2 个假后端(key 已脱敏)、可增删改、路由可设;`is_default` 唯一性在前端模拟。

## 5. 验收标准

1. admin 能新建/编辑/删除模型后端;设默认时其他默认自动取消
2. **api_key 全程不出现明文**:列表/详情只见脱敏值;编辑留空不覆盖原 key
3. 能给用户分配/清除模型路由
4. 非 admin 无入口、直达显示无权限
5. `pnpm build` 通过;`MOCK_API=1` 全流程可走;既有测试全绿;仅改 `web/`

## 6. 明确不做

连通性测试按钮、用量图表(用量看审计页)、连接器/技能(后续 M10/M11)。
