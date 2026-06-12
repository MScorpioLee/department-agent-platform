# T-WEB-12:连接器页升级(预设目录 + 统计卡 + 搜索过滤,参考 Hermes 插件页)

> 执行者:Codex。前置:T-WEB-09(连接器页已存在)。**只允许改动 `web/`。**
> 后端已就绪:`GET /api/admin/connector-presets`。把"新建连接器"裸表单升级成 Hermes 插件页那种:**选预设 → 自动填 command/args → 提示要哪些凭据**,并加顶部统计卡 + 搜索/过滤。

## 1. 目标

对标 Hermes Studio 的插件页:
1. **「添加连接器」选预设**:从常用 MCP server 目录(Filesystem、Fetch、GitHub、Slack、PostgreSQL、SQLite、Memory、Time、Brave Search、自定义)选一个,自动填 command/args,并把该预设要的 env(凭据)列成待填字段。
2. **顶部统计卡**:总数 / 已连接 / 异常 / 已禁用(从 `/api/admin/connectors` 列表就地计算)。
3. **搜索 + 过滤**:按名称搜索;按状态(connected/error/disabled)、传输(stdio/http)过滤。

## 2. 后端契约(已就绪)

```text
GET /api/admin/connector-presets   (admin)
  → [{id, name, transport, command, args:[...], env_keys:[...], note}]
     例:{id:"github", name:"GitHub", transport:"stdio",
          command:"npx", args:["-y","@modelcontextprotocol/server-github"],
          env_keys:["GITHUB_PERSONAL_ACCESS_TOKEN"], note:"需 GitHub PAT"}
     注:args 里可能含占位(如 filesystem 末尾的 "/path/to/dir"、postgres 的连接串)——提示用户改。
     id="custom" 为空壳,全部手填。

# 创建/列表仍走 T-WEB-09 已有端点(不变):
POST /api/admin/connectors  {name, transport, command?, args?, url?, env?, scope_all?}
GET  /api/admin/connectors  → 含 status / tool_count / env_keys
```

## 3. 交互(添加连接器弹窗)

1. 「添加连接器」按钮 → 弹窗。
2. **选预设**(下拉,来自 connector-presets):
   - 选中后:`transport`/`command`/`args` 自动填入(可改);`name` 默认填预设名(可改,需唯一);显示 `note`。
   - `env_keys` 渲染成待填的 key-value 输入(key 名锁定、值由管理员填,如 `GITHUB_PERSONAL_ACCESS_TOKEN=...`)。`env_keys=[]` 则无凭据字段。
   - args 含占位串(`/path/to/dir`、`postgresql://...`)时高亮提示"请替换为真实路径/连接串"。
   - `id=custom`:回到 T-WEB-09 的全手填表单。
3. 作用域(全员/选用户)、安全提示沿用 T-WEB-09。
4. 提交 → `POST /api/admin/connectors`(发明文 env,服务端加密)。

## 4. 列表页增强

- 顶部 4 张统计卡:总数 / 已连接(status=connected)/ 异常(status 以 error 开头)/ 已禁用(enabled=false)。
- 搜索框(按 name)+ 过滤(状态、传输),前端就地过滤已有列表数据。
- 其余(状态徽章、工具数、作用域、增删改、启用开关)沿用 T-WEB-09。

## 5. Mock 模式

`MOCK_API=1`:`/api/admin/connector-presets` 返回几个假预设(含 github/filesystem/custom);弹窗选预设能预填 command/args 与 env 字段;统计卡/搜索/过滤对 mock 列表生效。

## 6. 验收标准

1. 「添加连接器」能选预设,自动预填 command/args,并按 env_keys 列出待填凭据字段;选 custom 可全手填
2. env 值全程不回显(沿用 T-WEB-09);带 env 创建成功
3. 顶部统计卡数字正确;搜索 + 状态/传输过滤生效
4. `pnpm build` 通过;`MOCK_API=1` 全流程可走;既有测试全绿;仅改 `web/`

## 7. 明确不做(后续单独卡)

GitHub 市场在线浏览/一键安装、连接器工具实时调试、版本锁定 UI(后端 pin 版本属部署层)。
