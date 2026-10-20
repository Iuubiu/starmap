-- 作答记录的可回溯字段（票 05 验收第 1 条）。
--
-- `app.attempts` 原本只有 (micro_kp_id, item_id, variant_group, correct,
-- answer, created_at)。能回答「哪道题、对没对、什么时候」，但**回答不了**：
--
--   · 哪个关卡 —— 同一道题可以出现在多个关卡里（自制关卡会把做过的题
--     重新打包，见 0040/0041），不看 level_id 就分不清「在原来的关卡里
--     做对」和「在复验关卡里做对」；
--   · 用了多久 —— 掌握度判定不看时间，但「想了 8 分钟才蒙对」和「3 秒
--     答对」对后续推荐是不同的信号，事后无法补记；
--   · 用了几次提示 —— 提示阶梯（票 04）的每一级都是一次「部分让渡」，
--     用了三级提示才答对，和裸答对写进同一个 correct 里会失去分辨力；
--   · 第几次 —— 想要「这是第 3 次做这道题」，现在只能现算 count(*)，
--     而一旦有并发作答（同一会话双击提交）这个现算值就不唯一了。
--
-- 四列全部**可空或带默认值**：历史行没有这些信息，编不出来。给它们默认值
-- 会把「不知道」伪装成「0 毫秒、没用提示、第 0 次尝试」，所以 level_id /
-- latency_ms / hints_used 留 NULL，attempt_no 用 0 表示「迁移之前的历史行」
-- （真实作答从 1 开始计数，0 因此永远不会与真实值混淆）。
--
-- 还有一列不是「可回溯字段」，而是**语义开关**：
--
--   · counts_toward_mastery —— 这次作答算不算掌握度证据。
--
-- 深究与进一步讲解这两段**全程不扣掌握度**（spec 需求 17）。它们里的作答
-- 仍然要落库（学习者答了什么、错了哪一步，是下一次讲解该从哪里切入的依据），
-- 但不得进入 BKT 回放，否则「在深究段诚实暴露自己不会」会变成惩罚 ——
-- 学生会立刻学会在深究段装懂，那一段就废了。
--
-- 用一列而不是「按 level_id + step 现查 spec」：spec 是可改的（自制关卡与
-- 市场覆盖会换 spec），历史作答的归属不能随 spec 一起漂。写进行里才是事实。
--
-- 同一理由还要落一列 `knowledge_kind`（事实/概念/综合）：
--
--   它决定这条证据的半衰期（14 / 30 / 45 天）。半衰期不能回放时现查
--   `level_items` 再往 spec 里找 —— 题目的类型是内容作者可以改的，改完
--   历史作答的衰减速度就整体变了；更糟的是题被删掉（`ON DELETE CASCADE`
--   把 attempts 也带走是另一回事，但题目改池、换关卡都会断掉这条链）。
--   证据一旦写下就该自带解释自己的全部参数。
--
-- 回滚见 0011_attempt_evidence.down.sql。

ALTER TABLE app.attempts
  ADD COLUMN IF NOT EXISTS level_id   text REFERENCES app.levels (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS latency_ms integer,
  ADD COLUMN IF NOT EXISTS hints_used integer,
  ADD COLUMN IF NOT EXISTS attempt_no integer NOT NULL DEFAULT 0;

ALTER TABLE app.attempts
  ADD COLUMN IF NOT EXISTS counts_toward_mastery boolean NOT NULL DEFAULT true;

-- 知识类型：决定半衰期。历史行不知道自己的类型，留 NULL，回放时回落到
-- 该知识点证据里占比最高的类型（`replayMastery` 的 dominantHalfLife 已经
-- 是这个语义），而不是硬编码成某一类。
ALTER TABLE app.attempts
  ADD COLUMN IF NOT EXISTS knowledge_kind text;

ALTER TABLE app.attempts
  DROP CONSTRAINT IF EXISTS attempt_knowledge_kind_valid;
ALTER TABLE app.attempts
  ADD CONSTRAINT attempt_knowledge_kind_valid
  CHECK (knowledge_kind IS NULL OR knowledge_kind IN ('fact', 'concept', 'comprehensive'));

-- 用时就该是非负整数；NULL 表示未记录（历史行与不计时客户端）。
ALTER TABLE app.attempts
  DROP CONSTRAINT IF EXISTS attempt_latency_nonneg;
ALTER TABLE app.attempts
  ADD CONSTRAINT attempt_latency_nonneg
  CHECK (latency_ms IS NULL OR latency_ms >= 0);

ALTER TABLE app.attempts
  DROP CONSTRAINT IF EXISTS attempt_hints_nonneg;
ALTER TABLE app.attempts
  ADD CONSTRAINT attempt_hints_nonneg
  CHECK (hints_used IS NULL OR hints_used >= 0);

-- 「这道题我做过几次」与「这个变式组我碰过几次」都按 (micro_kp_id, item_id)
-- 或 (micro_kp_id, variant_group) 扫最近的几条，两个方向都建索引：
-- 前者给「重做同一道题」用，后者给变式覆盖统计用（ADR-0004 的去重键）。
CREATE INDEX IF NOT EXISTS attempt_kp_item_idx
  ON app.attempts (micro_kp_id, item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS attempt_kp_variant_idx
  ON app.attempts (micro_kp_id, variant_group, created_at DESC);

-- 回放一个知识点的全部证据时按时间正序读（`replayMastery` 要求顺序稳定，
-- 同一时刻按插入顺序即 id 顺序）。逆序索引能用，但正序扫描省一次排序。
CREATE INDEX IF NOT EXISTS attempt_kp_chrono_idx
  ON app.attempts (micro_kp_id, created_at, id);
