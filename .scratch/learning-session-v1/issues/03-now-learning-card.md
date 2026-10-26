# 03 · 右栏「正在学」卡

Status: pending（依赖 01 同批合入、02/04/05 批次合入后开工）
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
