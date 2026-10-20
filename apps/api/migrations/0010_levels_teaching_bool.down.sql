-- 回滚 0010：删掉手写教学关卡及其题目。
--
-- 只删本迁移自己创建的行，不碰学科/模块/知识点主干 —— 那些被其它测试与
-- 种子数据依赖，删它们会让回滚变成有损操作。levels → level_items 有
-- ON DELETE CASCADE，但这里仍显式删题目：回滚脚本要能在「有人手工 drop 过
-- 约束」的库上也正确执行。
--
-- 关于 seed.sql 的演示关卡：它曾经有两条（lv-bool-1 / it-bool-1），已由
-- 0004_drop_stale_seed_level.sql 删除（缺 spec，点开即 500）。所以这里没有
-- 「要不要碰它们」的取舍了 —— 它们不存在。

DELETE FROM app.level_items WHERE level_id = 'lv-bool-laws';
DELETE FROM app.levels WHERE id = 'lv-bool-laws';
