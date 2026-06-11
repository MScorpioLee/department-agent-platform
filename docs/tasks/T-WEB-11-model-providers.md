# T-WEB-11:模型页升级"添加 Provider"(预设目录,参考 Hermes Studio)

> 执行者:Codex。前置:T-WEB-08(模型页已存在)。**只允许改动 `web/`。**
> 后端已就绪:`GET /api/admin/model-providers` 返回预设 Provider 目录。把"添加模型"改成 Hermes 那种"选 Provider → 自动填地址 → 只填 key"。

## 1. 目标

当前模型页是裸表单(手填 base_url/model)。改成:**「添加 Provider」**先选预设(DeepSeek、OpenAI、Google AI Studio、Z.AI/GLM、Kimi、通义、OpenRouter、LM Studio、Ollama、Hermes 代理、Anthropic、自定义),选后自动填 base_url、model 给候选,只需填 key。保留"自定义"手填。

## 2. 后端契约(已就绪)

```text
GET /api/admin/model-providers   (admin)
  → [{id, name, base_url, models:[...], needs_key:bool, note}]
     例:{id:"deepseek", name:"DeepSeek", base_url:"https://api.deepseek.com/v1",
          models:["deepseek-chat","deepseek-reasoner"], needs_key:true, note:""}

# 创建仍走已有端点(不变):
POST /api/admin/models  {name, base_url, model, api_key, max_concurrency, is_default}
```

## 3. 交互(添加 Provider 弹窗)

1. 「添加 Provider」按钮 → 弹窗。
2. **选 Provider**(下拉,来自 model-providers):
   - 选中后:`base_url` 自动填入(可改);`model` 变成该 provider 的 `models` 候选下拉(也允许手填);`name` 默认填 provider 名(可改,需唯一);显示 `note` 提示。
   - `needs_key=false`(如 LM Studio/Ollama/Hermes 代理):key 输入框可留空/隐藏。
   - `id=custom` 或 `base_url` 为空:全部手填。
3. 可设 `max_concurrency`、`is_default`。
4. 提交 → `POST /api/admin/models`(发明文 key,服务端加密)。

> 列表展示、编辑、删除、用户路由沿用 T-WEB-08(api_key 仍只显示脱敏值、编辑留空不改)。

## 4. Mock 模式

`MOCK_API=1`:`/api/admin/model-providers` 返回几个假预设(含 deepseek/ollama/custom),弹窗选预设能预填。

## 5. 验收标准

1. 「添加 Provider」能从预设选,自动预填 base_url 与 model 候选,只填 key 即可创建
2. 选本地类(needs_key=false)时不强制 key;选自定义可全手填
3. 创建后出现在列表;api_key 不回显明文
4. `pnpm build` 通过;`MOCK_API=1` 全流程可走;既有测试全绿;仅改 `web/`

## 6. 明确不做(后续单独卡)

辅助模型(给视觉/压缩/标题等子任务分配模型——平台暂无这些子任务)、连通性测试按钮。
