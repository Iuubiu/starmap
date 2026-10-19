-- 骨架期的核心表。全部幂等，可重复执行。
-- 业务表只在 app schema；Mastra 的表在 mastra schema，两边不互相引用（ADR-0005）。

CREATE TABLE IF NOT EXISTS app.subjects (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.modules (
  id          text PRIMARY KEY,
  subject_id  text NOT NULL REFERENCES app.subjects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  tier        text NOT NULL CHECK (tier IN ('A', 'B', 'C', 'D')),
  ordinal     int NOT NULL DEFAULT 0
);

-- 自引用树。掌握度只挂叶节点（ADR-0004），非叶节点颜色由子节点聚合派生。
CREATE TABLE IF NOT EXISTS app.knowledge_points (
  id          text PRIMARY KEY,
  module_id   text NOT NULL REFERENCES app.modules(id) ON DELETE CASCADE,
  parent_id   text REFERENCES app.knowledge_points(id) ON DELETE CASCADE,
  name        text NOT NULL,
  summary     text,
  is_leaf     boolean NOT NULL DEFAULT false,
  depth       int NOT NULL DEFAULT 0,
  ordinal     int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS kp_module_idx ON app.knowledge_points (module_id);
CREATE INDEX IF NOT EXISTS kp_parent_idx ON app.knowledge_points (parent_id);
CREATE INDEX IF NOT EXISTS kp_leaf_idx ON app.knowledge_points (is_leaf) WHERE is_leaf;

-- 先修边。每条先修边必须有证据来源，否则不能作门控依据。
CREATE TABLE IF NOT EXISTS app.kp_edges (
  from_id   text NOT NULL REFERENCES app.knowledge_points(id) ON DELETE CASCADE,
  to_id     text NOT NULL REFERENCES app.knowledge_points(id) ON DELETE CASCADE,
  kind      text NOT NULL CHECK (kind IN ('prereq', 'related', 'part_of')),
  evidence  text,
  PRIMARY KEY (from_id, to_id, kind)
);

CREATE TABLE IF NOT EXISTS app.sources (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('book', 'paper', 'video', 'other')),
  path        text,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS app.chunks (
  id          text PRIMARY KEY,
  source_id   text NOT NULL REFERENCES app.sources(id) ON DELETE CASCADE,
  ordinal     int NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('text', 'formula', 'figure', 'table')),
  text        text NOT NULL,
  page        int,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS chunk_source_idx ON app.chunks (source_id, ordinal);

-- 答案块是 (chunk, 微知识点) 的关系，不是 chunk 的固有属性（ADR-0001）。
CREATE TABLE IF NOT EXISTS app.chunk_kp_answer (
  chunk_id     text NOT NULL REFERENCES app.chunks(id) ON DELETE CASCADE,
  micro_kp_id  text NOT NULL REFERENCES app.knowledge_points(id) ON DELETE CASCADE,
  PRIMARY KEY (chunk_id, micro_kp_id)
);

CREATE TABLE IF NOT EXISTS app.levels (
  id           text PRIMARY KEY,
  micro_kp_id  text NOT NULL REFERENCES app.knowledge_points(id) ON DELETE CASCADE,
  title        text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('teach', 'quiz', 'mixed')),
  ordinal      int NOT NULL DEFAULT 0,
  spec         jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS level_kp_idx ON app.levels (micro_kp_id, ordinal);

CREATE TABLE IF NOT EXISTS app.level_items (
  id                  text PRIMARY KEY,
  level_id            text NOT NULL REFERENCES app.levels(id) ON DELETE CASCADE,
  stem                text NOT NULL,
  options             jsonb,
  answer              jsonb,
  explain_correct     text NOT NULL,
  explain_wrong       text NOT NULL,
  misconception_tags  text[] NOT NULL DEFAULT '{}',
  source_ref          text,
  variant_group       text NOT NULL,
  pool                text NOT NULL CHECK (pool IN ('quiz', 'practice'))
);

CREATE INDEX IF NOT EXISTS item_level_idx ON app.level_items (level_id);
CREATE INDEX IF NOT EXISTS item_variant_idx ON app.level_items (level_id, variant_group);

CREATE TABLE IF NOT EXISTS app.attempts (
  id            bigserial PRIMARY KEY,
  micro_kp_id   text NOT NULL REFERENCES app.knowledge_points(id) ON DELETE CASCADE,
  item_id       text NOT NULL REFERENCES app.level_items(id) ON DELETE CASCADE,
  variant_group text NOT NULL,
  correct       boolean NOT NULL,
  answer        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attempt_kp_idx ON app.attempts (micro_kp_id, created_at DESC);

-- 双字段掌握度（D2）：achieved 不衰减管解锁，current 衰减管推荐与检索门控。
CREATE TABLE IF NOT EXISTS app.mastery (
  micro_kp_id      text PRIMARY KEY REFERENCES app.knowledge_points(id) ON DELETE CASCADE,
  achieved         numeric(5, 4) NOT NULL DEFAULT 0,
  current          numeric(5, 4) NOT NULL DEFAULT 0,
  state            text NOT NULL DEFAULT 'unseen'
                   CHECK (state IN ('mastered', 'proficient', 'familiar', 'attempted', 'unseen')),
  attempt_count    int NOT NULL DEFAULT 0,
  variant_count    int NOT NULL DEFAULT 0,
  evidence_sufficient boolean NOT NULL DEFAULT false,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.sessions (
  id          text PRIMARY KEY,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS app.learning_log (
  id          bigserial PRIMARY KEY,
  session_id  text REFERENCES app.sessions(id) ON DELETE SET NULL,
  micro_kp_id text REFERENCES app.knowledge_points(id) ON DELETE CASCADE,
  event       text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS log_kp_idx ON app.learning_log (micro_kp_id, created_at DESC);
