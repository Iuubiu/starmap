# 08 · 章节路径 ancestors（契约→后端→前端）

Status: claimed
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

## Comments

- 2026-10-26（席位 D）：**契约+后端半边完成**（提交 f76e1ff）。`NodeDetailResponseSchema` 加 `ancestors: string[]`（必填；空数组=无父，手工 kp 不报错）；后端递归 CTE 沿 `parent_id` 回溯，`depth` 升序即根在前，摘掉自身。给数组不给拼好的句子——分隔符是前端文案（见契约注释）。测试：nodes 套件 17 用例（新增 3 条：四级链 depth 0-3 根在前 / 一级父 / 手工 kp 空数组），apps/api 全量 45 文件 519 用例绿，`pnpm contract:check` 绿。前端「正在学」卡第二行接线留给后续席位。
