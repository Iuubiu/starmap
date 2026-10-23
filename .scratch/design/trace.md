# 思维链与技能调用链的展示（t99 设计）

## 为什么不能直接“把 reasoning 显示出来”
`LlmPort` 当前只回 `{ text, parsed, usage }`（`apps/api/src/llm/llm.port.ts`），
`openai-compatible-llm.ts:67-72` 只取 `choices[0].message.content`。
是否拿到推理内容取决于上游模型：DeepSeek 推理模型在 `message.reasoning_content`，
普通模型根本不返回。所以**不能承诺“一定有思维链”**——拿不到就如实显示“该模型未返回推理内容”，
不允许用模板编一段看起来像推理的文字。

## 真正可记录、可展示的“链”（全部来自本项目自己的决策过程）
| 环节 | 数据来源 | 是否已有 |
|---|---|---|
| 用了哪些 skill | `turn.service` 组装 system message 时的 skill 注入清单 | 需落盘 |
| 检索到了什么 | 触发词门控 + `app.chunks` 查询命中的 chunk id / 知识点 / 关键词 | 需落盘 |
| 判定了什么 | placement tier、gating 结果、mastery 变更 | 部分已有 |
| 模型与耗时 | `LlmPort` 包装计时 + model id + token 用量 | 需新增 |
| 推理内容 | `message.reasoning_content`（有则存，无则 null） | 需新增 |

## 存储
迁移 `0071_turn_trace.sql`：`app.agent_turns` 增加 `trace jsonb`（默认 `'{}'`），
结构 `{ model, latencyMs, tokens, skills: string[], retrieval: [{chunkId, kpName, score}], gate, reasoning }`。

## 接口
`AgentTurnResponse` 增加可选 `trace`（不破坏旧客户端；契约里标 `optional`）。

## 界面
每张产物卡下方一行可折叠「这一轮是怎么来的」：
`技能 → 检索 → 判定 → 模型/耗时/用量 → 推理（若有）`。
默认折叠，展开后每段最多 5 条，超出显示「还有 N 条」。

## 验收（可测）
1. 一次真实提问后 `agent_turns.trace` 非空，且 `skills` 至少含 `socratic-tutor`；
2. `retrieval` 长度等于该轮实际注入的 chunk 数；
3. 模型不返回 reasoning 时，界面显示「该模型未返回推理内容」而不是空白或编造；
4. 折叠块默认收起，展开后内容与库内 `trace` 逐字段一致（探针比对，不靠肉眼）。
