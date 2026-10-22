\pset footer off
select 'chunks' as tbl, count(*) from app.chunks where micro_kp_id in ('kp-wangjingjin-1983-p75-1131','kp-wangjingjin-1983-p121-g1343')
union all select 'chunk_kp_answer', count(*) from app.chunk_kp_answer where micro_kp_id in ('kp-wangjingjin-1983-p75-1131','kp-wangjingjin-1983-p121-g1343')
union all select 'kp_edges_from', count(*) from app.kp_edges where from_id in ('kp-wangjingjin-1983-p75-1131','kp-wangjingjin-1983-p121-g1343')
union all select 'kp_edges_to', count(*) from app.kp_edges where to_id in ('kp-wangjingjin-1983-p75-1131','kp-wangjingjin-1983-p121-g1343')
union all select 'attempts', count(*) from app.attempts where micro_kp_id in ('kp-wangjingjin-1983-p75-1131','kp-wangjingjin-1983-p121-g1343')
union all select 'mastery', count(*) from app.mastery where micro_kp_id in ('kp-wangjingjin-1983-p75-1131','kp-wangjingjin-1983-p121-g1343')
union all select 'levels', count(*) from app.levels where micro_kp_id in ('kp-wangjingjin-1983-p75-1131','kp-wangjingjin-1983-p121-g1343')
union all select 'knowledge_points', count(*) from app.knowledge_points where id in ('kp-wangjingjin-1983-p75-1131','kp-wangjingjin-1983-p121-g1343')
union all select 'new_nodes_chunks', count(*) from app.chunks where micro_kp_id in ('kp-wangjingjin-1983-p75-道宽选择','kp-wangjingjin-1983-p121-多路脉冲幅度分析')
order by 1;
