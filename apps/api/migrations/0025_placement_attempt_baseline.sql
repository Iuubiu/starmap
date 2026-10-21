-- 票 11 重判门槛：从「学完 3 个知识点」改成「累计 5 题作答」。
--
-- ## 为什么要改列，而不是只改代码
--
-- 门槛原先按「学完的知识点数」计（`placement_profile.learned_kp_count` 存基线）。
-- 票面那句「学满 3 个知识点后自动重判」是从票 12 抄错的：spec.md:52 与
-- spec.md:283 两处都写「学 5 题后可重判」，而 spec.md:281 的「每完成 3 个
-- 知识点重评」是票 12 的流程重评（档位渲染参数调整），与本票的定级重判
-- 是两件事。
--
-- 不改列名的后果不是「名字不好看」：基线值的**单位**变了（知识点数 →
-- 作答数），留着 `learned_kp_count` 这个名字，下一个读代码的人会把
-- 「5」看成 5 个知识点，或者在别处继续按知识点写值 —— 两种单位共用一个
-- 列名是最难查的一类错。所以新增 `attempts_baseline` 并删掉旧列。
--
-- ## 为什么删旧列而不是留着
--
-- 留一列永不读写的 `learned_kp_count` 会让「查询里没有它」变成需要看代码
-- 才能确认的事。`placement_profile` 是单行表、数据可随时重建（它就是
-- 「当前档位」的快照），删列不损失任何不可恢复的信息。
--
-- ## 顺带收紧 status 的 CHECK
--
-- `'confirmed'` 从来没有任何写入路径：`upsertProfile` 写 `'provisional'`，
-- `applyRejudge` 不碰 status 列，全仓库没有一处 `SET status = 'confirmed'`。
-- 留着这个值会让下一个人以为存在「已确认档位」这个终态，写一条覆盖它的
-- 测试或依赖它做分支。spec.md:283 与票 11 验收 5 的语义本来就是「定级
-- 结果永远是临时的、随时会被学习证据修正」，不存在「确认后不再改」。

ALTER TABLE app.placement_profile
  ADD COLUMN IF NOT EXISTS attempts_baseline integer NOT NULL DEFAULT 0;

ALTER TABLE app.placement_profile
  DROP COLUMN IF EXISTS learned_kp_count;

ALTER TABLE app.placement_rejudges
  ADD COLUMN IF NOT EXISTS attempts_since integer NOT NULL DEFAULT 0;

ALTER TABLE app.placement_rejudges
  DROP COLUMN IF EXISTS learned_kp_count;

-- 先删后加，重复执行不报错（`ADD CONSTRAINT` 本身不幂等，靠这一步兜住）。
ALTER TABLE app.placement_profile
  DROP CONSTRAINT IF EXISTS placement_profile_status_check;

ALTER TABLE app.placement_profile
  ADD CONSTRAINT placement_profile_status_check CHECK (status = 'provisional');
