-- 票 08：结构化回合的持久化。
--
-- 为什么回合要落库：票 08 的验收是「产物卡有名字、持久、可回看（同会话内）」。
-- 前端把卡放在 React state 里也能"看起来"满足，但刷新就没了 —— 而学习日志
-- 恰恰是**越用越值钱**的东西。所以卡片的完整快照存 jsonb，回看时原样重放，
-- 不重新调模型（重放会漂移：同一个问题两次生成的卡不一样，学生看到的历史
-- 会自己变形）。
--
-- 为什么不复用 app.learning_log：那张表是**事件流**（event + payload），按
-- 微知识点索引，用途是掌握度计算与统计。回合是**呈现单元**（一张卡、一句
-- 可见回复、一组依据），需要按 session 有序、需要卡片快照、需要外键到证据。
-- 混进 learning_log 会让「查某个知识点的学习事件」被卡片正文撑爆。

CREATE TABLE IF NOT EXISTS app.agent_turns (
  id                     text PRIMARY KEY,
  session_id             text NOT NULL REFERENCES app.sessions(id) ON DELETE CASCADE,
  -- 会话内序号。用它排序而不是 created_at：同一毫秒内两个回合在测试里很常见，
  -- 时间戳相同会让回看顺序随机，测试也就随机失败。
  ordinal                int NOT NULL CHECK (ordinal >= 1),
  utterance              text NOT NULL,
  visible_response       text NOT NULL,
  visible_response_kind  text NOT NULL
                         CHECK (visible_response_kind IN ('probe_question', 'statement')),
  -- error_card 不是第四种产物卡，而是降级形态：模型反复吐非法 JSON 时的可读兜底。
  -- 它照样占一行、照样能回看 —— 否则"失败的那轮"在日志里凭空消失，学生会以为
  -- 自己没提交过。
  artifact_kind          text NOT NULL
                         CHECK (artifact_kind IN ('level_card', 'graph_focus', 'progress_change', 'probe_form', 'error_card')),
  card_title             text NOT NULL,
  degraded               boolean NOT NULL DEFAULT false,
  -- 只有 0 或 1：票 08 只允许重试一次。存下来是为了让「降级率」可统计。
  retry_count            int NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 1),
  -- 卡片整体快照。走契约 schema 校验过才写入，所以读出来可以直接渲染。
  artifact               jsonb NOT NULL DEFAULT '{}'::jsonb,
  language_check         jsonb NOT NULL DEFAULT '{}'::jsonb,
  micro_kp_id            text REFERENCES app.knowledge_points(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, ordinal)
);

CREATE INDEX IF NOT EXISTS agent_turn_session_idx
  ON app.agent_turns (session_id, ordinal);

-- 「看依据」按钮的数据源。**存的是当轮的判定结果，不是重新检索的结果**：
-- 掌握度会变，重新检索会给出不同的门控结论，于是学生点开会发现当初看到的
-- 解释和现在对不上。依据必须是历史事实。
CREATE TABLE IF NOT EXISTS app.agent_turn_evidence (
  turn_id          text NOT NULL REFERENCES app.agent_turns(id) ON DELETE CASCADE,
  chunk_id         text NOT NULL REFERENCES app.chunks(id) ON DELETE CASCADE,
  -- BM25 分数是浮点，但用 numeric 存：float8 的相等比较在测试里会咬人。
  score            numeric NOT NULL DEFAULT 0,
  is_answer_chunk  boolean NOT NULL,
  allowed          boolean NOT NULL,
  gate_tier        text NOT NULL CHECK (gate_tier IN ('background', 'scaffold', 'full')),
  -- 被排除的具体原因（票 09 验收）。allowed 为真时这里必须是 NULL，
  -- 由约束保证，而不是靠调用方记得写 NULL。
  exclusion_reason text,
  CONSTRAINT agent_turn_evidence_reason_matches_allowed
    CHECK ((allowed AND exclusion_reason IS NULL) OR (NOT allowed AND exclusion_reason IS NOT NULL)),
  PRIMARY KEY (turn_id, chunk_id)
);
