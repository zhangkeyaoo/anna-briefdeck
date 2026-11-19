# Anna staging 生成与额度说明

## 一次生成的流程

| 阶段 | 谁处理 | 额度边界 |
| --- | --- | --- |
| 选择资料和校验 | BriefDeck 在浏览器读取 Word 和 TXT，验证图片、资料状态及页数 | 输入错误在模型调用前被拦截。示例、预览、编辑和 PPTX 导出也在本地完成，消耗 0 CU |
| 提交请求 | 用户点击生成，BriefDeck 通过 Anna Runtime 发一条 `llm.complete` 请求 | 请求含提示词、提取后的文档文字和可选图片。含图时提交视觉模型偏好 |
| 模型执行与计费 | Anna 检查额度、选择可用模型并转发，按平台计费 | 模型处理后，即使回复截断或无法转换为稿件，也可能已经消耗 CU。应用无法控制平台账单 |
| 验证及排版 | BriefDeck 检查停止原因、JSON、页数和字段，再渲染 PPT | 这一步自身消耗 0 CU。失败保留输入与已有稿件，应用不自动重试 |

官方开发工具的真实桥接也会调用远端模型并计入额度。模拟宿主用固定响应，可以覆盖格式错误、截断和额度不足等分支。 [Anna App LLM 接口](https://staging.anna.partners/developers/apps/llm-and-agent.md) · [官方本地调试文档](https://github.com/Anna-Partners/anna-developer-docs/blob/main/docs/apps/local-dev-llm.md)

## Token 和 CU

- 界面上的 185 是浏览器统计的资料文字字符数。输入 token 由模型计量，包含生成提示、文档文本以及图片的模型输入用量。字符数和图片文件字节数都不能直接当成 token 数。
- `maxTokens` 是我们为一次请求设置的输出上限。按公开文档，实际有效上限取请求上限、模型上限和传输路径上限的最小值。同步 `llm.complete` 的路径上限为 8192。部分模型的推理用量会占用输出预算。
- Anna 响应提供 `model`、`usage.inputTokens`、`usage.outputTokens`、`_meta.quotaConsumed`，以及平台支持时的实际上限与限制来源。推理用量只有提供商返回时才可取得。含图请求的模型偏好用于路由，历史扣费不能仅凭偏好推断。
- CU 是用户账户的计费额度。公开说明确认按实际使用的模型计量，本次查证未找到适用于 staging 文本补全的完整 token 到 CU 公式、取整规则及统一失败退款承诺。额度预检查和请求的输出上限不能替代实际账单。 [Anna LLM 返回字段和上限](https://staging.anna.partners/developers/apps/llm-and-agent.md) · [Anna 平台团队对模型路由和计量的说明](https://forum.anna.partners/t/model-routing-and-access-for-non-pro-users-when-an-agent-session-requests-gemini-3-5-flash/249)

## 这次 14 CU 能确认什么

在 `0.1.1` 的 5 页请求里，BriefDeck 配置的上限是 `5 × 300 = 1500` 输出 tokens。Anna 返回的 `stopReason` 为 `maxTokens`，触发了 BriefDeck 自己写的截断提示。原提示建议缩短笔记，容易误解为输入超限。用户报告消耗 14 CU，当时界面没有保存实际模型、有效上限、输入/输出或推理用量，无法据此反算账单。

`0.1.2` 中 5 页含图请求的配置上限为 3000，纯文字仍为 1500。它要求更紧凑的输出，平台提供用量时也会在失败提示里显示。真实修复效果仍待复测，输出上限也不等于 CU 上限。 [M2.3 失败证据](TEST-CASES.md) · [实际额度记录](DELIVERY.md)

## 可避免的扣费

本地预检可以保证可提前发现的输入错误不发模型请求。回归用模拟宿主验证，真实超时或失败后保留原稿，由用户决定是否再发一次。模型已经执行后的截断、无效 JSON 或收到结果之前的网络中断，都不能据界面报错判断费用为零。若需要核对历史 14 CU，应先查现有账单明细中的模型与用量，或由平台核对记录。再次生成无法还原旧请求的扣费明细。
