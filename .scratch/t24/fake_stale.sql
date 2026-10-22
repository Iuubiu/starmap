-- 造一个「本次产物里不存在」的旧知识点，用来验证 --prune-kp 的报告与清理两条路径。
-- 用完必须删掉（--prune-kp 会替我们删，但先显式确认它存在）。
INSERT INTO app.knowledge_points (id, module_id, parent_id, name, is_leaf, depth, ordinal, source_page, source_id)
SELECT 'kp-zzz-t24-prune-probe', m.id, NULL, 'T24 探针：应被报告并清理', true, 2, 999, 1, 'digital-kanghua-5e'
  FROM app.modules m WHERE m.id = 'mod-digital-kanghua-5e-kp-kanghua-5e-1'
ON CONFLICT (id) DO NOTHING;
SELECT id, name FROM app.knowledge_points WHERE id = 'kp-zzz-t24-prune-probe';
