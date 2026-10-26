# 08 · 章节路径 ancestors（契约→后端→前端）

Status: pending（第二批）
Spec: `../spec.md` §2 T8

## 输入

- `packages/api-contract/src/domains/graph.ts`（`NodeDetailResponseSchema`）
- 后端 nodes 详情（按 depth 回溯祖先名）
- 前端「正在学」卡（03 的产物）

## 做什么

`NodeDetailResponse` 加 `ancestors: string[]`（章/节名数组，不含自身，根在前）。
「正在学」卡第二行从「书名页码」升级为「章 · 节」（mockup：「逻辑代数 · 第 1 章」），书名页码降为次行或悬浮。

## 输出

契约 + 后端 + 前端，一并提交。

## 判据

1. `pnpm contract:check` 绿。
2. 抽 3 个不同 depth 的节点断言祖先链正确（章/节/小节三级）。
3. 手工 kp（无祖先/无来源）降级显示 pageLabel 或空，不报错。
4. web/api 测试绿。
