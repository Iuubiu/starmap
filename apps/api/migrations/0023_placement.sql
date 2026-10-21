-- 票 11：初始定级的会话与作答留痕。
--
-- ## 为什么单独两张表，而不是复用 app.attempts
--
-- 票 11 验收第 6 条：「定级过程本身不产生掌握度记录（它不是练习）」。
-- 复用作答表是最省事的写法，也是**最容易做错**的写法：
--
--   · `app.attempts` 的每一行都会被 `MasteryService` 与 `Recommen dService`
--     的 BKT 回放读进去（`loadEvidence` 只看 `counts_toward_mastery = true`，
--     但那是 filter 而不是结构保证 —— 只要有人把定级行的这一列写成 true，
--     掌握度就凭空多出 8–18 条证据，学习者一进门就被判成「已掌握」）。
--   · 定级题来自「即将要学的知识点」，正是最不该先有掌握度记录的那些节点。
--
-- 所以物理隔离：表不同、服务不同、读写路径不同。答辩时不需要解释「我们
-- 靠一个 bool 列来区分」，结构上就不会混。
--
-- ## 为什么状态整块存 jsonb
--
-- `PlacementState` 的形状属于 `packages/engine`（纯函数、有测试、还在演进）。
-- 按字段拆列的话，引擎每加一个计数器就要一次迁移。这里只需要「按 session
-- 拿回完整状态」，不需要按后验概率查询，所以整块存快照 —— 与 0021 的
-- `probe_sessions.state` 同一个理由。
--
-- 真正需要按列查的只有：会话归属、时间、题数、结果档位。它们单独成列。

CREATE TABLE IF NOT EXISTS app.placement_sessions (
  id             text PRIMARY KEY,
  -- 定级题池来自「即将要学的知识点」；会话本身不绑定单个知识点，
  -- 但记下起手时聚焦的模块便于复盘（可空：新用户可能还没有模块上下文）。
  module_id      text REFERENCES app.modules(id) ON DELETE SET NULL,
  -- 自评的原始作答（questionId/optionId）与它算出的 logit 平移量。
  -- 分开存：平移量是派生值，改了评分规则可以重算，原始作答不能重算。
  self_assessment jsonb NOT NULL,
  prior_shift    double precision NOT NULL,
  -- `PlacementState` 快照（packages/engine/src/placement.ts）。
  state          jsonb NOT NULL,
  -- 题池快照：起手那一刻选定的候选题（itemId/microKpId/difficulty）。
  -- 存快照而不是每次重新查询，是为了让「同一会话里题目不漂移」有结构保证 ——
  -- 中途有人往库里加题，已开始的定级不该因此换一道题。
  pool           jsonb NOT NULL,
  answered       int NOT NULL DEFAULT 0 CHECK (answered >= 0),
  correct_count  int NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  -- 结果档位。会话进行中为 NULL，结束后写入（provisional 也写）。
  tier           text CHECK (tier IS NULL OR tier IN ('P1', 'P2', 'P3')),
  status         text NOT NULL DEFAULT 'in_progress'
                 CHECK (status IN ('in_progress', 'finished')),
  stop_reason    text CHECK (stop_reason IS NULL OR stop_reason IN
                  ('sd', 'band', 'entropy', 'max_items', 'no_more_items')),
  finished_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS placement_session_created_idx
  ON app.placement_sessions (created_at DESC);

-- 逐题留痕。结果页的「逐题复核表」（票 11 验收 4：必须展示答案与解析）
-- 就是从这张表拼出来的 —— 不靠会话状态里的 history，因为那里面只有
-- itemId 与对错，没有「当时你选了什么」。
CREATE TABLE IF NOT EXISTS app.placement_answers (
  id             bigserial PRIMARY KEY,
  session_id     text NOT NULL REFERENCES app.placement_sessions(id) ON DELETE CASCADE,
  ordinal        int NOT NULL CHECK (ordinal >= 1),
  item_id        text NOT NULL,
  level_id       text NOT NULL,
  micro_kp_id    text NOT NULL,
  difficulty     text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  -- 学生提交的原始答案（下标整数或字符串），原样存以便复盘
  raw_answer     jsonb NOT NULL,
  correct        boolean NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, ordinal)
);

CREATE INDEX IF NOT EXISTS placement_answer_session_idx
  ON app.placement_answers (session_id, ordinal);

-- 定级结论（每个学生一行）。
--
-- 为什么另立一张表而不是从 placement_sessions 里挑最新一条：
-- 「当前档位」是**单值**语义，重判会覆盖它；而会话表是流水账，保留全部
-- 历史用于复盘。两者生命周期不同。这张表还承载重判需要的计数
-- （learned_kp_count），那个数字跨会话累积。
CREATE TABLE IF NOT EXISTS app.placement_profile (
  id             int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  tier           text NOT NULL CHECK (tier IN ('P1', 'P2', 'P3')),
  status         text NOT NULL DEFAULT 'provisional'
                 CHECK (status IN ('provisional', 'confirmed')),
  -- 最近一次定级/重判来自哪个会话（重判为 NULL：它不产生会话）
  session_id     text REFERENCES app.placement_sessions(id) ON DELETE SET NULL,
  -- 上次定级/重判之后学完的知识点数，用于「学满 3 个知识点后自动重判」
  learned_kp_count int NOT NULL DEFAULT 0 CHECK (learned_kp_count >= 0),
  placed_at      timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- 单行表：id 恒为 1，CHECK 已经在上面钉死。用一个不可能被插第二行的主键
-- 代替触发器，PostgreSQL 里这是最简单可靠的单例约束。
