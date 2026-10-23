-- 0072: 一轮对话的「决策链」快照。
--
-- 为什么落库而不是只渲染在内存里：界面上展示的链必须能被逐字段核对
-- （探针会把界面文本与这一列比对）。只存内存的话，刷新即失、也无法回看
-- 历史某一轮到底注入了哪个 skill、命中了哪些 chunk。
--
-- 为什么是 jsonb 而不是宽表：链条由四段异构结构组成（技能注入 / 检索命中 /
-- 判定 / 模型），每段字段还在演化，宽表会逼着每加一项就改迁移。
ALTER TABLE app.agent_turns
  ADD COLUMN IF NOT EXISTS trace jsonb;

COMMENT ON COLUMN app.agent_turns.trace IS
  '本轮的决策链快照：{skills[], retrieval[], decisions[], model{}}。只记录本项目自己做出的决定与可得的模型元数据；模型未返回 reasoning 时 model.reasoning 为 null，界面须显示「未返回」而不是编造。';
