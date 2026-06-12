# T-WEB-14:连接器市场(MCP 官方注册表搜索 + 一键导入)

> 执行者:Codex。前置:T-WEB-12/13(连接器页)。**只允许改动 `web/`。**
> 后端已就绪:`GET /api/admin/connector-registry` 代理 MCP 官方注册表搜索,返回**版本已钉死**的现成配置。对标 Hermes 插件市场的"浏览 + 安装"。

## 1. 后端契约(已就绪)

```text
GET /api/admin/connector-registry?q=<搜索词>&limit=20   (admin)
  → [{name, title, description, version, installable: bool,
      install: {transport:"stdio"|"http", command?, args?:[], url?, env_keys:[...]} | null}]
     例:install = {transport:"stdio", command:"uvx", args:["mcp-server-fetch==1.0.0"], env_keys:[]}
     注:版本已钉死在 args 里(pkg@1.2.3 / pkg==1.2.3);installable=false 仅展示不可装
     注册表不可用时返回 502 {code:"registry_unavailable"}

# 安装仍走已有创建端点(不变):
POST /api/admin/connectors  {name, transport, command?, args?, url?, env?, scope_all?, require_approval?}
```

## 2. 页面(连接器页加「市场」区块或 Tab)

1. 搜索框 + 搜索按钮(回车触发);结果卡片:title/name、description、version、
   installable=false 的显示"暂不支持一键导入"(禁用按钮)。
2. 卡片「导入」按钮 → 打开**预填的添加连接器表单**(复用 T-WEB-12 弹窗):
   - name 默认取注册表 name 的最后一段(可改,需唯一);transport/command/args/url 来自 `install`;
   - `env_keys` 渲染成待填凭据字段(同 T-WEB-12 预设流程);
   - 默认勾选「每次调用需审批」(来自市场的第三方代码,先审慎)——管理员可取消。
3. 提交 → POST /connectors(已有);成功后出现在连接器列表。
4. **安全提示**沿用:"导入即在服务端运行第三方代码,请确认来源可信;版本已钉死,不会自动更新"。
5. 502(registry_unavailable)时给出友好错误条,不影响本地列表。

## 3. Mock 模式

`MOCK_API=1`:`/api/admin/connector-registry` 返回 2-3 个假条目(含 1 个 installable=false),
搜索词过滤 mock 数据;导入流程走通(预填→创建→入列表)。

## 4. 验收标准

1. 能搜索注册表并展示结果;installable=false 正确禁用
2. 一键导入:预填表单(含 env_keys 凭据字段、默认勾选需审批)→ 创建成功入列表
3. 注册表 502 时有友好提示;env 值全程不回显
4. `pnpm build` 通过;`MOCK_API=1` 全流程可走;既有测试全绿;仅改 `web/`

## 5. 明确不做

注册表分页浏览(只搜前 N 条)、评分/下载量、连接器更新检查(版本钉死是有意为之)。
