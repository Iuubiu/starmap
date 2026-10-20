-- 0020_agent_turns 的回滚脚本。
--
-- 只回滚本迁移建的表：evidence 先删（外键指向 turns）。
DROP TABLE IF EXISTS app.agent_turn_evidence CASCADE;
DROP TABLE IF EXISTS app.agent_turns CASCADE;
