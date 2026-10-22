-- 回滚 0012_node_unlocks.sql。
--
-- **有损**：删掉表就丢掉了「哪些节点已经解锁、什么时候、被哪张关卡放行」。
-- 代价是回滚之后所有下游节点重新变回锁定 —— 已经学过的学生会看到自己刚学完
-- 的下一节又锁上了。学习日志（`learning_log` 的 gate_* 事件）不受影响，
-- 所以解锁结论可以从事件流重放补回来；日志是证据，这张表是可重建的派生态，
-- 只是不每次现算。
--
-- 之所以仍然照删：把表留在库里而迁移被记为「已回滚」，下次 up 时
-- `CREATE TABLE IF NOT EXISTS` 什么都不做，schema 与版本表就会永久不一致。
--
-- 不碰 `learning_log`（0001 的表）与 `levels` / `knowledge_points`。

DROP INDEX IF EXISTS app.node_unlocks_prereq_idx;

DROP INDEX IF EXISTS app.node_unlocks_level_idx;

DROP TABLE IF EXISTS app.node_unlocks;
