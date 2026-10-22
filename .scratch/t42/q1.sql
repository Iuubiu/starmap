select count(*) as kp_total from app.knowledge_points;
select count(*) as untranslated from app.knowledge_points where name like '%未收录术语%';
