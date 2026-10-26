# 06 · 档位判定依据句（契约→后端→前端）

Status: claimed
Spec: `../spec.md` §2 T6

## 输入

- `packages/api-contract/src/domains/tier.ts`（`TierOverviewResponseSchema`）
- 后端 tier 用例（`apps/api`，回放定级/重评 + attempts）
- `apps/web` 档位卡（02 的产物）

## 做什么

`TierOverviewResponse` 加：

- `basis: string`——服务端拼好的中文句，形状对齐 mockup：「由 3 次作答判定 · 2 个变式已覆盖 · 连对 1/2」。
  先例：`NodeSourceSchema.pageLabel`（句子给人，字段给机器）。
- 数值字段 `basisAttempts` / `basisVariants` / `basisStreak`（机器可读）。

无定级记录（fallback）时 `basis` 为引导句（如「定级后这里会写判定依据」），不是空串。

## 输出

契约 + 后端 + 前端接线，`pnpm contract:check` 通过、生成客户端更新一并提交。

## 判据

1. `openapi.yaml` 可见新字段；`pnpm contract:check` 绿。
2. 有定级记录 / 无记录两态的 `basis` 整句各有后端测试。
3. 前端档位卡 why 行显示 `basis`；落地后 05 的连对行才允许删除（三门槛变两行）。

## Comments

- 2026-10-26（席位 D）：**契约+后端半边完成**（提交 9b811d9）。`TierOverviewResponseSchema` 加 `basis` / `basisAttempts` / `basisVariants` / `basisStreak`；后端回放证据窗＝自上次定级/重评以来的 attempts（`counts_toward_mastery=true` 最近 N 条），三个数字同窗，连对分母取本档 `masteryRule.consecutiveCorrect`（P3 是 1，有专测）。fallback 引导句「定级后这里会写判定依据」+ 三字段 0。测试：tier 套件 22 用例（新增 4 条：fallback 引导句 / 回放数字与整句 / P3 分母 / 零证据报 0），apps/api 全量 45 文件 516 用例绿，`pnpm contract:check` 绿（462 文件同步）。三个数字全部算得出来，无「宁缺毋滥」删项。前端接线（档位卡 why 行）留给后续席位。
