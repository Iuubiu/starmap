INSERT INTO app.subjects (id, name) VALUES ('nuclear', '核电子学')
ON CONFLICT (id) DO NOTHING;

INSERT INTO app.modules (id, subject_id, name, tier, ordinal)
VALUES ('m-digital', 'nuclear', '数字逻辑基础', 'D', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO app.knowledge_points (id, module_id, parent_id, name, is_leaf, depth, ordinal) VALUES
  ('kp-logic', 'm-digital', NULL, '逻辑代数与门电路', false, 0, 1),
  ('kp-bool', 'm-digital', 'kp-logic', '布尔代数基本运算', true, 1, 1),
  ('kp-kmap', 'm-digital', 'kp-logic', '卡诺图化简', true, 1, 2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO app.mastery
  (micro_kp_id, achieved, current, state, attempt_count, variant_count, evidence_sufficient)
VALUES ('kp-bool', 0.72, 0.66, 'familiar', 10, 3, true)
ON CONFLICT (micro_kp_id) DO NOTHING;

-- 这里曾经插过一条演示关卡 lv-bool-1（title 布尔代数的三条基本律）和它的
-- 一道题 it-bool-1。已删除，原因有两条：
--
--   1. 它没有 spec。0001 的 `spec jsonb NOT NULL DEFAULT '{}'::jsonb` 让它
--      静默落成空对象，点开这一关就是 500「关卡规范不合法」—— 见
--      0004_drop_stale_seed_level.sql 的完整说明。
--   2. 它和 0010 的 lv-bool-laws 覆盖同一个 kp-bool。真正的教学关卡由 0010
--      提供且带完整 spec，seed 里再放一条是历史残留。
--
-- 已有库里的那一行由 0004 删掉；新库跑 seed 时不会再产生它。
-- 注意：`spec` 的 DEFAULT 也已被 0004 撤掉，所以将来往这里加关卡**必须**
-- 显式给 spec 列，否则插入当场失败（这是想要的行为）。
