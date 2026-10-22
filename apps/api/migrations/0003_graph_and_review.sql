-- 知识图谱一次全量查询所需的索引，以及复验排期的落点列。
--
-- 两件事：
--
-- 1. `kp_edges` 的主键是 (from_id, to_id, kind)，只覆盖了 from_id 前缀。
--    `GET /api/v1/graph` 不按方向过滤（先修关系对学习者是双向的：既要知道
--    「我得先学什么」，也要知道「学完能解锁什么」），所以两个方向都要扫。
--    现有 52 条边时全表扫无所谓，但设计按 2000+ 节点走（spec 第 27 行），
--    届时是数千条边，to_id 方向没有索引就是每次请求一次 seq scan。
--
-- 2. `app.mastery.next_review_at`：票 07 的间隔排期（1/3/7/21/60 天）要写
--    的时间戳。本票（03）只读它来决定画布上「需复验」那一档颜色。**加列的
--    是 03，写列的是 07**——契约里为此暴露 `reviewDueAt` 而不是一个由图谱
--    服务自行推断的布尔值：票 07 验收第 5 条要求「图谱上说需复验时必须真的
--    到期」，两边共用同一列、同一个 `<= now` 比较，才不会有第二套判定。
--
-- 加列放在 03 而不是等 07：列是只读契约（`GraphNodeSchema.reviewDueAt`）的
-- 一部分，契约先落地才能让画布的四种状态可测（否则「需复验」那一色没有数据
-- 来源，只能靠假数据测）。07 落地时只写值，不动形状。
--
-- 回滚见 0003_graph_and_review.down.sql。

CREATE INDEX IF NOT EXISTS kp_edge_to_idx ON app.kp_edges (to_id);
CREATE INDEX IF NOT EXISTS kp_edge_from_kind_idx ON app.kp_edges (from_id, kind);
CREATE INDEX IF NOT EXISTS kp_edge_to_kind_idx ON app.kp_edges (to_id, kind);

ALTER TABLE app.mastery ADD COLUMN IF NOT EXISTS next_review_at timestamptz;

-- 复验抽取要问的是「现在有哪些已掌握的知识点到期了」，这是一个按时间范围
-- 过滤的查询；部分索引只收录排过期的行（绝大多数行是 NULL，不必进索引）。
CREATE INDEX IF NOT EXISTS mastery_review_due_idx
  ON app.mastery (next_review_at)
  WHERE next_review_at IS NOT NULL;
