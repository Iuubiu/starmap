-- 票 07：复验排期与复验会话。
--
-- ## 为什么排期是「存下来的时刻」而不是「待触发的闹钟」
--
-- `mastery.next_review_at`（列由 0003 建好，本票负责写值）是一行普通数据。
-- 「到期」这件事用 `next_review_at <= now` 这一个比较来判定，进程重启、
-- 多实例部署、漏跑一次都不会改变结论。反过来，用后台任务推进排期就必须
-- 自己维护「上次跑到哪、漏跑怎么补、多实例只跑一次」，这三种错法都难被发现
-- （见 ADR-0003：时序决策写在纯函数里，不做成后台任务）。
--
-- 代价是「到期」只在有人查询的时候才有意义。对学习工作站这是成立的：
-- 没有人在看的时候也不需要提醒。
--
-- ## 为什么记 stage 而不只记上一次的时间
--
-- 间隔序列是 1/3/7/21/60 天。只知道「上次是什么时候」推不出「下一次该隔
-- 多少天」—— 同一个时刻可能是第 2 档也可能是第 4 档。stage 是序列上的位置，
-- 通过则 +1、未通过则 −1（票 07 验收第 2 条），必须自己占一列。
--
-- 区间夹在 0..4：4 是 60 天档，到顶就不再往后涨；0 是 1 天档，退到底也不再
-- 往前缩。夹在数据库里而不只夹在代码里，是因为 `advanceReviewSchedule`
-- 与手工修数据的运维脚本都要撞上同一个天花板。
--
-- ## 为什么复验会话要落库
--
-- 一次复验横跨多个知识点（票 07 验收第 1 条要求交错出现），判定「这次过没过」
-- 需要一份固定的题单：题单不能等到判分时再临时算 —— 那期间学习者可能又做了
-- 别的题，`selectReviewItems` 的输入变了，判出来的「哪几题」就与学习者看到的
-- 不是同一批。所以会话 id 与逐题清单先写下来，判分只读这份清单。
--
-- `rounds.correct_count` / `verdict` / `completed_at` 三个字段在判分那一刻一起
-- 写死，不随后续作答变化：复验记录要回答的是「当时那次复验的结果」，而不是
-- 「这个知识点现在怎么样」。
--
-- ## 回滚
--
-- 见 0013_review_schedule.down.sql。丢的是排期与复验会话，不是掌握度本身。

ALTER TABLE app.mastery
  ADD COLUMN IF NOT EXISTS review_stage integer NOT NULL DEFAULT 0;

ALTER TABLE app.mastery
  DROP CONSTRAINT IF EXISTS mastery_review_stage_range;
ALTER TABLE app.mastery
  ADD CONSTRAINT mastery_review_stage_range
  CHECK (review_stage >= 0 AND review_stage <= 4);

-- 一次复验会话。
--
-- `micro_kp_ids` 冗余成数组：列表页要显示「这次复验覆盖了哪几个知识点」，
-- 不必为一行会话再 join 一次明细表。明细表仍然是真源，这里只是便于读。
CREATE TABLE IF NOT EXISTS app.review_rounds (
  id            text PRIMARY KEY,
  micro_kp_ids  text[] NOT NULL DEFAULT '{}',
  item_count    integer NOT NULL CHECK (item_count >= 0),
  correct_count integer CHECK (correct_count IS NULL OR correct_count >= 0),
  verdict       text CHECK (verdict IN ('passed', 'failed')),
  -- 每个知识点各自的判定与推进结果。判分只发生一次，结果整块存下来：
  -- 重复请求（双击、刷新后重试）要能拿回同一份答案，而不是把 stage 再推一次。
  outcomes      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

-- 会话的逐题清单。`ordinal` 就是交错之后的呈现顺序 —— 复验要求多个知识点
-- 交替出现，顺序本身是内容的一部分，所以不能靠查询时的排序碰运气。
CREATE TABLE IF NOT EXISTS app.review_round_items (
  round_id     text NOT NULL REFERENCES app.review_rounds (id) ON DELETE CASCADE,
  ordinal      integer NOT NULL CHECK (ordinal >= 1),
  micro_kp_id  text NOT NULL REFERENCES app.knowledge_points (id) ON DELETE CASCADE,
  item_id      text NOT NULL REFERENCES app.level_items (id) ON DELETE CASCADE,
  variant_group text NOT NULL,
  PRIMARY KEY (round_id, ordinal)
);

CREATE INDEX IF NOT EXISTS review_round_item_kp_idx
  ON app.review_round_items (micro_kp_id);

-- 「这个知识点最近一次复验是哪一回」与「这一回考了哪几题」都要能按知识点查。
CREATE INDEX IF NOT EXISTS review_round_created_idx
  ON app.review_rounds (created_at DESC);

-- 作答与复验会话的关联。可空：普通作答不属于任何复验。
-- 判分时按 `review_round_id = $1` 聚合，不再去猜「这段时间内的作答算不算」。
ALTER TABLE app.attempts
  ADD COLUMN IF NOT EXISTS review_round_id text REFERENCES app.review_rounds (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS attempt_review_round_idx
  ON app.attempts (review_round_id)
  WHERE review_round_id IS NOT NULL;
