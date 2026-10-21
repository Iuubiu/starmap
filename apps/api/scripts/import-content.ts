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
  // 章节附件（小结/习题/附录/参考文献…）与答案附录。两者都是可选字段：
  // 旧的 toc.json 没有这两键，`?? false` 兜底即可，不需要强制重跑。
  appendix?: boolean;
  answerKey?: boolean;
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
  /**
   * 该 source 下、**本次产物里已不存在**的旧知识点。
   *
   * 默认只报告不删（见 `pruneStaleKnowledgePoints` 的注释）：指向
   * `knowledge_points` 的 CASCADE 有 11 条，自动删是危险的；但静默积累同样是
   * 缺陷：t24 实测残留了 156 个幽灵节点（每次 toc.py 改名/重编号留一批），
   * `GET /api/v1/graph` 把它们当节点返回、`/recommendations` 把「上册」「豐录」
   * 推荐给学习者。
   */
  staleNodes: string[];
  /** 本次是否真的删掉了它们（`--prune-kp` 开启时才非 0） */
  prunedNodes: number;
  /**
   * 因为找不到所属章而被跳过的节点 id。
   *
   * 正常情况下应该是空数组。非空意味着目录里某棵子树接不到任何 depth==1 的祖先，
   * 那些节点在库里不存在，挂在它们下面的 chunk 会变成 orphan。导入不会因此失败
   * （部分坏目录仍值得导入），但调用方必须把这个数组打出来 —— 静默跳过才是真问题。
   */
  skippedNodes: string[];
  /**
   * 目录里重复出现的 microKpId。
   *
   * 重复 id 的后果不是报错，而是**后一条静默覆盖前一条**（`ON CONFLICT DO UPDATE`）：
   * 少一个知识点、少一棵子树、少一批 chunk 归属，而且库里看不出少过。
   * 实测来源是 OCR 把编号切错（「555 定时器」被切成 `kp-55` + 标题「5定时器…」）
   * 或目录行被拆成两条（章名与首节抢同一个 `kp-1`）。
   * 与 skippedNodes 同样处理：不因此拒绝整本导入，但必须打出来。
   */
  duplicateIds: string[];
};

/**
 * 该书的元数据。目录里没有这些，而 `sources.title` 要给人看。
 *
 * 不从这里兜底的话，`sources.title` 会退化成 sourceId（`digital-electronics-yanshi-6e`），
 * 数据库展示页上直接暴露一个英文 slug 给学习者看 —— 而项目红线是「所有面向用户展示的
 * 内容都是中文」。所以每本入库的书都必须在这里有一行。
 */
const SOURCE_META: Record<string, { title: string; path: string }> = {
  'digital-kanghua-5e': {
    title: '电子技术基础·数字部分（康华光 第5版）',
    path: '资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf',
  },
  'nuclear-electronics-wangzhiying-1989': {
    title: '核电子技术原理（王芝英 1989）',
    path: '资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf',
  },
  'nuclear-electronics-wangjingjin-1983': {
    title: '核电子学·上册（王经瑾 1983）',
    path: '资源库/books/02_核电子学_王经瑾上_原子能1983.pdf',
  },
  'nuclear-radiation-measurement-tangbin': {
    title: '核辐射测量原理（汤彬）',
    path: '资源库/books/05_核辐射测量原理_汤彬_哈工程.pdf',
  },
  'nuclear-radiation-physics-chenboxian-2011': {
    title: '核辐射物理及探测学（陈伯显、张智 2011）',
    path: '资源库/books/06_核辐射物理及探测学_陈伯显_张智_哈工程2011.pdf',
  },
  'radiation-detectors-dinghonglin-2010': {
    title: '核辐射探测器（丁洪林 2010）',
    path: '资源库/books/07_核辐射探测器_丁洪林_哈工程2010.pdf',
  },
  'nuclear-physics-experiment-methods-1997': {
    title: '原子核物理实验方法（修订第3版 1997）',
    path: '资源库/books/18_原子核物理实验方法_修订第3版_1997.pdf',
  },
  'radiation-detector-handbook-jichangsong-1990': {
    title: '核辐射探测器及其实验技术手册（汲长松 1990）',
    path: '资源库/books/19_核辐射探测器及其实验技术手册_汲长松_1990.pdf',
  },
  'analog-electronics-kanghuaguang-5e': {
    title: '电子技术基础·模拟部分（康华光 第5版）',
    path: '资源库/books/22_电子技术基础_模拟部分_康华光_第5版.pdf',
  },
  'digital-electronics-yanshi-6e': {
    title: '数字电子技术基础（阎石 第6版）',
    path: '资源库/books/23_数字电子技术基础_阎石_第6版.pdf',
  },
  'analog-electronics-tongshibai-5e': {
    title: '模拟电子技术基础（童诗白、华成英 第5版）',
    path: '资源库/books/24_模拟电子技术基础_童诗白_华成英_第5版.pdf',
  },
  'circuit-analysis-lihansun-5e-vol1': {
    title: '电路分析基础·上册（李瀚荪 第5版）',
    path: '资源库/books/25_电路分析基础_李瀚荪_第5版_上册.pdf',
  },
  // ---- 票 18 第二批：英文原版教材 + 郭江两版 ----
  'knoll-3e-2000': {
    title: '辐射探测与测量（Knoll 第3版 2000）',
    path: '资源库/books/03_Knoll_Radiation_Detection_and_Measurement_3rd_2000.pdf',
  },
  'knoll-4e-2010': {
    title: '辐射探测与测量（Knoll 第4版 2010）',
    path: '资源库/books/04_Knoll_Radiation_Detection_and_Measurement_4th_2010.pdf',
  },
  'tsoulfanidis-4e': {
    title: '辐射测量与探测（Tsoulfanidis 第4版）',
    path: '资源库/books/08_Tsoulfanidis_Measurement_and_Detection_of_Radiation_4th.pdf',
  },
  'grupen-2e-2008': {
    title: '粒子探测器（Grupen 第2版 2008）',
    path: '资源库/books/09_Grupen_Particle_Detectors_2nd_2008.pdf',
  },
  'ahmed-2e': {
    title: '辐射探测物理与工程（Ahmed 第2版）',
    path: '资源库/books/10_Ahmed_Physics_and_Engineering_of_Radiation_Detection_2nd.pdf',
  },
  'spieler-2005': {
    title: '半导体探测器系统（Spieler 2005）',
    path: '资源库/books/11_Spieler_Semiconductor_Detector_Systems_2005.pdf',
  },
  'leo-2e': {
    title: '核与粒子物理实验技术（Leo 第2版）',
    path: '资源库/books/12_Leo_Techniques_for_Nuclear_and_Particle_Physics_Experiments_2nd.pdf',
  },
  'nakhostin-2018': {
    title: '辐射探测器信号处理（Nakhostin 2018）',
    path: '资源库/books/13_Nakhostin_Signal_Processing_for_Radiation_Detectors_2018.pdf',
  },
  'rivetti-2015': {
    title: '辐射传感器 CMOS 前端电子学（Rivetti 2015）',
    path: '资源库/books/14_Rivetti_CMOS_FrontEnd_Electronics_for_Radiation_Sensors_2015.pdf',
  },
  'lutz-2007': {
    title: '半导体辐射探测器（Lutz 2007）',
    path: '资源库/books/15_Lutz_Semiconductor_Radiation_Detectors_2007.pdf',
  },
  'nicholson-1974': {
    title: '核电子学（Nicholson 1974）',
    path: '资源库/books/16_Nicholson_Nuclear_Electronics_1974.pdf',
  },
  'gilmore-2e-2008': {
    title: '实用γ射线能谱学（Gilmore 第2版 2008）',
    path: '资源库/books/17_Gilmore_Practical_Gamma-ray_Spectrometry_2nd_2008.pdf',
  },
  'debertin-1988': {
    title: 'γ与X射线能谱学（Debertin & Helmer 1988）',
    path: '资源库/books/20_Debertin_Helmer_Gamma_and_XRay_Spectrometry_1988.pdf',
  },
  'guojiang-2023': {
    title: '原子及原子核物理（郭江 第2版 2023）',
    path: '资源库/books/26_原子及原子核物理_郭江_第2版_2023.pdf',
  },
  'guojiang-2014': {
    title: '原子及原子核物理（郭江 2014 旧版）',
    path: '资源库/books/27_原子及原子核物理_郭江_2014_旧版.pdf',
  },
};

/**
 * 课程层映射（`content/course-map.json`，由 `tools/ingest/course_map.py` 生成）。
 *
 * ## 为什么模块的层归属不在这个文件里写死
 *
 * 「这本书属于哪门课」是内容侧的判断：补一本书就要加一行、改一次课程体系要
 * 重排。写死在 TS 里意味着每次改都得动 API 代码、重新过 typecheck、重新发版；
 * 而它是纯数据，应该跟 `toc.json` / `chunks.jsonl` 一样是产物。
 *
 * 所以：
 * - **课程层本身**（学期区间、先后、性质）在迁移 `0061_course_layers.sql` 里，
 *   因为那是培养方案的事实，变化极慢且必须可回滚；
 * - **书 → 层** 在 `content/course-map.json` 里，因为它跟着资源库走。
 *
 * 两边都由同一条迁移建立的外键连起来：`modules.course_layer_id`。
 */
type CourseMap = {
  version: number;
  layers: Array<{ id: string; kind: string }>;
  books: Array<{ sourceId: string; layerId: string | null; reason: string }>;
};

const COURSE_MAP_PATH = join(here, '..', '..', '..', 'content', 'course-map.json');

let courseMapCache: CourseMap | null | undefined;

/**
 * 读课程层映射。文件不存在时返回 null（不抛错）。
 *
 * 不抛错的理由：这张表是 0061 之后才有的，旧环境（还没跑迁移或还没生成产物）
 * 仍然应该能把内容导进去 —— 模块的 `course_layer_id` 留 NULL 会在库里显式地
 * 表现为「未归层」，比让整本书导不进来安全。但**必须打印警告**：静默留 NULL
 * 会让 27 本书在地图上全部落到「未归层」，而日志里一个字都没有。
 */
function loadCourseMap(): CourseMap | null {
  if (courseMapCache !== undefined) return courseMapCache;
  if (!existsSync(COURSE_MAP_PATH)) {
    console.warn(
      `⚠ 缺少课程层映射 ${COURSE_MAP_PATH}，模块的 course_layer_id 将留空。` +
        ` 先跑 python tools/ingest/course_map.py`,
    );
    courseMapCache = null;
    return null;
  }
  courseMapCache = JSON.parse(readFileSync(COURSE_MAP_PATH, 'utf8')) as CourseMap;
  return courseMapCache;
}

/**
 * 一本书的课程层。返回 `{ layerId, kind }` 或 null。
 *
 * `kind` 同时写进 `modules.tier`：`tier` 列原本是 A/B/C/D 的内容分级，但从没有
 * 任何代码读它（t36 实测 `grep -rn "modules.tier"` 零命中）。课程层的 kind
 * 是同一列里**唯一有语义的取值**，所以由这里接管；论文模块仍是 'C'，不受影响。
 */
function courseLayerOf(sourceId: string): { layerId: string; kind: string } | null {
  const map = loadCourseMap();
  if (!map) return null;
  const book = map.books.find((b) => b.sourceId === sourceId);
  if (!book || !book.layerId) return null;
  const layer = map.layers.find((l) => l.id === book.layerId);
  if (!layer) return null;
  return { layerId: layer.id, kind: layer.kind };
}

export async function importContent(
  contentDir: string,
  options: { sourceId?: string; pruneKp?: boolean } = {},
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

  // 没有任何章节点 = 目录解析坏了，不是「这本没分章」。
  //
  // 不早退的话后果是：下面 `chapterOf` 永远是 undefined，`:continue` 掉全部节点，
  // 导入照常 COMMIT、照常打印「导入完成」，只是这条链上一个知识点都没进库。
  // 已实测踩过（analog-electronics-kanghuaguang-5e 的 77 个节节点全挂在缺失的
  // 章下）。宁可在这里炸，也不要在图谱里显示一本空书。
  if (chapters.length === 0) {
    throw new Error(
      `目录里没有任何 depth==1 的章节点，导入会静默产出 0 个知识点：${sourceId}。` +
        `先修 tools/ingest 的建树逻辑（nodes_from_flat），不要跳过导入。`,
    );
  }

  // 重复 id：上面那条 `ON CONFLICT (id) DO UPDATE` 会让后一条静默覆盖前一条，
  // 于是「少了一个知识点」在库里完全不可见。只统计不拦截 —— 一本坏目录里
  // 90% 的节点仍然值得导入，但调用方必须知道少了哪几个。
  const dupCount = new Map<string, number>();
  for (const n of toc.nodes) dupCount.set(n.microKpId, (dupCount.get(n.microKpId) ?? 0) + 1);
  const duplicateIds = [...dupCount.entries()].filter(([, c]) => c > 1).map(([id]) => id);

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
    // 每章挂到本书所属的课程层（`content/course-map.json`）。`tier` 同时改写为
    // 课程层的 kind：它原来是写死的 'D'，而 A/B/C/D 那套内容分级从来没有代码读。
    const layer = courseLayerOf(sourceId);
    for (const [i, ch] of chapters.entries()) {
      const moduleId = `mod-${sourceId}-${ch.microKpId}`;
      await client.query(
        `INSERT INTO modules (id, subject_id, name, tier, ordinal, course_layer_id)
         VALUES ($1, 'nuclear', $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, ordinal = EXCLUDED.ordinal,
           tier = EXCLUDED.tier, course_layer_id = EXCLUDED.course_layer_id`,
        [moduleId, ch.name, layer?.kind ?? 'D', i + 1, layer?.layerId ?? null],
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
    // 数真正写进去的条数，而不是 `toc.nodes.length`。两者本该相等，但 `:continue`
    // 那条早退路径会让它们悄悄分叉 —— 而返回值是唯一会被人和脚本看到的数字。
    let insertedNodes = 0;
    const skipped: string[] = [];
    for (const n of ordered) {
      const chapterOf =
        n.depth === 1 ? n.microKpId : findChapterId(toc.nodes, n.microKpId) ?? chapters[0]?.microKpId;
      if (!chapterOf) {
        skipped.push(n.microKpId);
        continue;
      }
      const moduleId = `mod-${sourceId}-${chapterOf}`;
      await client.query(
        `INSERT INTO knowledge_points
           (id, module_id, parent_id, name, is_leaf, depth, ordinal, source_page, source_id, is_answer_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, parent_id = EXCLUDED.parent_id,
           is_leaf = EXCLUDED.is_leaf, depth = EXCLUDED.depth,
           ordinal = EXCLUDED.ordinal, source_page = EXCLUDED.source_page,
           source_id = EXCLUDED.source_id, is_answer_key = EXCLUDED.is_answer_key`,
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
          // 答案附录（部分习题答案/参考解答）。入库后检索侧按「同书
          // is_answer_key 的全部 chunk」取用 —— 这 4 个节点是 isLeaf=false
          // 的容器，学习者永远不会以它们为当前知识点，只靠 chunk_kp_answer
          // 查不到它们名下的 514 个 chunk，票 09 的答案门控对它们完全失效。
          n.answerKey === true,
        ],
      );
      insertedNodes += 1;
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

    // ---- 幽灵知识点：报告（默认）/ 清理（--prune-kp）----
    //
    // 知识点是 upsert，旧行从来不删 —— 这个取舍对 chunk 是对的（删除会让作答
    // 记录失去锚点），但知识点没有对应的清理路径，于是每次 toc.py 改名/重编号
    // 就留一批幽灵。t24 实测残留 156 个（占全库 6%）：`GET /api/v1/graph` 把
    // 它们当节点返回、`/recommendations` 把「上册」「豐录」「目录」推荐给学习者。
    //
    // 默认**只报告不删**：指向 knowledge_points 的 CASCADE 有 11 条，自动删是
    // 危险的（t24 手工删除前逐个核了 16 个外键位置）。但静默累积同样是缺陷，
    // 所以每次导入都必须把「这次重导会让 N 个知识点消失」打到 stderr 上。
    //
    // 只对**本次导入的这个 source** 查，不跨书：`kp-<prefix>-` 命名空间已经
    // 保证各书 id 不相交，但万一日后有人手工插入，跨书误删的后果不可逆。
    const keepKpIds = toc.nodes.map((n) => n.microKpId);
    const staleRows = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM knowledge_points
        WHERE source_id = $1 AND NOT (id = ANY($2::text[]))
        ORDER BY id`,
      [sourceId, keepKpIds],
    );
    const staleNodes = staleRows.rows.map((r) => r.id);
    let prunedNodes = 0;
    if (options.pruneKp && staleNodes.length > 0) {
      // 带 id 条件的 DELETE。绝无 TRUNCATE / 无 WHERE 的 DELETE。
      // parent_id 是 ON DELETE CASCADE，所以一棵过期子树会被整棵带走。
      const pruned = await client.query(
        `DELETE FROM knowledge_points WHERE source_id = $1 AND id = ANY($2::text[])`,
        [sourceId, staleNodes],
      );
      prunedNodes = pruned.rowCount ?? 0;
    }

    await client.query('COMMIT');

    return {
      nodes: insertedNodes,
      chunks: chunks.length,
      answers,
      edges: edges.length,
      removedChunks,
      staleNodes,
      prunedNodes,
      skippedNodes: skipped,
      duplicateIds,
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
  // 参数解析：第一个非 flag 参数是内容目录。
  //
  // `--prune-kp` 默认关闭。幽灵知识点的清理是**不可逆**的（11 条 CASCADE），
  // 所以它必须是一个人要显式敲下的意图，而不是导入的副作用。不开时只报告。
  const rawArgs = process.argv.slice(2);
  const pruneKp = rawArgs.includes('--prune-kp');
  const positional = rawArgs.filter((a) => !a.startsWith('--'));
  const dir = positional[0] ?? join(here, '..', '..', '..', 'content', 'digital-kanghua-5e');
  importContent(dir, { pruneKp })
    .then((r) => {
      const digest = createHash('sha256')
        .update(JSON.stringify(r))
        .digest('hex')
        .slice(0, 12);
      console.log(
        `导入完成：知识点 ${r.nodes}、chunk ${r.chunks}、答案块 ${r.answers}、` +
          `先修边 ${r.edges}、清理旧 chunk ${r.removedChunks}（${digest}）`,
      );
      if (r.staleNodes.length > 0) {
        if (r.prunedNodes > 0) {
          console.log(
            `已清理 ${r.prunedNodes} 个本次产物里不存在的旧知识点（--prune-kp）：`,
          );
        } else {
          // 默认路径：只报告。报告行必须让人一眼看出「这次重导会让 N 个
          // 知识点消失」，而不是埋在一堆进度输出里。
          console.warn(
            `⚠ 本次重导会让 ${r.staleNodes.length} 个知识点从图谱消失（本次产物里已不存在）：\n  ` +
              r.staleNodes.slice(0, 40).join('\n  ') +
              (r.staleNodes.length > 40 ? `\n  …还有 ${r.staleNodes.length - 40} 个` : '') +
              '\n  确认要删就重跑同一条命令并加 --prune-kp（不可逆：CASCADE 会带走子节点）',
          );
        }
      }
      if (r.skippedNodes.length > 0) {
        // 打出来而不是只留在返回值里：这条命令行是人对「导入成功」的唯一判据。
        console.warn(
          `⚠ 有 ${r.skippedNodes.length} 个节点找不到所属章，已跳过（其下 chunk 会成为 orphan）：\n  ` +
            r.skippedNodes.slice(0, 20).join('\n  ') +
            (r.skippedNodes.length > 20 ? `\n  …还有 ${r.skippedNodes.length - 20} 个` : ''),
        );
      }
      if (r.duplicateIds.length > 0) {
        console.warn(
          `⚠ 目录里有 ${r.duplicateIds.length} 个重复的 microKpId，每对只会留下一行（后盖前）：\n  ` +
            r.duplicateIds.slice(0, 20).join('\n  ') +
            (r.duplicateIds.length > 20 ? `\n  …还有 ${r.duplicateIds.length - 20} 个` : ''),
        );
      }
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('导入失败:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
