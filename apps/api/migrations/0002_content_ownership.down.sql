-- 提交新知识点树与产物结构前的**不破坏性**回滚：
-- 只删这次新增的列，不动 0001 建的表与数据。
ALTER TABLE app.chunks DROP COLUMN IF EXISTS micro_kp_id;
ALTER TABLE app.kp_edges DROP COLUMN IF EXISTS evidence_detail;
ALTER TABLE app.knowledge_points DROP COLUMN IF EXISTS source_page;
ALTER TABLE app.knowledge_points DROP COLUMN IF EXISTS source_id;
DROP INDEX IF EXISTS app.chunk_kp_idx;
DROP INDEX IF EXISTS app.chunk_page_idx;
