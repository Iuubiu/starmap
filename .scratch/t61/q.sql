SELECT count(*) FROM app.knowledge_points WHERE name ~ '^[、，。；：）)]';
SELECT micro_kp_id, source_id, parent_id, name, source_page
FROM app.knowledge_points
WHERE name ~ '^[、，。；：）)]'
ORDER BY 1;
SELECT count(*) AS b_class FROM app.knowledge_points WHERE name = '作用与地位';
SELECT count(*) AS total_kp FROM app.knowledge_points;
SELECT count(*) AS leaf_kp FROM app.knowledge_points WHERE is_leaf;
SELECT count(*) AS null_owner_chunks FROM app.chunks WHERE micro_kp_id IS NULL;
