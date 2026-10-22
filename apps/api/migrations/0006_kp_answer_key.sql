-- 答案附录需要一个显式的列标记，否则票 09 的「答案块门控」在真实数据上是空的。
--
-- ## 缺陷：门控只查「当前知识点自己的答案块」，而答案不在那个知识点名下
--
-- `chunk_kp_answer` 是 (chunk × 微知识点) 的关系：某个 chunk 是不是某个知识点的
-- 答案。学习者永远以**叶节点**为当前知识点（地图/详情/出题都只到叶），所以
-- 检索侧只问 `answerChunkIdsFor(leafKp)`。
--
-- 但印刷书把习题答案集中印在书末的「部分习题答案」附录里 —— 那是一个**独立节点**，
-- 按附件规则被建成 `is_leaf = false` 的容器。于是：
--
--   * 这 514 个答案 chunk 的 micro_kp_id 是附录节点，不是任何叶节点；
--   * 检索时问的是叶节点，`answerChunkIdsFor` 自然查不到它们；
--   * 学生问「核乳胶 习题答案」，题面与答案一起进上下文，门控形同不存在。
--
-- 实测（100 个叶知识点 × 3 种提问模板 = 300 次 `GET /api/v1/agent/retrieval/debug`）：
-- background 档 29 次（9.7%）把答案 chunk 放进了上下文，48 次 allowed、0 次 denied。
-- 样例：`核乳胶 习题答案` → chunk「471 部分习题答案 CLKA 0 RD CLK 0 D 0 D2 R 0 0 10 不定」
-- allowed=true。
--
-- ## 为什么是加列，不是把这 514 个 chunk 批量插进 `chunk_kp_answer`
--
-- 那会把 10287 行变成 10 万行以上，而且语义是错的：`chunk_kp_answer` 记的是
-- **「这个 chunk 是那个知识点的答案」**，不是「这个 chunk 出现在那本书里」。
-- 把书末每个答案 chunk 都挂到全书每个叶知识点上，等于说「每道题的答案都是每道题的
-- 答案」，那不是门控依据，是把关系表灌成笛卡尔积。而真正的语义是：
-- **同一本书的答案附录，对这本书的任何知识点都是答案来源。**
--
-- 一本书一条标记（`is_answer_key`）恰好表达这件事：检索侧要的是
-- 「自己的答案块 ∪ 同书所有 is_answer_key 节点的 chunk」，一次 `WHERE source_id = $1
-- AND is_answer_key` 就够，不需要 N×M 行。
--
-- ## 为什么是 NOT NULL DEFAULT false 而不是可空
--
-- 可空会把「没有标记」和「不是答案附录」混成 NULL 与 false 两个值，检索侧的
-- `WHERE is_answer_key` 就会静默漏掉 NULL 行 —— 这个缺陷（老库/老 toc.json 里的
-- 节点没被扫到）恰恰是这次要修的。默认 false 让「没有标记」等于「不是」，安全方向
-- 是**少拦**（答案可能被放行）而不是**全拦**（正常内容被挡），与门控本来
-- 只在 background 档生效的取舍一致。
--
-- ## 派生标记，重跑导入即可重建
--
-- 这个列的值完全来自 `tools/ingest/toc.py` 的 `is_answer_key_title()`（12 本实测
-- 精确命中 4 条：康华光模拟「部分习题答案」、童诗白「部分自测题和习题答案」、
-- 李瀚荪「部分习题答案（上册）」、阎石「部分习题答案」）。它是目录的派生事实，
-- 不是学习者数据，所以回滚直接删列（见 down），删了重导就回来。
ALTER TABLE app.knowledge_points
  ADD COLUMN IF NOT EXISTS is_answer_key boolean NOT NULL DEFAULT false;

-- 检索侧每次提问都要查「这本书的答案附录 chunk」，按 source_id 过滤。
-- 12 本书里只有 4 行是 true，partial index 让这个查询只扫这 4 行。
CREATE INDEX IF NOT EXISTS kp_answer_key_idx
  ON app.knowledge_points (source_id)
  WHERE is_answer_key;
