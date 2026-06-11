# T-WEB-07:对话实时流(消费 /ws/client)

> 执行者:Codex。前置:T-WEB-04(对话界面)。**只允许改动 `web/`(及桌面传输适配)。**
> 后端 `/ws/client` 事件流已就绪;本卡让对话界面实时展示模型步骤与命令输出。

## 1. 目标

对话发送后,不再只是"转圈等最终回复",而是**实时**显示:模型在调哪个工具、**命令的实时 stdout**、每步结果、最终回复。同步 POST 仍作为兜底(它返回最终结果)。

## 2. 后端契约(已冻结)

```text
POST /api/ws-ticket                       → {ticket}   (认证后取,30s 一次性)
WS   {AGENT_WS}/ws/client?ticket=<ticket>
   连接后发: {type:"subscribe", session_id}
   收到:    {type:"subscribed", session_id}  然后是事件流
```

事件类型:`turn_started` / `assistant`{content,tool_calls} / `tool_call`{tool,arguments} /
`tool_output`{task_id,stream,data}(**追加式实时输出**)/ `tool_result`{tool,status} /
`approval_required`{approval_id,risk_rule} / `turn_done`{reply,stopped} / `turn_error`{code,message}。

## 3. 关键:WS 地址与鉴权

- **Web**:Next 服务端代理**不能转发 WS**,故浏览器需**直连 Agent Server 的 WS**。
  - 新增 `NEXT_PUBLIC_AGENT_WS_URL`(如 `ws://127.0.0.1:8700`),仅 WS 用;REST 仍走 `/api/proxy`。
  - 取票据走代理(`POST /api/proxy/ws-ticket`,带 cookie 鉴权),再用票据开 WS。
- **Desktop**:已直连 Server,有 token;同样先 `POST /ws-ticket` 取票据再开 WS(地址用用户配置的 Server,scheme 换 ws/wss)。传输层在 desktop 分支用 Tauri 能力开 WS 或允许 connect-src(注意 T-DESK-02 的 CSP `connect-src` 需放行该 WS 源)。

## 4. 交互

在对话页发送消息时:
1. 先 `POST /ws-ticket` 取票据,开 `/ws/client`,`subscribe` 当前 session。
2. 再发消息(POST messages,可不等其返回,以事件流为准;turn_done 即终态)。
3. 按事件渲染:
   - `tool_call`:显示"正在执行 remote_exec(...)"卡片。
   - `tool_output`:等宽黑底面板,**按 data 追加**(实时滚动,像终端)。
   - `tool_result`:该步标记完成/失败。
   - `approval_required`:醒目提示 + 跳审批(复用 T-WEB-05)。
   - `assistant`/`turn_done`:渲染模型文字/最终回复。
4. WS 断开或不可用时,回退到"等 POST 同步返回"(现状),不阻塞使用。

## 5. Mock 模式

`MOCK_API=1` 时无真实 WS:可用定时器模拟一串事件(turn_started→tool_call→几条 tool_output→tool_result→assistant→turn_done)驱动同一渲染逻辑。

## 6. 验收标准

1. 发送消息后能实时看到工具调用与**逐行追加的命令输出**(非一次性出现)
2. `approval_required` 有醒目提示与审批入口;`turn_done` 后状态为终态
3. WS 不可用时回退同步模式,功能不阻塞
4. 浏览器看不到 token(票据是一次性、短时;WS URL 不含长期凭据)
5. `pnpm build` 通过;`web` 既有测试仍全绿;仅改动 `web/`(及 desktop 传输适配)

## 7. 明确不做

token 级逐字流式(后端暂为事件流)、多会话同时订阅、历史回放。
