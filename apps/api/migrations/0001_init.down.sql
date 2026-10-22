-- 0001_init 的回滚脚本。
--
-- 顺序无关（全部 CASCADE），但按依赖倒序写便于阅读。
-- 不动 `mastra` schema：那里的表由 @mastra/pg 自己管理，我们只回滚自己的。
DROP TABLE IF EXISTS app.learning_log CASCADE;
DROP TABLE IF EXISTS app.sessions CASCADE;
DROP TABLE IF EXISTS app.mastery CASCADE;
DROP TABLE IF EXISTS app.attempts CASCADE;
DROP TABLE IF EXISTS app.level_items CASCADE;
DROP TABLE IF EXISTS app.levels CASCADE;
DROP TABLE IF EXISTS app.chunk_kp_answer CASCADE;
DROP TABLE IF EXISTS app.chunks CASCADE;
DROP TABLE IF EXISTS app.sources CASCADE;
DROP TABLE IF EXISTS app.kp_edges CASCADE;
DROP TABLE IF EXISTS app.knowledge_points CASCADE;
DROP TABLE IF EXISTS app.modules CASCADE;
DROP TABLE IF EXISTS app.subjects CASCADE;
DROP TABLE IF EXISTS app.schema_migrations CASCADE;
DROP SCHEMA IF EXISTS app CASCADE;
