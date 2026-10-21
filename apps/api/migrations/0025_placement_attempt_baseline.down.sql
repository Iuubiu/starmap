-- 回滚 0025：把列名与约束改回 0024 之后的状态。
--
-- 注意顺序：先加回旧列、再把新列里的值搬回去，最后删新列。反过来的话
-- 数据在中间态就丢了。这两张表都很小（`placement_profile` 单行，
-- `placement_rejudges` 每次重判一行），搬数据可以放心用 UPDATE。
--
-- 值本身无法精确还原：`attempts_baseline` 记的是作答数基线，
-- `learned_kp_count` 记的是知识点数基线，两者不是同一个量。下行脚本按
-- 0 填充并保留列结构 —— 这是回滚的诚实代价：退回旧代码后门槛会重新按
-- 「学完 3 个知识点」算，而基线从一个保守的 0 起算，最多触发一次多余的
-- 重判（重判只会用真实证据修正档位，不会损坏数据）。

ALTER TABLE app.placement_profile
  ADD COLUMN IF NOT EXISTS learned_kp_count integer NOT NULL DEFAULT 0;

ALTER TABLE app.placement_rejudges
  ADD COLUMN IF NOT EXISTS learned_kp_count integer NOT NULL DEFAULT 0;

ALTER TABLE app.placement_rejudges
  DROP COLUMN IF EXISTS attempts_since;

ALTER TABLE app.placement_profile
  DROP COLUMN IF EXISTS attempts_baseline;

ALTER TABLE app.placement_profile
  DROP CONSTRAINT IF EXISTS placement_profile_status_check;

ALTER TABLE app.placement_profile
  ADD CONSTRAINT placement_profile_status_check
  CHECK (status IN ('provisional', 'confirmed'));
