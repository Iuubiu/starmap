-- 回滚 0003_graph_and_review.sql。
--
-- 只删本迁移自己加的东西，不碰任何数据行：索引与一个可空列，都没有承载
-- 业务数据（next_review_at 尚未被任何写路径填过；即便票 07 上线后回滚，
-- 丢的是排期缓存而不是掌握度本身——掌握度在 achieved/current/state 里）。

DROP INDEX IF EXISTS app.mastery_review_due_idx;
ALTER TABLE app.mastery DROP COLUMN IF EXISTS next_review_at;
DROP INDEX IF EXISTS app.kp_edge_to_kind_idx;
DROP INDEX IF EXISTS app.kp_edge_from_kind_idx;
DROP INDEX IF EXISTS app.kp_edge_to_idx;
