-- 回滚 0006：删列。
--
-- `is_answer_key` 是**目录的派生标记**（`tools/ingest/toc.py::is_answer_key_title()`
-- 从 toc.json 的 `answerKey` 字段算出，12 本实测精确命中 4 条），不是学习者数据，
-- 删掉之后重跑一遍导入就能原样重建。所以这里不需要保留数据、不需要搬运、不需要
-- 写「删之前先备份」那种注释 —— 与 0005 那种「删的是别人产生的证据」不同。
--
-- 索引随列一起被 DROP COLUMN 带走（PostgreSQL 会把依赖该列的索引一并删除），
-- 显式再写一条 DROP INDEX 反而是噪声；这里用 IF EXISTS 只为让在
-- 「已手工删过列」的库上重复执行不报错。
ALTER TABLE app.knowledge_points
  DROP COLUMN IF EXISTS is_answer_key;
