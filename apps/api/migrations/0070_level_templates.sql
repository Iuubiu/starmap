-- 关卡模板与导入导出：levels 增加三列
--
-- 背景（票 66）：模板是「带槽位的关卡骨架」，同一份骨架按学习者状态（档位
-- tier、知识点 microKpId）填出不同的 LevelSpec 草稿。填出来的草稿可以不落库
-- （预览），也可以落库成为一张新关卡 —— 后者需要一个字段记住「它来自哪个
-- 模板」，否则作者改完三个月后再看这张关卡，已经看不出它的骨架是哪一个。
--
-- 三列各自的理由：
--
--   template_id  「这张关卡是从哪个模板填出来的」。可空：手写关卡与 AI 关卡
--                都不是从模板来的。**不做外键**：模板本身存在代码里
--                （`apps/api/src/levels/level-templates.ts`），不是一张表 ——
--                模板要跟着代码一起版本化，放库里会让「模板改了但库里还是
--                旧的」成为一个静默可能。代价是删模板不会级联清空引用，所以
--                模板 id 一旦发布就不再改名。
--
--   origin       「这张关卡怎么来的」。四值：system（手写/系统）、ai（模型
--                生成）、template（模板填充）、imported（从 .level 文件导入）。
--                NOT NULL：一张关卡不可能「不知道自己怎么来的」。
--
--   share_hash   「同样的内容有没有被导入过两次」。sha256(spec + items
--                规范化后)，导入时用它去重：同一个文件连导两次应该得到同一张
--                关卡，而不是两张内容一样的关卡。可空：手写与 AI 关卡不需要
--                这个身份。
--
-- ## 关于 origin 的默认值（与票面的一处偏离，理由如下）
--
-- 票面写的是 `DEFAULT 'authored' CHECK IN ('system','ai','template','imported')`。
-- 这两半互相矛盾：`'authored'` 不在 CHECK 列表里，而 `ADD COLUMN ... NOT NULL
-- DEFAULT 'authored'` 会立刻给所有历史行写上 'authored'，紧接着的
-- `ADD CONSTRAINT ... CHECK` 就会因历史行违约而失败 —— 这个迁移在任何有数据的
-- 库上都跑不过去。
--
-- 所以这里按 **CHECK 列表**（更精确的那一半）执行，默认值取 `'system'`：
-- 加列前库里只有两类关卡 —— 0010 的手写教学关（其 `spec.meta.author` 正是
-- `'system'`）与 0041 的 AI 生成关。前者落 `'system'` 恰好正确，后者由下面
-- 的 UPDATE 按 `spec.meta.author = 'ai'` 回填成 `'ai'`。两批都被正确归类，
-- 没有「说不清来源」的第三类。

ALTER TABLE app.levels
  ADD COLUMN IF NOT EXISTS template_id text,
  ADD COLUMN IF NOT EXISTS origin      text NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS share_hash  text;

-- CHECK 用 DO 块包住：`ADD CONSTRAINT` 没有 `IF NOT EXISTS`，重复执行会报
-- 「constraint already exists」。迁移器按版本表跳过已执行的文件，但
-- `scripts/check-migrations.mjs` 会在一次性 schema 里重放，人工排障时也可能
-- 对同一个库重跑单个文件 —— 让重复执行是无操作，比让它报错更安全。
DO $origin_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'levels_origin_check'
       AND conrelid = 'app.levels'::regclass
  ) THEN
    ALTER TABLE app.levels
      ADD CONSTRAINT levels_origin_check
      CHECK (origin IN ('system', 'ai', 'template', 'imported'));
  END IF;
END
$origin_check$;

COMMENT ON COLUMN app.levels.template_id IS
  '这张关卡由哪个关卡模板填出（模板定义在代码里，不做外键）。手写与 AI 关卡为 null。';
COMMENT ON COLUMN app.levels.origin IS
  '关卡来源：system 手写/系统 / ai 模型生成 / template 模板填充 / imported 文件导入。';
COMMENT ON COLUMN app.levels.share_hash IS
  'sha256(spec + items 规范化)，用于导入去重。可空：手写与 AI 关卡不需要这个身份。';

-- 回填：0041 生成的关卡在 spec.meta.author 里写着 'ai'，把它们归到 'ai'，
-- 而不是让它们留在默认的 'system' 里假装是人写的。
UPDATE app.levels
   SET origin = 'ai'
 WHERE origin = 'system'
   AND spec -> 'meta' ->> 'author' = 'ai';

-- 同一份内容只允许有一张 imported 关卡：`share_hash` 是它的身份。
--
-- 部分唯一索引（只约束 imported）而不是全表唯一：手写与 AI 关卡的 share_hash
-- 是 null，而 null 在唯一索引里互不相等 —— 写全表唯一索引不会报错，但也拦不住
-- 任何东西，会让人误以为「去重已经保证了」。只有 imported 行才该被这条索引管。
CREATE UNIQUE INDEX IF NOT EXISTS level_share_hash_imported_idx
  ON app.levels (share_hash)
  WHERE share_hash IS NOT NULL AND origin = 'imported';

-- 按模板找关卡（「这个模板被用过几次、填过哪些知识点」）与按来源统计。
CREATE INDEX IF NOT EXISTS level_template_idx
  ON app.levels (template_id)
  WHERE template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS level_origin_idx ON app.levels (origin);
