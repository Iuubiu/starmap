-- 0050 的回滚：只删本迁移建的两张表。
-- 注意顺序：先删引用方（video_clips），再删被引用方（video_sources），
-- 否则外键会拦住 DROP。

DROP TABLE IF EXISTS app.video_clips;
DROP TABLE IF EXISTS app.video_sources;
