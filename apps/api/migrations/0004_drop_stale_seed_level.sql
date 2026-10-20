-- 删掉 seed.sql 早期插入的脚手架关卡 lv-bool-1，并撤掉 spec 列的默认值。
--
-- ## 为什么需要一条迁移，而不是只改 seed.sql
--
-- seed.sql 是「给空库塞演示数据」的脚本，不是 schema 演进。已经跑过 seed 的
-- 库，那一行 lv-bool-1 早就在了 —— 改 seed.sql 对它们没有任何作用，而 e2e
-- 与开发库恰恰都是这种库。
--
-- ## 坏在哪
--
-- 0001_init.sql 把 spec 定义成：
--
--     spec jsonb NOT NULL DEFAULT '{}'::jsonb
--
-- seed.sql 插 levels 时没有给 spec，于是拿到 DEFAULT 的空对象 `{}`。
-- 这个默认值把「忘了写 spec」从**插入时的显式错误**变成了**运行时 500**：
-- 插入成功、typecheck 绿、单测绿，直到有人点开这一关才炸，而且报的是
-- 「关卡规范不合法」—— 看起来像关卡内容写坏了，实际是压根没写。
--
--      500 {"code":"INTERNAL","message":"关卡规范不合法: lv-bool-1",
--           "details":[{"path":"schemaVersion",...},{"path":"meta",...},
--                      {"path":"sources",...},{"path":"cards",...}]}
--
-- 所以这次修的不是「seed 打错了一个字段」，而是那个 DEFAULT。撤掉它之后，
-- 任何忘记给 spec 的 INSERT 都会在插入那一刻被 NOT NULL 拒绝，早于任何人
-- 打开页面。
--
-- ## 为什么不给 lv-bool-1 补一份 spec 把它「修好」
--
-- 它和 0010 的 lv-bool-laws 覆盖同一个知识点 kp-bool。两条教学关卡挂在同一个
-- 微知识点上，「这个知识点该进哪一关」就没有答案了 —— 图谱点进去给哪一条？
-- 两条都列出来？补 spec 是在保留一个本来就不该存在的歧义。

DELETE FROM app.level_items WHERE level_id = 'lv-bool-1';
DELETE FROM app.levels WHERE id = 'lv-bool-1';

-- 撤掉陷阱本身。放在最后：前面的 DELETE 不依赖这一列。
ALTER TABLE app.levels ALTER COLUMN spec DROP DEFAULT;
