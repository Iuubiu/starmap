\d app.knowledge_points
\d app.chunks
SELECT 'frag_chunks' AS k, count(*) FROM app.chunks WHERE micro_kp_id = 'kp-dinghonglin-2010-p1-作用与地位';
SELECT 'keeper_chunks' AS k, count(*) FROM app.chunks WHERE micro_kp_id = 'kp-dinghonglin-2010-1-1';
SELECT 'edges_from' AS k, count(*) FROM app.kp_edges WHERE from_id = 'kp-dinghonglin-2010-p1-作用与地位';
SELECT 'edges_to' AS k, count(*) FROM app.kp_edges WHERE to_id = 'kp-dinghonglin-2010-p1-作用与地位';
SELECT 'children' AS k, count(*) FROM app.knowledge_points WHERE parent_id = 'kp-dinghonglin-2010-p1-作用与地位';
SELECT 'attempts' AS k, count(*) FROM app.attempts WHERE micro_kp_id = 'kp-dinghonglin-2010-p1-作用与地位';
SELECT 'mastery' AS k, count(*) FROM app.mastery WHERE micro_kp_id = 'kp-dinghonglin-2010-p1-作用与地位';
SELECT 'log' AS k, count(*) FROM app.learning_log WHERE micro_kp_id = 'kp-dinghonglin-2010-p1-作用与地位';
SELECT 'levels' AS k, count(*) FROM app.levels WHERE micro_kp_id = 'kp-dinghonglin-2010-p1-作用与地位';
SELECT 'chunk_kp_answer' AS k, count(*) FROM app.chunk_kp_answer WHERE micro_kp_id = 'kp-dinghonglin-2010-p1-作用与地位';
