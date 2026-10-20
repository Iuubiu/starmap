-- 回滚 0010：删掉手写教学关卡及其题目。
--
-- 只删本迁移自己创建的行，不碰 seed.sql 的演示数据（lv-bool-1 / it-bool-1）
-- 与学科/模块/知识点主干 —— 那些可能已被 seed 或后续关卡引用，删它们会让
-- 回滚变成有损操作。levels → level_items 有 ON DELETE CASCADE，但这里仍显式
-- 删题目：回滚脚本要能在「有人手工 drop 过约束」的库上也正确执行。

DELETE FROM app.level_items WHERE level_id = 'lv-bool-laws';
DELETE FROM app.levels WHERE id = 'lv-bool-laws';
