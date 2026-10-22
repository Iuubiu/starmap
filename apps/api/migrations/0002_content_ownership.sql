-- 票 02 的入库需要两件票 01 没预见到的事：
--
-- 1. chunk 的**归属**（这个切片讲的是哪个微知识点）需要落库。
--    它和答案块不是一回事：归属是确定性的（页级区间唯一可判），
--    答案块是 (chunk × 微知识点) 的关系（ADR-0001）。归属 1:1，所以是列；
--    答案块 N:M，所以是表。混在一起会让「这个 chunk 属于谁」有歧义。
--
-- 2. 先修边要能被**追溯与复核**，光有一句 evidence 字符串不够——
--    需要知道证据出自哪一页、哪个 chunk。jsonb 存证据数组，
--    这样「这条边凭什么存在」可以直接在数据库页点开看。

ALTER TABLE app.chunks
  ADD COLUMN IF NOT EXISTS micro_kp_id text
  REFERENCES app.knowledge_points(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS chunk_kp_idx ON app.chunks (micro_kp_id);

-- 页码是导入后最常被拿来核对的东西（"这个知识点出自哪几页"），单独建索引。
CREATE INDEX IF NOT EXISTS chunk_page_idx ON app.chunks (source_id, page);

-- kp_edges.evidence 目前是 text。改成 jsonb 数组会破坏已有行，
-- 所以另开一列存结构化证据，旧列保留作短摘要（人工写的一句说明）。
ALTER TABLE app.kp_edges
  ADD COLUMN IF NOT EXISTS evidence_detail jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 知识点的页码溯源（目录自带，见 tools/ingest/toc.py）
ALTER TABLE app.knowledge_points
  ADD COLUMN IF NOT EXISTS source_page int;

-- 同一本书重复导入时不能产生重复知识点：id 来自目录编号，天然稳定，
-- 但需要知道它来自哪个来源。
ALTER TABLE app.knowledge_points
  ADD COLUMN IF NOT EXISTS source_id text REFERENCES app.sources(id) ON DELETE SET NULL;
