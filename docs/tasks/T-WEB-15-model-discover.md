# T-WEB-15:模型页对标 Hermes——「获取模型列表」实连校验

> 执行者:Codex。前置:T-WEB-11(添加 Provider 已存在)。**只允许改动 `web/`。**
> 后端已就绪:`POST /api/admin/model-providers/discover`。补上 Hermes 流程缺的一环:
> 填完 base_url+key 后**先拉取该端点的真实模型列表**(同时校验地址/key),从列表里选,而不是手填/猜。

## 1. 后端契约(已就绪)

```text
POST /api/admin/model-providers/discover   (admin)
  请求:{base_url, api_key?}        # key 仅本次探测,不落库
  成功:{models: ["deepseek-chat", ...], count: n}
  失败:502 {code:"discover_failed", message:"API Key 无效或无权限" | "端点返回 4xx/5xx" | "无法连接端点: ..."}

# 创建/编辑仍走已有端点(不变)
```

## 2. 交互(改「添加 Provider」表单)

1. 选 Provider、填 Base URL、填 API Key 之后,模型输入框旁加**「获取模型列表」按钮**:
   - 点击 → POST discover(带当前表单的 base_url/api_key)→ loading 态;
   - 成功:模型输入框变成**下拉**(真实列表,默认选第一个;仍允许切回手填);
     按钮旁绿色提示「✓ 连接成功,共 N 个模型」——**这同时就是连通性/key 校验**;
   - 失败:红色错误条显示 message(「API Key 无效或无权限」等),不阻断手填创建。
2. 预设的静态 models 候选保留为 datalist 兜底(未点获取前)。
3. **创建/编辑后的反馈增强**:成功 toast 已有;失败时把后端 error.message 显示出来
   (如 409「同名模型后端已存在」),不要只显示"请求失败"。

## 3. Mock 模式

`MOCK_API=1`:discover 返回假列表 `["mock-chat","mock-coder"]`;`api_key="bad"` 时返回 502
`{code:"discover_failed", message:"API Key 无效或无权限"}`,用于走通失败分支。

## 4. 验收标准

1. 填 DeepSeek/Ollama 等的地址(+key)→ 点「获取模型列表」→ 下拉出现真实模型并可选
2. key 错/地址不通 → 显示可读错误;仍可手填模型继续创建
3. 创建失败(如同名)显示后端 message;key 不回显明文
4. `pnpm build` 通过;`MOCK_API=1` 全流程可走;既有测试全绿;仅改 `web/`

## 5. 明确不做

自动定时刷新模型列表、多模型批量创建(一次仍创建一个后端)、用量计费。
