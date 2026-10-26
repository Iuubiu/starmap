# 07 · 知识点搜索：按名字或页码

Status: claimed
Spec: `../spec.md` §2 T7

## 输入

- `packages/api-contract/src/domains/graph.ts`（`NodeStateSchema` 加可选 `sourceTitle`、`page`）
- 后端 nodes 列表（join `app.sources`）
- 前端：新索引模块（建议 `apps/web/src/graph/`）+「正在学」卡「换个知识点」入口（03 的产物）

## 做什么

- 契约：列表项带书名与印刷页码（消歧与页码搜的必要数据；详情接口已有同义字段，列表缺）。
- 前端：`GET /nodes` 全量（enabled 约 4030）建本地索引，输入即时过滤：
  文本按名字子串（含书名消歧后缀）；纯数字输入按页码命中。
- 入口在「正在学」卡的「换个知识点」，弹层列表选择后与现有 `focusedKpId` 状态链对接。

## 输出

契约 + 后端 + 索引模块 + 入口，一并提交。

## 判据

1. 输入「吸收律」→ 结果 ≥1 且每条带书名消歧（多书同名时能区分）。
2. 纯数字输入能按页码命中对应节点。
3. 200ms 内出结果（本地索引不发请求；探针实测数字写回执）。判据口径对齐 NEXT-MILESTONE M2。
4. 空结果显示「没找到这个知识点」，不是空白面板。
5. `pnpm contract:check` 绿 + web/api 测试绿。

## 坑

重名节点大量存在（`信号`、`小结`）。`sourceTitle` 不进列表契约，消歧就做不出来——
它是本票必要部分，不是可选优化。索引模块写成可复用的，M2（地图找点）将来直接用。

## Comments

- 2026-10-26（席位 D）：**契约+后端半边完成**（提交 b3f2d53）。`NodeStateSchema` 加 `sourceTitle`/`page`（必填但可为 null——null=手工知识点；不带 pageLabel 句子，列表是给索引的数据）。后端列表 `LEFT JOIN sources`（27 行 PK 小表，查询数不增，「查询次数不随节点数增长」守卫测试仍绿；比 sources 读进 Map 再省一次往返）；`source_id` 有而书名/页码缺时复用详情的 `sourceOf` 抛 500（与详情同一数据缺陷纪律）。测试：nodes 套件 20 用例（新增 3 条：两态+page 对账 / 两本书同名「吸收律」消歧 / 坏来源行 500），apps/api 全量 45 文件 522 用例绿，`pnpm contract:check` 绿。前端索引模块、「换个知识点」入口、200ms 探针留给后续席位。
