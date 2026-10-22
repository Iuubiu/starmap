-- 0060 的回滚：只删本迁移建的表（三条缺口随表一起消失）。
--
-- 为什么不需要单独删种子行：`content_gaps` 整张表都是本迁移建的，
-- `DROP TABLE` 已经把它们带走了。反过来说，如果哪一天有人把种子行搬进
-- `seed.sql`，这条 down 就不再等价 —— 那时要补一条 DELETE。现在的写法
-- 成立的前提是「表与本迁移同生共死」，这个前提写在 0060_content_gaps.sql
-- 的文件头。

DROP TABLE IF EXISTS app.content_gaps;
