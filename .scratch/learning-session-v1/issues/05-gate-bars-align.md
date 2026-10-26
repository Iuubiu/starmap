# 05 · 门槛卡渲染对齐 mockup

Status: resolved
Spec: `../spec.md` §2 T5

## 输入

- `apps/web/src/components/StudySidebar.tsx` 的 `Row` 渲染与 `progressRowsFromView`

## 做什么

作答/变式两条 bar 的 label 带单位（「题/组」，单位来自 `KpProgressView.gates[].unit`，
服务端已给，前端不写死）。连对行：**06 未落地前保留第三行**；本票只把渲染口径对齐 mockup
（B4/B5 的双 bar 样式），不动数据源与取数路径。

## 输出

渲染调整 + 测试更新。

## 判据

1. 数据源不变（仍 `GET /mastery/kp/:id` → `KpProgressView`）。
2. 行 label + 单位断言更新（作答 X/8 题、变式 X/3 组）。
3. 「证据不足显示『—』不显示 0」的既有行为不变（null 语义测试不动）。
4. `pnpm --filter @starmap/web test` 相关文件全绿。

## Comments

- 做了什么：`StudySidebar.tsx` 的 Row 数值渲染改为「X / Y 单位」（mockup 的「5 / 8 题」「2 / 3 组」），单位取 `gates[].unit` 透传；连对行保留；数据源与取数路径未动；commit f8122ae。
- 数字：StudySidebar.test.tsx 32/32 绿（新增 3 例：带单位渲染 / 连对行保留 / unit 换成「次/套」的反例断言透传）；既有 null→「证据不足」用例未动且绿。
- 卡点：无。旧回退路径（页面未传 progress）无 unit 字段，按票面「前端不写死」显示维持「3 / 8」原样；HomePage 当前走的就是该回退路径，等票 89 的 progress 接线全量铺开后自动带单位。
