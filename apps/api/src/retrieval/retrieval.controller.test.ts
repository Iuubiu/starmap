import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../db/database.service.js';
import { LLM_PORT } from '../llm/llm.port.js';
import { ScriptedLlm } from '../llm/scripted-llm.js';
import { assertMatchesContract } from '../../test/contract.js';
import { createTestSchema, type TestSchema } from '../../test/test-schema.js';

/**
 * 检索门控的接口级测试（票 09）。
 *
 * ## 为什么不只测 engine 的纯函数
 *
 * `filterChunks` 的单元测试证明「给定答案块集合与档位，函数算对了」。但票 09
 * 真正要求的是一条**端到端**的事实：同一次检索、同一个 chunk，换个知识点当
 * 上下文，门控结论就反过来。这条事实横跨 `chunk_kp_answer`（关系）、
 * `mastery`（current）、检索层的两次过滤，任何一段接错都会让它悄悄失效，
 * 而失效的表现是「答案进了提示词」——没有报错，只有教学质量下降。
 *
 * ## 关于真实语料
 *
 * `tools/ingest/assign.py` 按页区间把每个 chunk 二分为**唯一一个**归属微知识点，
 * 所以生产库里不存在「一个 chunk 同时是 A、B 两点的答案」这种数据
 * （实测：3546 chunk / 524 答案块 / 被两个以上知识点标为答案的 0 个）。
 * 因此这里自己种语料：`ck-ans` 对 kp-a 是答案块、对 kp-b 不是；`ck-bg2` 反过来。
 * 这不是为了迁就实现，而是要验的行为本来就只在这种数据上可观测 ——
 * 如果实现退化成「全库布尔」（把答案块当成 chunk 的固有属性），这两个方向的
 * 断言会同时垮掉。
 *
 * ## 答案附录：`chunk_kp_answer` 查不到的那 514 个 chunk
 *
 * 真实库里还有一类答案块**不在 `chunk_kp_answer` 里**（对叶知识点的查询而言）：
 * 4 个「部分习题答案」附录节点是 `is_leaf = false` 的容器，名下共 514 个 chunk：
 *
 * | 节点 | chunk 数 | 自己的 chunk_kp_answer 标注 |
 * | --- | --- | --- |
 * | `kp-kanghuaguang-5e-p573-部分习题答案` | 202 | 118 |
 * | `kp-tongshibai-5e-p609-部分自测题和习题答案` | 98 | 47 |
 * | `kp-lihansun-5e-vol1-p305-部分习题答案上册` | 84 | 32 |
 * | `kp-yanshi-6e-p464-部分习题答案` | 130 | 58 |
 *
 * 那 255 对标注是**空转的**：`answerChunkIdsFor` 永远以叶节点 id 调用，永远查不到
 * 容器节点自己的标注。实测 background 档（最保守）300 次检索里 29 次（9.7%）
 * 放行了附录原文。
 *
 * 所以 `src-2`（第二本书）种出同样的形状：叶节点 `kp-d` / `kp-e` + **非叶**附录
 * 容器 `kp-book2-p100-部分习题答案`，附录里的 chunk 只挂在容器上、不被任何叶节点
 * 标注。三条断言分别覆盖：排除（负向）、命中确实存在（正向对照）、跨书隔离。
 */

let app: INestApplication;
let schema: TestSchema;

/** 测试语料。三个 chunk 共用同一批查询词，保证一次检索能同时命中它们。 */
const CORPUS = [
  {
    id: 'ck-ans',
    kind: 'text',
    ordinal: 1,
    text: '电荷灵敏前置放大器的输出噪声主要由反馈电阻的热噪声决定，等效噪声电荷与成形时间有关。',
  },
  {
    id: 'ck-bg',
    kind: 'text',
    ordinal: 2,
    text: '前置放大器的输入端接探测器，输出端接成形网络；噪声来源包括热噪声与散粒噪声。',
  },
  {
    id: 'ck-formula',
    kind: 'formula',
    ordinal: 3,
    text: '前置放大器噪声的等效噪声电荷随成形时间上升，公式 ENC = sqrt(4kT/RF) 给出热噪声项。',
  },
  {
    id: 'ck-bg2',
    kind: 'text',
    ordinal: 4,
    text: '噪声测量时要注意屏蔽与接地，前置放大器的位置尽量靠近探测器以减少引线电容。',
  },
] as const;

/** 查询词：与每个 chunk 至少共享一个二元组，所以一次检索命中全部四块。 */
const QUERY = '前置放大器噪声';

/**
 * 第二本书的查询词。
 *
 * 必须与 `QUERY` 完全不共享二元组，否则这些 chunk 会出现在上面几条用例的
 * 候选里，把 `answerChunkCount === 1` 之类的断言撞坏 —— 那会让人以为是门控
 * 坏了，其实只是语料串了。
 */
const APPENDIX_QUERY = '奇偶检测电路 真值表';

beforeAll(async () => {
  schema = await createTestSchema();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LLM_PORT)
    .useValue(new ScriptedLlm([{ text: '假的' }]))
    .compile();

  app = moduleRef.createNestApplication();
  const db = app.get(DatabaseService);
  await db.useSchema(schema.name);
  await app.init();

  const q = (sql: string, params: readonly unknown[] = []) => db.query(sql, params);

  await q(`INSERT INTO ${schema.name}.subjects (id, name) VALUES ('nuclear', '核电子学')`);
  await q(
    `INSERT INTO ${schema.name}.modules (id, subject_id, name, tier, ordinal)
     VALUES ('m-a', 'nuclear', '信号与噪声', 'A', 1)`,
  );
  // sources 必须先插：knowledge_points.source_id 有外键。
  await q(
    `INSERT INTO ${schema.name}.sources (id, title, kind)
     VALUES ('src-1', '核电子学基础', 'book'), ('src-2', '数字电子技术基础', 'book')`,
  );
  await q(
    `INSERT INTO ${schema.name}.knowledge_points (id, module_id, name, is_leaf, depth, ordinal, source_id)
     VALUES ('kp-a', 'm-a', '电荷灵敏前置放大器', true, 1, 1, 'src-1'),
            ('kp-b', 'm-a', '噪声测量与屏蔽', true, 1, 2, 'src-1'),
            ('kp-c', 'm-a', '成形时间与信噪比', true, 1, 3, 'src-1'),
            -- 故意**不给 source_id**：真实库里存在没有来源归属的知识点，
            -- 而跨书隔离最容易在两处出错 —— 「判错书」和「NULL 被当成通配」。
            -- 这条覆盖后者。
            ('kp-null', 'm-a', '无来源知识点', true, 1, 4, NULL)`,
  );
  for (const chunk of CORPUS) {
    await q(
      `INSERT INTO ${schema.name}.chunks (id, source_id, ordinal, kind, text, page, micro_kp_id)
       VALUES ($1, 'src-1', $2, $3, $4, $2, $5)`,
      [chunk.id, chunk.ordinal, chunk.kind, chunk.text, chunk.id === 'ck-bg2' ? 'kp-b' : 'kp-a'],
    );
  }

  // 答案块是 (chunk, 知识点) 关系，三个方向 —— 这是本文件的核心数据。
  // 注意 `ck-ans` 同时是 kp-a 与 kp-c 的答案块：一个 chunk 被多个知识点标为
  // 答案在生产库里不存在，但关系表允许，测试正好用它验证「结论取决于上下文
  // 知识点，而不是 chunk 的固有属性」。
  await q(
    `INSERT INTO ${schema.name}.chunk_kp_answer (chunk_id, micro_kp_id)
     VALUES ('ck-ans', 'kp-a'), ('ck-bg2', 'kp-b'), ('ck-ans', 'kp-c')`,
  );

  // 两个知识点都停在脚手架档（0.4 ≤ current < 0.7）。同档位对比，排除
  // 「结论不同只是因为档位不同」这个混淆因素。
  await q(
    `INSERT INTO ${schema.name}.mastery (micro_kp_id, achieved, current, state)
     VALUES ('kp-a', 0.58, 0.55, 'familiar'), ('kp-b', 0.58, 0.55, 'familiar')`,
  );

  // ---- 第二本书：答案附录的形状（复刻真实库那 5 个容器的结构） ----------
  //
  // 关键点：`ck-appendix` **没有任何 `chunk_kp_answer` 标注**。它只通过
  // 「所属节点是答案附录」这一层关系成为答案块。如果门控只看
  // `chunk_kp_answer`，这块原文就会在 background 档被放行。
  //
  // `is_answer_key = true` 是**导入管线会写下的事实**（`toc.is_answer_key_title()`
  // 派生：附件 + 标题以答案/解答收尾）。fixture 必须把它写全 —— 判据现在只读
  // 这一列，测试若靠节点名字蒙对，测的就是一条已经不存在的分支。
  await q(
    `INSERT INTO ${schema.name}.knowledge_points
       (id, module_id, name, is_leaf, depth, ordinal, source_id, is_answer_key)
     VALUES ('kp-d', 'm-a', '奇偶检测电路', true, 2, 1, 'src-2', false),
            ('kp-e', 'm-a', '竞争冒险', true, 2, 2, 'src-2', false),
            ('kp-book2-p100-部分习题答案', 'm-a', '部分习题答案', false, 2, 3, 'src-2', true),
            ('kp-book2-p101-部分习题答案', 'm-a', '部分习题解答（下册）', false, 2, 4, 'src-2', true)`,
  );
  await q(
    `INSERT INTO ${schema.name}.chunks (id, source_id, ordinal, kind, text, page, micro_kp_id)
     VALUES ('ck-appendix', 'src-2', 10, 'formula',
             '题4.1 奇偶检测电路的真值表：Y = ABC'' + AB''C + A''BC + A''B''C''，偶数个 1 时输出为 1。',
             100, 'kp-book2-p100-部分习题答案'),
            ('ck-appendix2', 'src-2', 11, 'text',
             '题4.1 的解答见附录。奇偶检测电路的真值表共有四行为 1，其余四行为 0。',
             101, 'kp-book2-p101-部分习题答案'),
            ('ck-book2-bg', 'src-2', 12, 'text',
             '奇偶检测电路在数字系统中用于判断数据位里 1 的个数是否为偶数。',
             90, 'kp-d')`,
  );
  // kp-d 自己**有一对**答案标注：这样「并集真的生效」才能用一个数字证明
  // （附录 2 块 + 自己 1 块 = 3 > 1），而不是两条查询里有一条静默返回空集。
  await q(
    `INSERT INTO ${schema.name}.chunk_kp_answer (chunk_id, micro_kp_id)
     VALUES ('ck-book2-bg', 'kp-d')`,
  );

  // ---- 第三种来源：`is_answer_key` 列（权威来源，名字不带「答案」也一样拦） ----
  //
  // 前两个附录节点靠**名字**命中（`NOT is_leaf AND name ~ '答案|解答'` 兜底分支）。
  // 这条的节点名字叫「题解汇编」——它不含「答案」也含「解答」……为了证明**列**
  // 真的被读到，这里刻意用了一个正则完全匹配不到的名字：
  // 「部分习题参考」既不以「答案」也不以「解答」收尾。
  //
  // 若判据只写正则（或列还没被读取），`ck-answer-key` 会被当成普通正文放行。
  await q(
    `INSERT INTO ${schema.name}.knowledge_points
       (id, module_id, name, is_leaf, depth, ordinal, source_id, is_answer_key)
     VALUES ('kp-book2-ref', 'm-a', '部分习题参考', false, 2, 5, 'src-2', true)`,
  );
  await q(
    `INSERT INTO ${schema.name}.chunks (id, source_id, ordinal, kind, text, page, micro_kp_id)
     VALUES ('ck-answer-key', 'src-2', 13, 'text',
             '题5.2 的参考解法：先列出真值表，再按卡诺图合并相邻项，结果为 Y = A + B。',
             110, 'kp-book2-ref')`,
  );
}, 60_000);

afterAll(async () => {
  await app?.close();
  await schema?.drop();
});

interface DebugHit {
  chunkId: string;
  isAnswerChunk: boolean;
  allowed: boolean;
  tier: string;
  exclusionReason: string | null;
}

interface DebugBody {
  gateTier: string;
  current: number | null;
  hits: DebugHit[];
  totalMatched: number;
  answerChunkCount: number;
  excludedCount: number;
}

async function debug(microKpId: string, query = QUERY): Promise<DebugBody> {
  const res = await request(app.getHttpServer())
    .get('/api/v1/agent/retrieval/debug')
    .query({ query, microKpId })
    .expect(200);
  assertMatchesContract('/api/v1/agent/retrieval/debug', 'get', 200, res.body);
  return res.body as DebugBody;
}

function hitOf(body: DebugBody, chunkId: string): DebugHit {
  const hit = body.hits.find((h) => h.chunkId === chunkId);
  if (!hit) throw new Error(`命中里没有 ${chunkId}：${body.hits.map((h) => h.chunkId).join(',')}`);
  return hit;
}

describe('同一个 chunk 在两个知识点下门控结论相反', () => {
  it('ck-ans 对 kp-a 是答案块 → 排除；对 kp-b 不是 → 采用', async () => {
    const asA = await debug('kp-a');
    const asB = await debug('kp-b');

    // 前提：两次检索是同一个档位，结论差异不可能来自档位
    expect(asA.gateTier).toBe('scaffold');
    expect(asB.gateTier).toBe('scaffold');

    const underA = hitOf(asA, 'ck-ans');
    const underB = hitOf(asB, 'ck-ans');

    expect(underA.isAnswerChunk).toBe(true);
    expect(underA.allowed).toBe(false);
    expect(underA.exclusionReason).toBe('该片段包含最终答案，脚手架档只提供结构与定义');

    expect(underB.isAnswerChunk).toBe(false);
    expect(underB.allowed).toBe(true);
    expect(underB.exclusionReason).toBeNull();
  });

  it('反方向同样成立：ck-bg2 对 kp-b 是答案块、对 kp-a 不是', async () => {
    const asA = await debug('kp-a');
    const asB = await debug('kp-b');

    expect(hitOf(asA, 'ck-bg2').allowed).toBe(true);
    expect(hitOf(asB, 'ck-bg2').isAnswerChunk).toBe(true);
    expect(hitOf(asB, 'ck-bg2').allowed).toBe(false);
  });

  it('排除原因是逐块的，不是整次检索一刀切', async () => {
    const body = await debug('kp-a');
    const allowed = body.hits.filter((h) => h.allowed).map((h) => h.chunkId);
    const excluded = body.hits.filter((h) => !h.allowed).map((h) => h.chunkId);

    // 同一次检索里既有采用也有排除 —— 否则「两个知识点结论相反」可能只是
    // 因为一个知识点把一切都排除了。
    expect(allowed.length).toBeGreaterThan(0);
    expect(excluded).toContain('ck-ans');
    expect(allowed).not.toContain('ck-ans');
  });
});

describe('三档的允许集合差异恰好等于答案块集合', () => {
  it('scaffold 与 full 的差集 == 当前知识点的答案块集合（在候选范围内）', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/agent/retrieval/bands')
      .query({ query: QUERY, microKpId: 'kp-a', limit: 50 })
      .expect(200);
    assertMatchesContract('/api/v1/agent/retrieval/bands', 'get', 200, res.body);

    const body = res.body as {
      answerChunkIds: string[];
      bands: Array<{ current: number; gateTier: string; allowedIds: string[]; excludedIds: string[] }>;
    };

    const background = body.bands.find((b) => b.gateTier === 'background');
    const scaffold = body.bands.find((b) => b.gateTier === 'scaffold');
    const full = body.bands.find((b) => b.gateTier === 'full');
    expect(background).toBeDefined();
    expect(scaffold).toBeDefined();
    expect(full).toBeDefined();

    // 档位与 current 的映射要能被页面直接摆出来（调试器要展示这个关系）
    expect(background!.current).toBeLessThan(0.4);
    expect(scaffold!.current).toBeGreaterThanOrEqual(0.4);
    expect(scaffold!.current).toBeLessThan(0.7);
    expect(full!.current).toBeGreaterThanOrEqual(0.7);

    const scaffoldAllowed = new Set(scaffold!.allowedIds);
    const fullAllowed = new Set(full!.allowedIds);

    // 这是票 09 要的那条集合运算：full 比 scaffold 多出来的，恰好是答案块。
    const extraInFull = [...fullAllowed].filter((id) => !scaffoldAllowed.has(id)).sort();
    const answerIdsInCandidates = [...fullAllowed]
      .filter((id) => body.answerChunkIds.includes(id))
      .filter((id) => !scaffoldAllowed.has(id))
      .sort();
    expect(extraInFull).toEqual(answerIdsInCandidates);
    expect(extraInFull).toEqual(['ck-ans']);
  });

  it('背景档额外排除公式：它属于脚手架档的结构内容', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/agent/retrieval/bands')
      .query({ query: QUERY, microKpId: 'kp-a', limit: 50 })
      .expect(200);

    const body = res.body as {
      bands: Array<{ gateTier: string; allowedIds: string[]; excludedIds: string[] }>;
    };
    const background = body.bands.find((b) => b.gateTier === 'background')!;
    const scaffold = body.bands.find((b) => b.gateTier === 'scaffold')!;

    expect(background.excludedIds).toContain('ck-formula');
    expect(scaffold.allowedIds).toContain('ck-formula');
  });

  it('三档的 current 用的是档内中值，不是阈值本身', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/agent/retrieval/bands')
      .query({ query: QUERY, microKpId: 'kp-a' })
      .expect(200);

    const currents = (res.body as { bands: Array<{ current: number }> }).bands.map((b) => b.current);
    // 用 0.4 / 0.7 本身做代表值，一旦比较符从 < 改成 <=，测试会跟着实现一起
    // 变，测不出任何东西。这里断言它们不在边界上。
    expect(currents).not.toContain(0.4);
    expect(currents).not.toContain(0.7);
  });
});

describe('调试器要能回答「这一条为什么不在上下文里」', () => {
  it('排除项带具体原因，且计数与实际条目一致', async () => {
    const body = await debug('kp-a');

    expect(body.totalMatched).toBe(body.hits.length);
    expect(body.excludedCount).toBe(body.hits.filter((h) => !h.allowed).length);
    expect(body.answerChunkCount).toBe(1);

    for (const hit of body.hits) {
      if (hit.allowed) {
        expect(hit.exclusionReason).toBeNull();
      } else {
        expect(hit.exclusionReason).toBeTruthy();
      }
    }
  });

  it('无掌握度记录时按最保守档处理，而不是当成全量', async () => {
    // kp-c 没有 mastery 行：证据不足，「没有数据」不能被当成「已经掌握」，
    // 否则对新生直接给答案。它同时把 ck-ans 标成答案块，好让「背景档的
    // 排除理由」与「脚手架档的排除理由」这两句文案都被覆盖到。
    const res = await request(app.getHttpServer())
      .get('/api/v1/agent/retrieval/debug')
      .query({ query: QUERY, microKpId: 'kp-c' })
      .expect(200);
    assertMatchesContract('/api/v1/agent/retrieval/debug', 'get', 200, res.body);

    const body = res.body as DebugBody;
    expect(body.gateTier).toBe('background');
    expect(body.current).toBeNull();

    const answer = hitOf(body, 'ck-ans');
    expect(answer.allowed).toBe(false);
    expect(answer.exclusionReason).toBe('该片段包含本知识点的答案内容，当前掌握度不足以查看答案');

    // 背景档仍然采用非答案的叙述性文本 —— 保守不等于什么都看不见
    expect(hitOf(body, 'ck-bg').allowed).toBe(true);
  });

  it('知识点不存在时返回 404 而不是空结果', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/agent/retrieval/debug')
      .query({ query: QUERY, microKpId: 'kp-missing' })
      .expect(404);
    assertMatchesContract('/api/v1/agent/retrieval/debug', 'get', 404, res.body);
    expect((res.body as { code: string }).code).toBe('NOT_FOUND');
  });

  it('缺参数时返回 400', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/agent/retrieval/debug')
      .query({ query: QUERY })
      .expect(400);
    assertMatchesContract('/api/v1/agent/retrieval/debug', 'get', 400, res.body);
    expect((res.body as { code: string }).code).toBe('VALIDATION_FAILED');
  });
});

describe('答案附录：不在 chunk_kp_answer 里的答案块', () => {
  /**
   * 这一组测的是**真实语料才有的形状**：5 个「部分习题答案 / 解答」节点是
   * `is_leaf=false` 的容器，名下 514 个 chunk 的答案标注全部空转。详见文件头。
   *
   * 五条断言必须成组看：
   * 1. 负向 —— 附录里的 chunk 在 background 档被排除，理由是答案块；
   * 2. 正向对照 —— 同一个 chunk 在 full 档被放行。**没有这条，第 1 条在
   *    「查询根本没命中」时也会通过**；
   * 3. **跨书也拦** —— 当前知识点换成另一本书的叶节点，附录 chunk 仍是答案块。
   *    这条曾写反成「跨书不拦」，实测代价是 300 次探针里 29 次（9.7%）照旧泄漏；
   * 4. 并集生效 —— `answerChunkIds` 比该知识点自己的 `chunk_kp_answer` 多；
   * 5. 原有来源没被取代 —— `chunk_kp_answer` 里的答案块照样拦。
   *
   * 判据只读 `kp.is_answer_key`（2026-10-21 起），所以 fixture 里的附录节点
   * **必须带 `is_answer_key = true`**：靠名字正则蒙对的话，测的是一条已经不
   * 存在的分支，删掉正则时这几条会一起变红（这次就是靠它们证明 fixture 缺列）。
   */

  it('附录里的 chunk 在背景档被排除为答案块，而不是被档位形态挡住', async () => {
    // kp-d 没有 mastery 行 → current 为 null → background 档（最保守）。
    // 选 background 是故意的：附录里那块 `ck-appendix` 的 kind 是 formula，
    // background 档的第二道门（档位形态）也会挡它。若只断言 allowed=false，
    // 实现完全没修也会绿 —— 必须断言 exclusionReason 指向**答案块**。
    const body = await debug('kp-d', APPENDIX_QUERY);
    expect(body.gateTier).toBe('background');

    const appendix = hitOf(body, 'ck-appendix');
    expect(appendix.isAnswerChunk).toBe(true);
    expect(appendix.allowed).toBe(false);
    // 精确到文案：`公式属于脚手架档的结构内容…` 是形态门的理由（不能接受），
    // 背景档的答案块理由在这里。
    expect(appendix.exclusionReason).toBe(
      '该片段包含本知识点的答案内容，当前掌握度不足以查看答案',
    );
    expect(appendix.exclusionReason).not.toContain('公式');
  });

  it('同一个 chunk 在 full 档被放行（正向对照：证明它确实被检索到了）', async () => {
    // 若第一条只是「没命中」，这条会因为没有 ck-appendix 而直接抛错。
    // full 档（current ≥ 0.7）放行答案块 —— 这是 spec 的设计，不是漏洞。
    const res = await request(app.getHttpServer())
      .get('/api/v1/agent/retrieval/debug')
      .query({ query: APPENDIX_QUERY, microKpId: 'kp-d', limit: 50 })
      .expect(200);
    const body = res.body as DebugBody;

    // 用 bands 端点把三档一次拿全，比逐档调 debug 更接近调试器的实际用法。
    const bandsRes = await request(app.getHttpServer())
      .get('/api/v1/agent/retrieval/bands')
      .query({ query: APPENDIX_QUERY, microKpId: 'kp-d', limit: 50 })
      .expect(200);
    const bands = bandsRes.body as {
      answerChunkIds: string[];
      bands: Array<{ gateTier: string; allowedIds: string[]; excludedIds: string[] }>;
    };
    const full = bands.bands.find((band) => band.gateTier === 'full');
    expect(full).toBeDefined();
    expect(full!.allowedIds).toContain('ck-appendix');
    expect(bands.answerChunkIds).toContain('ck-appendix');

    // 同一批候选在 background 档被排除 —— 一次请求内自证「不是没命中」
    const background = bands.bands.find((band) => band.gateTier === 'background');
    expect(background!.excludedIds).toContain('ck-appendix');
    // debug 端点也应命中同一块
    expect(body.hits.map((h) => h.chunkId)).toContain('ck-appendix');
  });

  it('跨书也拦：当前知识点在另一本书，附录 chunk 仍算答案块', async () => {
    // 这条曾经写反过（断言「不该被排除」），实测代价是 300 次探针里 29 次
    // （9.7%）仍然放行答案原文 —— 与没修一模一样。
    //
    // 错在哪：第一版要求「附录节点与当前知识点同 source_id」，理由是「A 书的
    // 附录不能影响 B 书」。这个理由对，但它推出的是「不要用 A 书的附录去标记
    // B 书的**普通** chunk」，而不是「B 书的答案附录对 A 书的学习者就不算答案」。
    // 一个 chunk 是不是答案取决于**它自己属于哪个节点**，不取决于**提问的人
    // 正在看哪本书**。
    //
    // kp-c 属于 `src-1`，而 `ck-appendix` 挂在 `src-2` 的答案附录下。kp-c 没有
    // mastery 行 → background 档（最保守）。命中是必须的：`hitOf` 在没命中时
    // 直接抛错，所以这条同时排除了「只是因为没检索到」。
    const body = await debug('kp-c', APPENDIX_QUERY);
    expect(body.gateTier).toBe('background');

    const appendix = hitOf(body, 'ck-appendix');
    expect(appendix.isAnswerChunk).toBe(true);
    expect(appendix.allowed).toBe(false);
    expect(appendix.exclusionReason).toBe(
      '该片段包含本知识点的答案内容，当前掌握度不足以查看答案',
    );
  });

  it('并集真的生效：answerChunkIds 大小 > 该叶节点自己的 chunk_kp_answer 条数', async () => {
    // 这条防的是「两条来源里有一条静默返回空集」：如果附录那条查询写错了
    // （例如 source_id 关联写反、或递归 CTE 没写对），集合会退化回只有
    // chunk_kp_answer 的部分，而上面三条断言可能因为别的路径碰巧满足。
    //
    // kp-d 自己有 1 条标注（ck-book2-bg），书里 2 个附录容器共 2 块。
    const bandsRes = await request(app.getHttpServer())
      .get('/api/v1/agent/retrieval/bands')
      .query({ query: APPENDIX_QUERY, microKpId: 'kp-d', limit: 50 })
      .expect(200);
    const { answerChunkIds } = bandsRes.body as { answerChunkIds: string[] };

    expect(answerChunkIds).toContain('ck-book2-bg'); // 自己的标注
    expect(answerChunkIds).toContain('ck-appendix'); // 附录 1
    expect(answerChunkIds).toContain('ck-appendix2'); // 附录 2（名字含「解答」）
    // 数字对照：3 > 1。用集合大小而不是「包含某几个 id」，是为了让将来
    // 加更多附录块时这条断言仍然成立，只在并集退化时才红。
    expect(answerChunkIds.length).toBeGreaterThan(1);
  });

  it('答案附录之外的答案标注照样拦（并集没有取代原有来源）', async () => {
    // kp-a 的 ck-ans 来自 chunk_kp_answer，与附录无关。若实现被改成
    // 「有附录就只看附录」，这条会红。
    const body = await debug('kp-a');
    const answer = hitOf(body, 'ck-ans');
    expect(answer.isAnswerChunk).toBe(true);
    expect(answer.allowed).toBe(false);
  });

  it('答案节点由 `is_answer_key` 列决定：标题写着「参考」也照样拦', async () => {
    // 这个节点的名字是「部分习题参考」——既不以「答案」也不以「解答」收尾。
    // 判据只读列（2026-10-21 起删掉了名称正则兜底），所以这条证明的是
    // **列真的被读到**，而不是「恰好名字像」。
    //
    // 它同时是**迁移 0006 与检索层的接线证明**：列加了、导入写了、判据读了，
    // 三者缺一，`ck-answer-key` 就会被当成普通正文放行。
    // 查询词必须与它的正文共享二元组才会命中 —— 用「真值表」「卡诺图」。
    const res = await request(app.getHttpServer())
      .get('/api/v1/agent/retrieval/debug')
      .query({ query: '真值表 卡诺图', microKpId: 'kp-e', limit: 50 })
      .expect(200);
    const body = res.body as DebugBody;
    // kp-e 没有 mastery 行 → 最保守的 background 档
    expect(body.gateTier).toBe('background');

    const hit = hitOf(body, 'ck-answer-key');
    expect(hit.isAnswerChunk).toBe(true);
    expect(hit.allowed).toBe(false);
    expect(hit.exclusionReason).toBe(
      '该片段包含本知识点的答案内容，当前掌握度不足以查看答案',
    );
  });
});
