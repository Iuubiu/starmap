-- 票 06：出口门控通过后解锁下游节点，解锁状态要落库。
--
-- ## 为什么单独一张表，而不是从 learning_log 现推
--
-- 门控判定本身记在 `learning_log`（event = gate_passed / gate_failed /
-- gate_undetermined，payload 里带这次判定用了哪几题）—— 那是**事件流**：
-- 每一次判定都要留一条，包括没过的那些，回看时能回答「上次差几题」。
--
-- 解锁是**状态**，不是事件：`node_unlocks` 每行回答一个是非题「这个节点现在
-- 能不能进」。用事件流现推的话，每次判「这个关卡锁没锁」都要扫一遍 jsonb 并
-- 重放全部历史判定；更糟的是判定规则一改，历史解锁结论会跟着一起变 —— 而
-- 已经解锁的东西不该被后来的规则改动收回（`achieved` 管解锁，不衰减）。
--
-- ## 为什么键是 (node_id, prerequisite_id) 而不是只有 node_id
--
-- 一个节点可能有多条先修边，其中若干条来自**设了门控**的节点。这时它必须等
-- 每一道门都开过才真的能进：只过了其中一道就放行，等于把另一条先修链绕过。
-- 主键带上 `prerequisite_id`，锁的判据就变成「存在一条来自设门控节点的先修边，
-- 但没有对应的解锁行」——一条先修边一道锁，不多不少。
--
-- ## 为什么不记「锁」只记「解锁」
--
-- 锁定是默认态：没有行 = 没解锁。这样新加的节点天然是锁着的，不需要在内容
-- 入库时为每个节点补一行「未解锁」，也不存在「锁行丢了会静默变成解锁」。
--
-- ## 为什么 on conflict 不动
--
-- 重复通过同一道门控不会改写 `unlocked_at`：首次解锁的时刻是成长记录的一部分，
-- 第二次通过只是又一条学习日志，不该把它覆盖成今天。

CREATE TABLE IF NOT EXISTS app.node_unlocks (
  node_id                 text NOT NULL
                          REFERENCES app.knowledge_points(id) ON DELETE CASCADE,
  -- 开门的那道门控挂在哪个知识点上（= 先修边的 from_id）。
  prerequisite_id         text NOT NULL
                          REFERENCES app.knowledge_points(id) ON DELETE CASCADE,
  unlocked_at             timestamptz NOT NULL DEFAULT now(),
  -- 哪张关卡把门打开的。关卡被删掉时置空而不是删行：解锁这个事实仍然成立。
  unlocked_by_level_id    text REFERENCES app.levels(id) ON DELETE SET NULL,
  -- 开门时的门控类型与成绩快照。门控数值将来改了，也能看出当年是按什么放行的。
  gate_mode               text NOT NULL CHECK (gate_mode IN ('exit', 'prereq')),
  correct_count           int NOT NULL CHECK (correct_count >= 0),
  item_count              int NOT NULL CHECK (item_count >= 0),
  PRIMARY KEY (node_id, prerequisite_id)
);

-- 「这张关卡开过哪些节点」——关卡页的解锁清单与作者排查都按这个查。
CREATE INDEX IF NOT EXISTS node_unlocks_level_idx
  ON app.node_unlocks (unlocked_by_level_id);

-- 「这个节点靠哪几道门解锁」——锁状态查询按先修方反查。
CREATE INDEX IF NOT EXISTS node_unlocks_prereq_idx
  ON app.node_unlocks (prerequisite_id);
