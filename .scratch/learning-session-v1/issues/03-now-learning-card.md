# 03 · 右栏「正在学」卡

Status: resolved
Spec: `../spec.md` §2 T3

## 输入

- `apps/web/src/components/StudySidebar.tsx`
- `apps/web/src/api/queries/graph.ts` 的 NodeDetail（`pageLabel`、`levels` 已有）

## 做什么

右栏新增「正在学」卡，承接 01 摘除的细条：

- 知识点名（`microKpName`，沿用现有取值链：`nodeItems.find(...)?.name ?? focusedNode.payload?.node.name ?? focusedKpId`）
- 来源行：`pageLabel` 服务端拼好的整句，**前端不拼**
- 关卡入口：`node.levels` 非空 → 「打开关卡」按钮跳对应路由；空 → 「还没有关卡，说一句让我生成」（只提示，不自动生成）
- 保留「去地图选」入口（07 落地前是唯一切换方式）

## 输出

卡片 + 测试。

## 判据

1. 未选知识点：沿用现有引导句（「还没选知识点：先在下面说一句你想学什么」）。
2. 选定后：名 / pageLabel / 关卡按钮或提示，三者有测试断言。
3. 无 source 的手工知识点（kp-bool 等 3 个）：pageLabel 位降级为空，不报错不 404。
4. `pnpm --filter @starmap/web test` 相关文件全绿。

## 坑

StudySidebar 头注释与测试口径写着「知识点名不在侧栏重复出现」——那是细条存在时的决定，
本票落地后一并改注释与口径。

## Comments

- 做了什么：新建 `NowLearningCard`（名 / pageLabel 整句透传 / 关卡入口两态 / 去地图选）
  挂在 StudySidebar 最顶（B5 顺序：正在学→档位→进度→上限）；HomePage 传 `focusedKpId`，
  卡内自调 `useNodeDetail` 取 pageLabel 与 levels（与页面详情请求同 key 去重）；
  「知识点名不在侧栏出现」的旧注释与测试口径一并作废；顺手做了席位 A 移交的清理
  （Composer 删 tierLabel/context 两个废弃 prop，v2 细条随之消失，单独一笔 a32ab62）。
- 数字：StudySidebar 38/38、HomePage 22/22、全量 63 文件 869/869 绿，typecheck 绿；
  新增 7 条用例（未选引导句 / 名+pageLabel+关卡按钮 / 两个路由跳转 / levels 空 / source null
  降级 / 首页 ?kp= 集成）。代码：fdc1d49、a32ab62。
- 卡点：无。2560 实测留待合并后统一实测。
- 追记（2026-10-26 合并后统一实测）：**本票的卡经票 09 集成才真正上线路由**——原实现挂在 `StudySidebar`，其唯一消费方 `pages/HomePage.tsx` 已无路由（票 96 起 `/` 是 `HomeV2`），组件全绿但产品不可见；`7d6201a` 把四卡接进 HomeV2 右栏，并放宽 `microKpId/microKpName` 到 null 态（冷启动即可搜索）。2560×1440 实测：`[data-study-now]` 在场；冷启动引导句与「换个知识点/去地图选」入口俱在；带上 `?kp=` 后名字/来源行/关卡入口渲染正常；`Rail` 自带的同名「正在学」块（按掌握度自选点、旧三行门槛）以 `showKpProgress={false}` 隐藏，全页「正在学」标题恰好 1 个（`fd2dfa6`）。全页无横向溢出，右栏 aside x=1682.11 / w=865.89。
