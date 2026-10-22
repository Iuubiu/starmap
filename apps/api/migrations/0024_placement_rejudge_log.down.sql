-- 先摘外键列再删表：`placement_profile.last_rejudge_id` 引用它。
-- （`DROP TABLE` 在 CASCADE 下也能删，但 CASCADE 会连带删掉别人还没意识到的
-- 依赖对象；显式两步在回滚时更容易看出到底动了什么。）
ALTER TABLE app.placement_profile DROP COLUMN IF EXISTS last_rejudge_id;
DROP TABLE IF EXISTS app.placement_rejudges;
