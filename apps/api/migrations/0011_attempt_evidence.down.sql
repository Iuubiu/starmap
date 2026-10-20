-- 回滚 0011_attempt_evidence.sql。
--
-- 删六列与三个索引。**这会丢掉已经记录的作答用时、提示次数、关卡归属、
-- 知识类型（半衰期）与「这次算不算掌握度证据」的标记** —— 那是本迁移唯一
-- 承载的业务数据，回滚必然有损（标记丢了以后所有历史作答按默认值 true
-- 重算，深究段的作答会被补算进掌握度；类型丢了一律回落到占比最高者，等于
-- 抹平了事实类本该 14 天就衰减的差别）。所以有损回滚前应先导出 attempts。
-- 之所以仍然照删：把列留在
-- 库里而迁移被记为「已回滚」，下次 up 时 `ADD COLUMN IF NOT EXISTS` 什么
-- 都不做，schema 与版本表就会永久不一致，比丢数据更难查。
--
-- 不碰任何其它迁移加的东西（`next_review_at` 是 0003 的，`attempts` 表本身
-- 是 0001 的）。

DROP INDEX IF EXISTS app.attempt_kp_chrono_idx;
DROP INDEX IF EXISTS app.attempt_kp_variant_idx;
DROP INDEX IF EXISTS app.attempt_kp_item_idx;

ALTER TABLE app.attempts DROP CONSTRAINT IF EXISTS attempt_knowledge_kind_valid;
ALTER TABLE app.attempts DROP CONSTRAINT IF EXISTS attempt_hints_nonneg;
ALTER TABLE app.attempts DROP CONSTRAINT IF EXISTS attempt_latency_nonneg;

ALTER TABLE app.attempts DROP COLUMN IF EXISTS knowledge_kind;
ALTER TABLE app.attempts DROP COLUMN IF EXISTS counts_toward_mastery;
ALTER TABLE app.attempts DROP COLUMN IF EXISTS attempt_no;
ALTER TABLE app.attempts DROP COLUMN IF EXISTS hints_used;
ALTER TABLE app.attempts DROP COLUMN IF EXISTS latency_ms;
ALTER TABLE app.attempts DROP COLUMN IF EXISTS level_id;
