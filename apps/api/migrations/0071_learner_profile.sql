-- 学习者画像（票 78「初识」技能的输出）
--
-- ## 为什么是单行表
--
-- StarMap 是单用户工作站（spec §1），没有账号体系。画像的语义是「这个人是谁
-- 的学习者」—— 一张表里只该有一行。用 `singleton_id smallint PRIMARY KEY
-- CHECK (singleton_id = 1)` 把「只有一行」写成数据库约束，而不是一条靠自觉
-- 遵守的约定：多插一行会直接 23514，不会静默出现「两份画像，前端读到哪份
-- 看运气」。
--
-- ## 为什么整份画像是 jsonb 而不是六列
--
-- 六个字段的值都由同一段问答产生、总是一起读、Schema 由
-- `packages/api-contract/src/domains/profile.ts` 的 Zod 定义。拆成六列会带来
-- 两处重复的真源（迁移的列定义 + 契约的字段定义），而它们漂移时没有任何
-- 测试会发现 —— 症状是「画像页显示得对，智能体读到 null」。
--
-- jsonb 的代价是「无法对单个字段建约束」。这里由两层兜住：写入前 Zod 校验
-- （`LearnerProfilePatchSchema`），以及读取时用 `LearnerProfileSchema.parse`。
-- 也就是说，库里存的是**已经过契约校验过的值**，不是任意 JSON。
--
-- ## 为什么 updated_at 可空
--
-- 「从没填过」与「填了又清空」不是一回事。第一行只在学生第一次提交时创建，
-- 在那之前 `GET /api/v1/profile` 返回全 null 的画像、`updatedAt: null`。
-- 给 updated_at 一个 DEFAULT now() 会让「没写过」看起来像「刚写过」。
CREATE TABLE IF NOT EXISTS app.learner_profile (
  singleton_id smallint PRIMARY KEY DEFAULT 1,
  profile      jsonb    NOT NULL DEFAULT '{}'::jsonb,
  updated_at   timestamptz,
  CONSTRAINT learner_profile_singleton CHECK (singleton_id = 1)
);

COMMENT ON TABLE app.learner_profile IS
  '学习者画像（单行）。profile 是 LearnerProfileSchema 的 JSON，字段可为 null（= 学生跳过了这一问）。';
COMMENT ON COLUMN app.learner_profile.updated_at IS
  '最后一次写入时间。为 NULL 表示这张画像还没被写过 —— 与「写了但全空」区分。';
