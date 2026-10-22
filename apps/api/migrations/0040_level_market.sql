-- 票 14：关卡市场的「保存」登记。
--
-- spec.md:227 的数据模型里这张表只有五个字段，这里**一个都不多**：
--   id, level_id, title, tags, saved_at
--
-- 三个刻意的取舍：
--
-- 1. **不建 level_market.spec 列**。关卡的完整规范只有一个真源：`app.levels.spec`。
--    市场表再存一份，两者就会在某次保存后不一致，而播放器读哪一份会变成
--    无人能回答的问题。市场行只负责「这个关卡被登记进市场了」这件事。
--
-- 2. **`level_id` 唯一**。一个关卡在市场里只有一条登记；重复保存是更新
--    `saved_at` 而不是插入第二行。否则市场页会出现两张一模一样的卡片，
--    而用户会以为收藏了两个不同版本。
--
-- 3. **`ON DELETE CASCADE`**。关卡被删掉，它的市场登记没有意义。反过来
--    `levels` 不引用 `level_market`——市场是附加层，关卡的可用性不该取决于
--    它有没有被登记。
--
-- 预制关卡**不进这张表**：它们是系统内容，市场页直接读 `app.levels`。
-- 「保存」与「分发」的区别也在这里——存下来的只有一行本地登记，没有任何
-- 对外可见性字段（没有 published、没有 share_token、没有 visibility）。

CREATE TABLE IF NOT EXISTS app.level_market (
  id         text PRIMARY KEY,
  level_id   text NOT NULL REFERENCES app.levels(id) ON DELETE CASCADE,
  title      text NOT NULL,
  tags       text[] NOT NULL DEFAULT '{}',
  saved_at   timestamptz NOT NULL DEFAULT now()
);

-- 一个关卡在市场里只能登记一次（见上面第 2 条）。
CREATE UNIQUE INDEX IF NOT EXISTS level_market_level_idx ON app.level_market (level_id);

-- 市场页按保存时间倒序展示「我保存的关卡」，这是唯一的排序方式。
CREATE INDEX IF NOT EXISTS level_market_saved_idx ON app.level_market (saved_at DESC);
