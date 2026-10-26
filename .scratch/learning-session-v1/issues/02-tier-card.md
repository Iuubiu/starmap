# 02 · 右栏档位卡

Status: resolved
Spec: `../spec.md` §2 T2

## 输入

- `apps/web/src/components/StudySidebar.tsx`（或新建 `TierCard` 组件挂进去）
- `apps/web/src/api/queries/tier.ts` 的 `useTierOverview()`（只读，已存在）

## 做什么

右栏新增档位卡：pill（P1/P2/P3）+ `label`（档位展示名）+ `source` 两态文案 + 固定句
「档位是测量结果，不能自选。」判定依据数字句（「由 3 次作答判定 · 连对 1/2」）属 06 票，本票不做。

## 输出

卡片组件 + 测试。

## 判据

1. `source='fallback'`：显示「还没定级，先按完整样例档教」；**不得**出现「你的水平是 P1」。
2. `source='placement'`：显示「由定级测得」。
3. 固定句「档位是测量结果，不能自选。」两态都在。
4. 不出现任何「切换档位」控件（契约无写接口，见 tier.ts 头注释）。
5. `pnpm --filter @starmap/web test` 相关文件全绿。

## Comments

- 做了什么：新建 `apps/web/src/components/TierCard.tsx`（pill + label + source 两态文案 + 固定句），挂进 StudySidebar 顶部，自调 `useTierOverview`；commit 0f00802。
- 数字：StudySidebar.test.tsx 26/26 绿（新增 fallback / placement / 无切换控件 / 接口失败占位 4 例），HomePage.test.tsx 20/20 绿。
- 卡点：无。判定依据句（「由 N 次作答判定」）按票面留给 06。
