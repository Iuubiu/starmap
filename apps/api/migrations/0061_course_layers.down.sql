-- 0061 的回滚。
--
-- 顺序有讲究，倒着拆：
--
-- 1. 先把 `tier` 恢复成旧词汇表。**这一步必须在重新加上旧 CHECK 之前**，
--    否则旧 CHECK 一挂上，库里已有的 'foundation'/'core'/'advanced'/'method'
--    行就违反约束，ALTER 直接失败。
-- 2. 再拆列与索引（`DROP COLUMN` 会连带删掉建在该列上的索引，但显式写
--    `DROP INDEX` 是为了让 `check-migrations.mjs` 的「up 建的每个对象 down
--    之后都要没了」这条判据逐个对上，也为了单独跑这段 SQL 时语义完整）。
-- 3. 最后删表 —— 它被 `modules.course_layer_id` 引用，所以必须在拆列之后。
--
-- ## 为什么 tier 只能恢复成 'D'
--
-- 上行把 352 个书模块的 `tier` 从 'D' 改写成了课程层的 kind。回滚时**无法**
-- 反推哪一行原本是 'D'、哪一行是论文模块的 'C' —— 那个信息在 `course_layer_id`
-- 里（论文模块没有层，所以是 NULL；书模块有层）。于是判据是：
-- 有层的行 → 原本都是 'D'（`import-content.ts` 当时写死的值），置回 'D'；
-- 无层的行 → 保持不动（论文模块仍是 'C'）。
--
-- 这条判据成立的前提是「0061 之前所有书模块的 tier 都是 'D'」，这个前提写在
-- 0061_course_layers.sql 的文件头。若将来有别的来源也写 course_layer_id，
-- 这里要重新审。

UPDATE app.modules SET tier = 'D'
 WHERE tier IN ('foundation', 'core', 'advanced', 'method');

ALTER TABLE app.modules DROP CONSTRAINT IF EXISTS modules_tier_check;
ALTER TABLE app.modules
    ADD CONSTRAINT modules_tier_check
    CHECK (tier = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text]));

DROP INDEX IF EXISTS app.modules_course_layer_idx;
ALTER TABLE app.modules DROP COLUMN IF EXISTS course_layer_id;
DROP TABLE IF EXISTS app.course_layers;
