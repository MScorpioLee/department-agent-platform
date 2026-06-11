# T-WEB-10:技能页(能力包,启停 + 导入)

> 执行者:Codex。前置:T-WEB-02(登录)。**只允许改动 `web/`。**
> 后端 M11 已就绪。对标 Codex 的"技能":用户启停可用技能;管理员增删改 + 从 GitHub 导入。

## 1. 目标

- 普通用户:`/skills` 看自己可用的技能,勾选启停(启用后其提示词并入对话)。
- 管理员:在同页或 `/admin/skills` 增删改技能、设作用域、**从 GitHub 导入**。

## 2. 后端 API 契约(已冻结)

```text
# 用户(登录即可)
GET  /api/skills                      → [{id,name,description,enabled}]   # 仅返回我有权的
PUT  /api/skills/{id}/enabled  {enabled:bool}    → 自己启停

# 管理员
GET    /api/admin/skills              → [{id,name,description,prompt,source_ref,scope_all,scopes,created_at}]
POST   /api/admin/skills              {name,description?,prompt,scope_all?}
PATCH  /api/admin/skills/{id}         {任意子集}
DELETE /api/admin/skills/{id}
PUT    /api/admin/skills/{id}/scope   {user_ids:[...]}
POST   /api/admin/skills/import       {url, scope_all?}   # url=GitHub raw 的 skill.yaml/SKILL.md
GET    /api/users (已有)               → 选作用域用户
```

要点:技能是**声明式**(提示词预设),从 GitHub 导入安全(后端只读解析,不执行代码)。

## 3. 页面

### 用户视角(`/skills`,所有登录用户)
- 列表 + 开关(对标 Codex 技能勾选):名称、描述、启停 Toggle。
- 空态:"暂无可用技能,联系管理员授权"。

### 管理员视角(admin 多出)
- 增删改技能(name/description/prompt 多行);设作用域(全员 / 选用户)。
- **「从 GitHub 导入」**:输入 raw URL(如 `https://raw.githubusercontent.com/<owner>/<repo>/main/SKILL.md`)→ POST import → 成功后出现在列表。可选 scope_all。
- 删除、编辑。

## 4. Mock 模式

`MOCK_API=1`:内置 2-3 个假技能(部分已授权),启停就地生效;导入返回一个假技能加入列表;`getMe` 角色为 admin 以便预览管理功能。

## 5. 验收标准

1. 用户能看到有权技能并启停;启停即时反映
2. admin 能新建/编辑/删除技能、设作用域、从 GitHub 导入(URL)
3. 非授权用户看不到未授权技能;管理功能仅 admin 可见
4. `pnpm build` 通过;`MOCK_API=1` 全流程可走;既有测试全绿;仅改 `web/`

## 6. 明确不做

技能市场浏览、版本管理、技能依赖的连接器自动连接(后续)。
