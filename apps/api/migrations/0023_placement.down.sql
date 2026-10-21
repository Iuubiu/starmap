-- 0023_placement 的回滚脚本。
--
-- 顺序与建表相反（先删子表再删父表），虽然 CASCADE 也能删，但显式写出来
-- 是为了让「谁引用谁」在回滚脚本里也读得出来 —— 回滚脚本是事故现场唯一的
-- 说明书，不该依赖读者脑补级联关系。
DROP TABLE IF EXISTS app.placement_profile CASCADE;
DROP TABLE IF EXISTS app.placement_answers CASCADE;
DROP TABLE IF EXISTS app.placement_sessions CASCADE;
