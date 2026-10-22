-- 票 10：苏格拉底追问会话的持久化。
--
-- 为什么状态机要落库：追问是**跨请求**的多轮交互，每轮由非 LLM 策略核心
-- 决定下一步。如果状态只在进程内存里，服务重启、测试并行、或者前端刷新都会
-- 让计数器归零 —— 于是「连续 3 次答不上就退出追问」变成「连续 3 次不刷新页面
-- 才退出」，验收就名存实亡。
--
-- 为什么存 jsonb 而不是把每个计数器拆成列：状态机的形状属于 `packages/engine`
-- （纯函数、有测试、还在演进）。数据库跟着它拆列，每次引擎加一个计数器就要
-- 一次迁移。这里只需要「按 probeId 拿回完整状态」，不需要按计数器查询，所以
-- 整块存快照。真正需要按列查的只有 probe_id / micro_kp_id / 时间和越界统计，
-- 那些单独成列。

CREATE TABLE IF NOT EXISTS app.probe_sessions (
  id             text PRIMARY KEY,
  micro_kp_id    text NOT NULL REFERENCES app.knowledge_points(id) ON DELETE CASCADE,
  tier           text NOT NULL CHECK (tier IN ('P1', 'P2', 'P3')),
  session_id     text REFERENCES app.sessions(id) ON DELETE SET NULL,
  -- `LadderState` 快照（packages/engine/src/probe-ladder.ts）。
  state          jsonb NOT NULL,
  -- 已经问过的问题，用于「降级后换动作而非重复同一个问题」的判定。
  asked_questions text[] NOT NULL DEFAULT '{}',
  turns          int NOT NULL DEFAULT 0 CHECK (turns >= 0),
  exited         boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS probe_session_kp_idx
  ON app.probe_sessions (micro_kp_id, updated_at DESC);

-- 每一轮的留痕。指标接口「按拒绝原因分类统计越界」需要它，而越界判定是
-- **独立 judge** 的产物 —— judge 会换版本、判定标准会调，所以判定结果必须
-- 跟着回合存下来；否则历史统计会随 judge 升级整体改写。
CREATE TABLE IF NOT EXISTS app.probe_turns (
  id             bigserial PRIMARY KEY,
  probe_id       text NOT NULL REFERENCES app.probe_sessions(id) ON DELETE CASCADE,
  ordinal        int NOT NULL CHECK (ordinal >= 1),
  reply_text     text NOT NULL,
  reply_kind     text NOT NULL
                 CHECK (reply_kind IN ('correct', 'partial', 'wrong', 'dont_know', 'give_up', 'frustration')),
  action         text NOT NULL
                 CHECK (action IN ('acknowledge', 'hint', 'probe_deeper', 'reteach', 'reveal', 'exit')),
  action_reason  text,
  question       text,
  -- judge 的结构化输出（ProbeJudgeVerdict）。`passed` 单独成列，
  -- 让「越界率」能一条 SQL 算出来，不必每次展开 jsonb。
  judge          jsonb NOT NULL DEFAULT '{}'::jsonb,
  judge_passed   boolean NOT NULL DEFAULT true,
  -- 拒绝原因数组**冗余成 text[]**：这是被统计的维度，值得索引。
  reject_reasons text[] NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (probe_id, ordinal)
);

CREATE INDEX IF NOT EXISTS probe_turn_session_idx
  ON app.probe_turns (probe_id, ordinal);
CREATE INDEX IF NOT EXISTS probe_turn_violation_idx
  ON app.probe_turns (judge_passed) WHERE NOT judge_passed;
