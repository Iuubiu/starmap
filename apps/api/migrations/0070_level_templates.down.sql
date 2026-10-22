-- 回滚 0070：撤掉模板与导入导出带来的三列、两条索引与一条 CHECK。
--
-- 顺序按依赖反序：先删索引（它们引用列），再删 CHECK（引用 origin 列），
-- 最后删列。反过来会因「索引依赖的列不存在」失败。
--
-- 刻意**不**回填 origin 的变更：迁移把 `spec.meta.author = 'ai'` 的历史行从
-- 'system' 改成了 'ai'，回滚时改回 'system' 只是把标签换个名字 —— 列本身马上
-- 就要被删掉，改了也没有任何读端。这与 0041 的 down 里「不做危险回填」是同一
-- 个判断：回滚应该恢复**结构**，不该猜测历史值的意图。
DROP INDEX IF EXISTS app.level_origin_idx;
DROP INDEX IF EXISTS app.level_template_idx;
DROP INDEX IF EXISTS app.level_share_hash_imported_idx;

ALTER TABLE app.levels DROP CONSTRAINT IF EXISTS levels_origin_check;

ALTER TABLE app.levels
  DROP COLUMN IF EXISTS share_hash,
  DROP COLUMN IF EXISTS origin,
  DROP COLUMN IF EXISTS template_id;
