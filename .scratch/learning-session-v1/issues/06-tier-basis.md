# 06 · 档位判定依据句（契约→后端→前端）

Status: pending（第二批；02 落地后做）
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
