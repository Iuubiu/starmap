/**
 * 把 `content/<source>/` 下的离线产物导入数据库。
 *
 * 与 `tools/ingest/run.py` 分开的原因：抽取要频繁迭代（改一次版面规则重跑
 * 559 页），入库要幂等（重跑不能产生重复行）。两者节奏不同。
 *
 * 幂等靠什么：
 * - 知识点、chunk、边的 id 全部由内容决定（目录编号 / 页码+序号+内容哈希），
 *   重跑得到同样的 id，所以 `ON CONFLICT DO UPDATE` 只会更新不会翻倍。
 * - 整批在一个事务里。中途失败不留半本书的状态。
 * - 导入前先删掉该来源的旧行？**不删**。理由：`chunks.micro_kp_id` 是
 *   `ON DELETE SET NULL`，删除会让已有作答记录失去锚点。改为按 id upsert，
 *   并删除「本次产物里已不存在」的旧 chunk（那才是真的删掉了的内容）。
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Client } from 'pg';

const here = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap';

type TocNode = {
  microKpId: string;
  name: string;
  num: string | null;
  printedPage: number;
  depth: number;
  parentId: string | null;
  isLeaf: boolean;
};

type ChunkRow = {
  id: string;
  source_id: string;
  kind: 'text' | 'formula' | 'figure' | 'table';
  text: string;
  printed_page: number;
  pdf_page: number;
  bbox: [number, number, number, number] | null;
  heading_path: string[];
  rows: unknown;
  micro_kp_id: string | null;
  answer_for: string[];
};

type EdgeRow = {
  fromId: string;
  toId: string;
  kind: 'prereq' | 'related' | 'part_of';
  evidence: Array<{
    kind: string;
    quote: string;
    printedPage: number;
    chunkId: string;
    ref: string;
  }>;
};

type Manifest = {
  chunkCount: number;
  byKind: Record<string, number>;
  pageRange: [number, number];
  contentHash: string;
};

export type ImportResult = {
  nodes: number;
  chunks: number;
  answers: number;
  edges: number;
  removedChunks: number;
};

/** 该书的元数据。目录里没有这些，而 `sources.title` 要给人看。 */
const SOURCE_META: Record<string, { title: string; path: string }> = {
  'digital-kanghua-5e': {
    title: '电子技术基础·数字部分（康华光 第5版）',
    path: '资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf',
  },
};

export async function importContent(
  contentDir: string,
  options: { sourceId?: string } = {},
): Promise<ImportResult> {
  const dir = resolve(contentDir);
  const tocPath = join(dir, 'toc.json');
  const chunksPath = join(dir, 'chunks.jsonl');
  const edgesPath = join(dir, 'edges.json');

  if (!existsSync(tocPath) || !existsSync(chunksPath)) {
    throw new Error(`内容目录不完整，缺 toc.json 或 chunks.jsonl: ${dir}`);
  }

  const toc = JSON.parse(readFileSync(tocPath, 'utf8')) as {
    sourceId: string;
    nodes: TocNode[];
  };
  const sourceId = options.sourceId ?? toc.sourceId;
  const meta = SOURCE_META[sourceId];

  const chunks: ChunkRow[] = readFileSync(chunksPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ChunkRow);

  const edges: EdgeRow[] = existsSync(edgesPath)
    ? (JSON.parse(readFileSync(edgesPath, 'utf8')) as { edges: EdgeRow[] }).edges
    : [];

  const manifest = existsSync(join(dir, 'manifest.json'))
    ? (JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest)
    : null;

  // 模块划分：目录里没有「模块」这一层，用章（depth 1）当模块名最贴近教学结构
  // （spec OQ6：学科 → 模块 → 知识点 → 微知识点，四层）。
  const chapters = toc.nodes.filter((n) => n.depth === 1);

  const client = new Client({
    connectionString: DATABASE_URL,
    // 业务表在 app schema。这里必须显式给 search_path，理由和 DatabaseService
    // 里写的一样：SQL 不写 `app.` 前缀，靠连接决定落在哪个 schema。
    // 少了这一行，第一条查询就报 `relation "subjects" does not exist`。
    options: '-c search_path=app,public',
  });
  await client.connect();
  let removedChunks = 0;

  try {
    await client.query('BEGIN');

    // ---- 学科与模块 ----
    await client.query(
      `INSERT INTO subjects (id, name) VALUES ('nuclear', '核电子学')
       ON CONFLICT (id) DO NOTHING`,
    );

    // ---- 来源 ----
    const firstPage = chunks.reduce<number | null>(
      (acc, c) => (acc === null || c.printed_page < acc ? c.printed_page : acc),
      null,
    );
    const lastPage = chunks.reduce<number | null>(
      (acc, c) => (acc === null || c.printed_page > acc ? c.printed_page : acc),
      null,
    );
    await client.query(
      `INSERT INTO sources (id, title, kind, path, meta)
       VALUES ($1, $2, 'book', $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title, path = EXCLUDED.path, meta = EXCLUDED.meta`,
      [
        sourceId,
        meta?.title ?? sourceId,
        meta?.path ?? null,
        JSON.stringify({
          nodeCount: toc.nodes.length,
          chunkCount: manifest?.chunkCount ?? chunks.length,
          byKind: manifest?.byKind ?? null,
          contentHash: manifest?.contentHash ?? null,
          printedPageRange: [firstPage, lastPage],
        }),
      ],
    );

    // ---- 模块（每章一个）----
    for (const [i, ch] of chapters.entries()) {
      const moduleId = `mod-${sourceId}-${ch.microKpId}`;
      await client.query(
        `INSERT INTO modules (id, subject_id, name, tier, ordinal)
         VALUES ($1, 'nuclear', $2, 'D', $3)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, ordinal = EXCLUDED.ordinal`,
        [moduleId, ch.name, i + 1],
      );
      // 章节点本身也是 knowledge_points 的一行，它挂在刚建的模块上
      await client.query(
        `INSERT INTO knowledge_points
           (id, module_id, parent_id, name, is_leaf, depth, ordinal, source_page, source_id)
         VALUES ($1, $2, NULL, $3, false, 0, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, module_id = EXCLUDED.module_id,
           source_page = EXCLUDED.source_page, source_id = EXCLUDED.source_id`,
        [ch.microKpId, moduleId, ch.name, i + 1, ch.printedPage, sourceId],
      );
    }

    // ---- 知识点树 ----
    // 必须先插父后插子（FK 自引用），目录本身是前序，按 depth 排序即可。
    const ordered = [...toc.nodes].sort((a, b) => a.depth - b.depth);
    for (const n of ordered) {
      const chapterOf =
        n.depth === 1 ? n.microKpId : findChapterId(toc.nodes, n.microKpId) ?? chapters[0]?.microKpId;
      if (!chapterOf) continue;
      const moduleId = `mod-${sourceId}-${chapterOf}`;
      await client.query(
        `INSERT INTO knowledge_points
           (id, module_id, parent_id, name, is_leaf, depth, ordinal, source_page, source_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, parent_id = EXCLUDED.parent_id,
           is_leaf = EXCLUDED.is_leaf, depth = EXCLUDED.depth,
           ordinal = EXCLUDED.ordinal, source_page = EXCLUDED.source_page,
           source_id = EXCLUDED.source_id`,
        [
          n.microKpId,
          moduleId,
          n.parentId,
          n.name,
          n.isLeaf,
          n.depth,
          Number.parseInt(n.num?.split('.').at(-1) ?? '0', 10) || 0,
          n.printedPage,
          sourceId,
        ],
      );
    }

    // ---- chunk ----
    for (const [i, c] of chunks.entries()) {
      await client.query(
        `INSERT INTO chunks (id, source_id, ordinal, kind, text, page, micro_kp_id, meta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           ordinal = EXCLUDED.ordinal, kind = EXCLUDED.kind, text = EXCLUDED.text,
           page = EXCLUDED.page, micro_kp_id = EXCLUDED.micro_kp_id, meta = EXCLUDED.meta`,
        [
          c.id,
          sourceId,
          i,
          c.kind,
          c.text,
          c.printed_page,
          c.micro_kp_id,
          JSON.stringify({
            pdfPage: c.pdf_page,
            bbox: c.bbox,
            headingPath: c.heading_path,
            tableRows: c.rows,
          }),
        ],
      );
    }

    // ---- 答案块关系表（chunk × 微知识点）----
    // 先清掉该来源的旧标注再写：这是纯粹的派生关系，重建比 diff 简单且更可靠。
    await client.query(
      `DELETE FROM chunk_kp_answer
        WHERE chunk_id IN (SELECT id FROM chunks WHERE source_id = $1)`,
      [sourceId],
    );
    let answers = 0;
    for (const c of chunks) {
      for (const kp of c.answer_for) {
        await client.query(
          `INSERT INTO chunk_kp_answer (chunk_id, micro_kp_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [c.id, kp],
        );
        answers += 1;
      }
    }

    // ---- 先修边 ----
    // 先删掉该来源知识点之间的旧边再写：边是派生产物，重建比 diff 可靠。
    // 只删两端都在本书里的边，不碰别的来源建的边（票 18 会加跨书边）。
    await client.query(
      `DELETE FROM kp_edges e
        USING knowledge_points f, knowledge_points t
        WHERE e.from_id = f.id AND e.to_id = t.id
          AND f.source_id = $1 AND t.source_id = $1`,
      [sourceId],
    );
    for (const e of edges) {
      const summaryText = e.evidence
        .map((ev) => `${ev.ref}（p.${ev.printedPage}）`)
        .join('；')
        .slice(0, 500);
      await client.query(
        `INSERT INTO kp_edges (from_id, to_id, kind, evidence, evidence_detail)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (from_id, to_id, kind) DO UPDATE SET
           evidence = EXCLUDED.evidence, evidence_detail = EXCLUDED.evidence_detail`,
        [e.fromId, e.toId, e.kind, summaryText, JSON.stringify(e.evidence)],
      );
    }

    // ---- 删除本次产物里已不存在的旧 chunk ----
    const keepIds = chunks.map((c) => c.id);
    const removed = await client.query(
      `DELETE FROM chunks WHERE source_id = $1 AND NOT (id = ANY($2::text[]))`,
      [sourceId, keepIds],
    );
    removedChunks = removed.rowCount ?? 0;

    await client.query('COMMIT');

    return {
      nodes: toc.nodes.length,
      chunks: chunks.length,
      answers,
      edges: edges.length,
      removedChunks,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

/** 沿 parent 链找到 depth 1 的祖先 id */
function findChapterId(nodes: TocNode[], id: string): string | null {
  const byId = new Map(nodes.map((n) => [n.microKpId, n]));
  let cur = byId.get(id);
  while (cur) {
    if (cur.depth === 1) return cur.microKpId;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return null;
}

const isMain = process.argv[1]?.replace(/\\/g, '/').includes('import-content');
if (isMain) {
  const dir = process.argv[2] ?? join(here, '..', '..', '..', 'content', 'digital-kanghua-5e');
  importContent(dir)
    .then((r) => {
      const digest = createHash('sha256')
        .update(JSON.stringify(r))
        .digest('hex')
        .slice(0, 12);
      console.log(
        `导入完成：知识点 ${r.nodes}、chunk ${r.chunks}、答案块 ${r.answers}、` +
          `先修边 ${r.edges}、清理旧 chunk ${r.removedChunks}（${digest}）`,
      );
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('导入失败:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
