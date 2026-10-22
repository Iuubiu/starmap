-- 重判日志（票 11 验收 5：「学满 3 个知识点后自动重判并可升降级」）。
--
-- 为什么要单独一张表而不是往 `placement_profile` 上加一列说明：
-- 重判是**可能发生多次**的事件（每学完 3 个知识点一次），而 `placement_profile`
-- 是单行「当前状态」表。把「上一次重判」塞进状态表会丢掉历史，而回答
-- 「我的档位为什么是 P2」恰恰需要那条历史 —— 只存当前档位是答不出来的。
--
-- 历史在这里只是审计与解释用；「当前档位是怎么来的」由
-- `placement_profile.last_rejudge_id` 精确指向。这两个东西不能只留一个：
-- 只有指针就丢了历史，只有日志就无法区分「这个档位是重判来的」还是
-- 「刚重新定级过，上次重判已经作废」。
CREATE TABLE IF NOT EXISTS app.placement_rejudges (
  id bigserial PRIMARY KEY,
  previous_tier text NOT NULL CHECK (previous_tier IN ('P1', 'P2', 'P3')),
  tier text NOT NULL CHECK (tier IN ('P1', 'P2', 'P3')),
  -- 触发这次重判的「自上次定级/重判以来学完的知识点数」
  learned_kp_count integer NOT NULL CHECK (learned_kp_count >= 0),
  -- 首轮正确率：没有可算的样本时为 NULL（不是 0 —— 0 意味着「全错」）
  average_first_try_rate double precision CHECK (
    average_first_try_rate IS NULL
    OR (average_first_try_rate >= 0 AND average_first_try_rate <= 1)
  ),
  explanation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS placement_rejudge_created_idx ON app.placement_rejudges (created_at DESC);

-- 当前档位由哪一次重判得出。重新定级时置 NULL（档位回到「这次的定级结果」），
-- 于是界面不会在重新定级之后还把上一次重判的「P1 → P2」当成现状展示。
ALTER TABLE app.placement_profile
  ADD COLUMN IF NOT EXISTS last_rejudge_id bigint REFERENCES app.placement_rejudges (id) ON DELETE SET NULL;
