# 01 · Composer 按 B5 定版

Status: ready-for-agent
Spec: `../spec.md` §2 T1（必读 §0：v1 = B5）

## 输入

- `apps/web/src/components/Composer.tsx`、`apps/web/src/theme/glass.css`（`.sm-composer-*`）、
  `apps/web/src/components/Composer.test.tsx`
- 引用处：`apps/web/src/pages/HomePage.tsx`、`apps/web/src/pages/LearningPage.tsx`

## 做什么

移除框下工具条（期刊下载器/文件/插件/视图切换，含 `TOOLBAR_ACTIONS`）与框内档位 chip
（`tierLabel` prop 及渲染）；输入区收成 B5 的一整块。占位文案与 Enter/Shift+Enter/`isComposing`
行为**不动**。＋/🎙/模型按钮保留（占位状态不变）。

## 输出

组件 + 更新的测试，一笔提交。

## 判据

1. 组件测试更新后全绿：删工具条/档位 chip 的既有断言，新增「无工具条、无档位 chip」断言。
2. 2560×1440 实测输入区宽度与左右留白，数字写回执（写进本文件 Comments）。
3. Enter/Shift+Enter/输入法拦截行为不变（相关测试语义不动）。
4. `pnpm --filter @starmap/web test` 全绿。

## 坑

- `zz-layout-2560` 探针仓里已找不到：动手前确认；缺失则按 NEXT-VERSION §13 的四数重建。
- 删除知识点细条后名字暂无处显示——本票**必须与 03 同批合入**（03 建「正在学」卡）。
  本票先把 `context` prop 及 HomePage 的细条 JSX 摘除，名字展示由 03 接回。
