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

INSERT INTO app.levels (id, micro_kp_id, title, kind, ordinal)
VALUES ('lv-bool-1', 'kp-bool', '布尔代数的三条基本律', 'teach', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO app.level_items
  (id, level_id, stem, answer, explain_correct, explain_wrong, variant_group, pool)
VALUES (
  'it-bool-1', 'lv-bool-1', 'A + A·B 化简后等于什么？', '{"value":"A"}',
  '吸收律：A + A·B = A(1+B) = A',
  '把吸收律与德摩根律混用会得到 A+B。注意 A·B 是 A 的子集，所以并上 A 不增加任何东西。',
  'vg-absorb', 'quiz'
) ON CONFLICT (id) DO NOTHING;
