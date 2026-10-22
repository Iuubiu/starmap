-- 0013_review_schedule 的回滚脚本。
--
-- 顺序：先删引用 review_rounds 的列与索引，再删明细表，最后删会话表 ——
-- 反过来会被外键挡住。
--
-- 丢的是排期（`review_stage` 与 `next_review_at` 的值）与复验会话记录，
-- 掌握度本身（achieved / current / attempts）不受影响：回滚之后学习者
-- 不会「忘记」学过什么，只是不再被排期抽考。
--
-- `next_review_at` 列**不删**：它由 0003 建、由 0003 的 down 负责删。
-- 本脚本只把自己写进去的值清空，把列的存在权还给建它的那个迁移。

DROP INDEX IF EXISTS app.attempt_review_round_idx;

ALTER TABLE app.attempts
  DROP COLUMN IF EXISTS review_round_id;

DROP TABLE IF EXISTS app.review_round_items CASCADE;
DROP TABLE IF EXISTS app.review_rounds CASCADE;

DROP INDEX IF EXISTS app.review_round_created_idx;
DROP INDEX IF EXISTS app.review_round_item_kp_idx;

ALTER TABLE app.mastery
  DROP CONSTRAINT IF EXISTS mastery_review_stage_range;

ALTER TABLE app.mastery
  DROP COLUMN IF EXISTS review_stage;

UPDATE app.mastery
   SET next_review_at = NULL
 WHERE next_review_at IS NOT NULL;
