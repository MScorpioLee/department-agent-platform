# T-DESK-02:桌面端安全加固(CSP + 收窄权限)

> 执行者:Codex。前置:T-DESK-01 完成。**只允许改动 `desktop/`(必要时含 `web/` 的桌面构建配置)。**
> 纵深防御加固,Claude review 时提出。不得改动 `server/`、`runner/`、`docs/`。

## 1. 背景

T-DESK-01 review 发现两处纵深防御可加固(均非当前漏洞,token 已安全存 keychain、请求经 Rust 校验):
1. `src-tauri/capabilities/default.json` 给 JS 的 `http:default` 放行了 `http://*` / `https://*`——
   但实际数据请求**都走 Rust 命令**(`desktop_api_request` 用 reqwest),JS 侧 http 插件能力很可能根本没用到。
2. `src-tauri/tauri.conf.json` 的 `app.security.csp = null`,CSP 关闭。

## 2. 要做的

### 2.1 收窄/移除 JS 侧 http 能力
- 先确认前端是否在任何地方直接用 `@tauri-apps/api/http`(而非走 `invoke` 的 Rust 命令)。
- 若**没有**:从 `capabilities/default.json` 移除 `http:default` 那条(Rust 侧 reqwest 不依赖该 capability),验证桌面 App 功能不受影响。
- 若**有**:把 `allow` 收窄到必要范围,不要留 `http://*`/`https://*` 通配。

### 2.2 加限制性 CSP
- 在 `tauri.conf.json` 的 `app.security.csp` 设最小可用策略,目标:`default-src 'self'`,按需放行
  样式/脚本(Next 静态导出可能需 `'unsafe-inline'` 的 style;脚本尽量 `'self'`)。
- 因为数据连接走 Rust(不是浏览器 fetch),`connect-src` 可收紧(通常 `'self'` 即可;实测若 WebView 需要再放）。
- 标准:设上 CSP 后桌面 App 各页面(登录/机器/控制台/对话/审批/设置)仍正常工作,控制台无被 CSP 拦截的报错。

## 3. 验收标准

1. JS 侧不再持有 `http://*`/`https://*` 通配能力(移除或收窄)
2. `tauri.conf.json` 配了非 null 的限制性 CSP,App 全页面功能正常、无 CSP 报错
3. token 仍只在 keychain;桌面登录/调用/登出回归正常
4. `web` 模式不受影响:`web/` 既有 `pnpm test`/`pnpm build` 仍全绿
5. 仅改动 `desktop/`(及必要的 `web/` 桌面构建配置)

## 4. 明确不做

签名/公证、自动更新、其他平台特定加固(后续单独处理)。
