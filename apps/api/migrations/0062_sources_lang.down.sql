-- 回滚 0062：撤掉语料分离的两列与索引。
-- 注意：本迁移只加列，不动知识图谱数据；但「移除英文书知识点」那一步是
-- 数据操作（不是迁移），回滚数据请用 .scratch/db-before-drop-en-*.dump 或重新导入。
DROP INDEX IF EXISTS app.sources_enabled_idx;
ALTER TABLE app.sources
  DROP COLUMN IF EXISTS enabled,
  DROP COLUMN IF EXISTS lang;
