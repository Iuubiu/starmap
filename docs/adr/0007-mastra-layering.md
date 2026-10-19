# Mastra 的目录约定管「AI 资产」，NestJS 的模块边界管「业务用例」

Mastra 自己有目录约定（`agents/` / `workflows/` / `tools/` / `scorers/` / `skills/`，组装根是 `mastra/index.ts`），NestJS 也有自己的模块约定。两套约定都想当项目结构的组织者，直接叠加会得到「一个 feature 拆成两半、一半在 `src/features/x`、一半在 `src/mastra/agents/x-agent.ts`」的局面。

我们的分工是：**`src/mastra/` 只回答「AI 资产如何组装」，`src/features/` 只回答「业务用例如何组织」，两者在一个地方交汇——`MastraModule.register()`。** `src/mastra/index.ts` 因此不含业务逻辑，只做一个 `new Mastra({...})`。

## Considerations

替代方案是「按 Mastra 的目录做主子结构」（把业务也塞进 `src/mastra/`）或「完全无视 Mastra 约定」（自己发明一套流程目录）。前者会让 Mastra 升级时任何目录调整都波及业务代码；后者会失去官方的两条硬约定——`src/mastra/public` 打包行为与 `agents/<name>` 的文件式定义——且未来跟官方文档对不上。

## Consequences

- 业务代码**不直接** `import` `@mastra/core`，只经 `LlmPort` 接缝。这让 Mastra 的变动被关在一个适配器文件里。
- `src/mastra/` 下的 agent / workflow 是被 `index.ts` 组装的「资产」，不知道谁调用它们；业务侧通过 `MASTRA` token 或 `MastraService` 反向取用。
- 代价：一个功能横跨两个目录时，读代码的人要跳一次。这个跳转是明确且有名字的（`mastra/index.ts`），比「两套约定随机交织」好。
- **只有批处理走 Workflow**（批量生成关卡、内容索引重建）。单次生成直接调 `LlmPort`；追问循环走 `packages/engine` 纯函数。判据：是否需要跨进程、跨重启、或无人值守继续跑。
