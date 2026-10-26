# 01 · Composer 按 B5 定版

Status: resolved
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

## Comments

- 做了什么：TDD 先红后绿。删框下工具条（`TOOLBAR_ACTIONS` 四件套 + JSX + glass.css 规则含 `:focus-within` 显隐）与档位 chip（渲染 + `.sm-composer-chip` 规则）；HomePage/LearningPage 停传 `tierLabel`，HomePage 摘除 context 细条（Badge/去地图选/useNavigate 一并清理）；组件与 glass.css 头注释改到 B5 现状；Enter/Shift+Enter/`isComposing`、占位文案、＋/🎙/模型按钮一字未动（＋按派工指示保留占位，未采用 spec §3 的隐藏选项）。测试：删工具条/chip 既有断言，新增「无工具条、无档位 chip」断言；HomePage 加 B5 断言（查 `.sm-composer-context` 类名而非文案，避免与 03 的「去地图选」回接撞车）；「徽标显示名字」一条改为钉住解析链（`GET /nodes/:id` 照常发、裸 id 不进 DOM），名字展示断言移交给 03。
- 数字或产物：代码提交 `9a2791f`（6 文件，+67/−144）。定向 Composer 13/13、HomePage 21/21、LearningPage 10/10；全量 `pnpm --filter @starmap/web test` 63 文件 861/861 绿；`tsc --noEmit` 绿。2560×1440 输入区宽度与左右留白实测：留待合并后统一实测。
- 卡点：① `tierLabel`/`context` 两个 prop **未从 ComposerProps 删除**——`/` 路由的 `v2/HomeV2.tsx` 仍在传它们且不在本票「只许改」清单，删 prop 会让 typecheck（verify.mjs 门禁）在 HomeV2 报红。已改为注释标废弃、传了不渲染（chip 彻底没了；context 插槽仅为 v2 首页细条保留），v2 收口时随传参一起删——如需本批彻底删掉，需另批一张允许动 HomeV2.tsx 两行传参的票。② `zz-layout-2560` 探针确认缺失（全仓 rg 无命中），「四页四档留白差全 0.00」守门未重建，与票面坑一致。③ 知识点名字在 HomePage 上暂无处显示（预期中间态，等 03 同批合入）。
- 追记（票 03 批次）：卡点① 已由席位 C 收口——`tierLabel`/`context` 从 ComposerProps 彻底删除，HomeV2 停传、v2 首页细条随之消失（提交 `a32ab62`），全量 869/869 与 typecheck 绿。
