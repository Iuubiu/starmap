-- 票 16：AI 批量生成的运行记录、逐条结果，以及一条数据库级护栏。
--
-- 三张东西各自解决一个验收项，不要合并：
--
--   level_generation_run   一次批量执行的整体状态     → 验收①「可后台跑并观察进度」
--   level_generation_task  每个知识点一条执行明细     → 验收②「幂等」+ ⑤「失败原因可汇总」
--   levels 上的触发器      写库时的最后一道拦截       → 验收④「AI 关卡只能进 practice 池」
--
-- 为什么失败原因要落表而不是只打日志：验收⑤要求「可汇总查看」。日志是给
-- 单次排障用的，统计「这一批 12 条里 5 条因为语言不合规失败」必须能 SQL 聚合。

-- ── 一次批量执行 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.level_generation_run (
  id text PRIMARY KEY,
  -- 状态机只有这一条正路：pending → running → succeeded|partial|failed。
  -- partial 是单独一个状态而不是用两个计数字段推断，因为「部分成功」和
  -- 「成功但一条都没做出题」在前端是两种不同的提示。
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'succeeded', 'partial', 'failed')),
  requested_count integer NOT NULL DEFAULT 0,
  succeeded_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  -- 并发度记在运行上而不是硬编码：票要求 4，但实测时想临时降到 1 排查限流，
  -- 事后还能回答「这一批到底几个并发跑的」。
  concurrency integer NOT NULL DEFAULT 4,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS level_generation_run_created_idx
  ON app.level_generation_run (created_at DESC);

-- ── 每个知识点一条执行明细 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.level_generation_task (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES app.level_generation_run (id) ON DELETE CASCADE,
  micro_kp_id text NOT NULL REFERENCES app.knowledge_points (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  -- 失败分类。用受限枚举而不是自由文本，是因为验收⑤要「汇总查看」：
  -- 自由文本会变成 12 条同义不同字的 reason，聚合等于没做。
  failure_kind text CHECK (failure_kind IN (
    'llm_error',           -- 上游报错/超时/限流
    'not_json',            -- 返回的不是 JSON（模型夹了中文解释）
    'schema_invalid',      -- 过不了 level.spec 结构与跨字段规则
    'missing_field',       -- 缺必填字段（与上一条分开：这条能精确点名）
    'language_not_compliant', -- 题干/解析不是中文
    'ungrounded_source',   -- sourceRef 指向不存在的教材片段（编造出处）
    'practice_violation',  -- 想往判定池塞题
    'db_error'             -- 落库失败
  )),
  failure_message text,
  -- 字段级明细：level.spec 校验器的 issues 原样存这里，前端能逐条显示。
  failure_detail jsonb,
  -- 生成的关卡 id。成功才有值；被删掉的关卡把它置空而不是连带删任务记录，
  -- 否则「这批生成过什么」的历史会随着关卡被删而消失。
  level_id text REFERENCES app.levels (id) ON DELETE SET NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- 幂等的结构表达：同一个 run 里同一个知识点只有一行。
-- 重跑时靠 ON CONFLICT 更新而不是插入第二行 —— 「重复执行不产生重复关卡」
-- 这件事在明细层是这样保证的，在关卡层靠确定性 id（见 generation.service.ts）。
CREATE UNIQUE INDEX IF NOT EXISTS level_generation_task_run_kp_idx
  ON app.level_generation_task (run_id, micro_kp_id);

CREATE INDEX IF NOT EXISTS level_generation_task_run_idx
  ON app.level_generation_task (run_id, status);

-- ── AI 关卡只能进 practice 池：数据库级护栏 ────────────────────────────────
--
-- level.spec 的校验器（packages/shared）已经有 author==='ai' → 全部 practice
-- 这条规则，那为什么还要在库里再加一道？
--
-- 因为校验器只在**写入路径**上跑。任何绕过它直接 UPDATE 的代码（迁移脚本、
-- 手工修数据、未来某条没走 save 的新路径）都能把 ai 关卡塞进判定池，而
-- 「AI 出的题进了判定池」正是这张票点名要防的事。校验器是入口检查，触发器是
-- 出口检查；两者都写，才叫「进判定池必须经规则校验或人工过」。
--
-- 人工放行不需要绕过它：把 meta.author 改成 'teacher' 或 'self' 即可 ——
-- 那一步本身就是「有人看过并担保」，这条 CHECK 想表达的就是这个。
CREATE OR REPLACE FUNCTION app.enforce_ai_practice_only() RETURNS trigger AS $guard$
DECLARE
  offending integer;
BEGIN
  IF NEW.spec IS NULL OR NEW.spec -> 'meta' ->> 'author' IS DISTINCT FROM 'ai' THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO offending
    FROM jsonb_array_elements(COALESCE(NEW.spec -> 'items', '[]'::jsonb)) AS item
   WHERE item ->> 'pool' IS DISTINCT FROM 'practice';

  IF offending > 0 THEN
    RAISE EXCEPTION 'AI 生成的关卡只能进 practice 池，本关有 % 道题不在 practice 池', offending
      USING ERRCODE = 'check_violation',
            HINT = '人工复核过的关卡请把 meta.author 改成 teacher 或 self 再写入';
  END IF;

  RETURN NEW;
END;
$guard$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS levels_ai_practice_only ON app.levels;
CREATE TRIGGER levels_ai_practice_only
  BEFORE INSERT OR UPDATE OF spec ON app.levels
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_ai_practice_only();

-- ── 回填：让历史 AI 关卡也能被护栏拦到 ────────────────────────────────────
-- 触发器只管新写入，已有的行不会自动被检查。这里不做 DELETE（删用户数据不是
-- 迁移该做的事），只把违反规则的题降级到 practice 池并留一条 note，这样
-- 护栏建立之后库里不存在不一致状态。当前库中无 ai 关卡，这条是给未来的
-- 手工改数据兜底。
UPDATE app.levels
   SET spec = jsonb_set(
         spec,
         '{items}',
         (
           SELECT COALESCE(jsonb_agg(
                    CASE
                      WHEN item ->> 'pool' IS DISTINCT FROM 'practice'
                        THEN jsonb_set(item, '{pool}', '"practice"'::jsonb)
                      ELSE item
                    END
                    ORDER BY ordinality
                  ), '[]'::jsonb)
             FROM jsonb_array_elements(spec -> 'items') WITH ORDINALITY AS t (item, ordinality)
         )
       )
 WHERE spec -> 'meta' ->> 'author' = 'ai'
   AND EXISTS (
     SELECT 1
       FROM jsonb_array_elements(COALESCE(spec -> 'items', '[]'::jsonb)) AS item
      WHERE item ->> 'pool' IS DISTINCT FROM 'practice'
   );
