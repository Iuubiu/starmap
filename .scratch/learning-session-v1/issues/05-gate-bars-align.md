# 05 · 门槛卡渲染对齐 mockup

Status: ready-for-agent
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
