-- 语料分离：sources 增加 lang（语种）与 enabled（是否参与学习）
--
-- 背景：27 本书里 13 本是英文原版（其 `content/<id>/toc.json` 的节点带
-- ASCII `nameOriginal`，中文书没有 —— 这是一条可复算的判据，不是人工清单）。
-- 英文书的内容质量缺陷（目录折行碎片名、答案块误标、译名塌缩）已裁定
-- 推迟到下版本，因此本版本用「物理移除 + 保留 sources 行」的方式把它们
-- 从学习界面里拿掉，而不是让 5400 个节点里混着无法自证的英文节点。
--
-- 为什么保留 sources 行而不是删掉：删掉就没有地方记录「这本书存在过、
-- 是被有意停用的」；重新导入时的幂等键也依赖 sources.id。
--
-- 恢复方式：见 docs/spec/NEXT-VERSION.md，重新导入即可
--（`pnpm --filter @starmap/api content:import --dir content/<id>`）。

ALTER TABLE app.sources
  ADD COLUMN IF NOT EXISTS lang text,
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN app.sources.lang IS
  '语种：zh（中文教材）/ en（英文教材）/ paper（论文，原文英文但按中文条目入库）。由 tools/ingest 侧按 nameOriginal 是否含 ASCII 判定。';
COMMENT ON COLUMN app.sources.enabled IS
  '是否参与学习界面。false = 有意停用：其知识点与 chunk 已从库里移除，仅保留 sources 行留痕。';

CREATE INDEX IF NOT EXISTS sources_enabled_idx ON app.sources (enabled) WHERE enabled;
