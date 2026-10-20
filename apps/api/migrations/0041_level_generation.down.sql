-- 回滚 0041：按依赖反序拆掉触发器、函数、两张表。
--
-- 触发器必须先删：它引用 app.levels.spec 与函数，函数体里又引用了列名。
-- 表之间是 level_generation_task → level_generation_run 的外键，删表顺序
-- 反过来会因依赖失败。
--
-- 刻意**不**回滚「回填」那一步：迁移把历史 ai 关卡里非 practice 的题降级到
-- practice 了，回滚时把它们改回原样需要知道原值，而迁移没留快照。把题留在
-- practice 池是安全方向（最多是少了几道判定题），改回判定池则可能把 AI 生成
-- 的题重新塞进判定池 —— 那正是这张票要防的事。宁可少回滚一步，不做危险回滚。
DROP TRIGGER IF EXISTS levels_ai_practice_only ON app.levels;
DROP FUNCTION IF EXISTS app.enforce_ai_practice_only();

DROP TABLE IF EXISTS app.level_generation_task;
DROP TABLE IF EXISTS app.level_generation_run;
