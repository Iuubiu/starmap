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
  await q(
    `INSERT INTO ${schema.name}.knowledge_points (id, module_id, name, is_leaf, depth, ordinal)
     VALUES ('kp-a', 'm-a', '电荷灵敏前置放大器', true, 1, 1),
            ('kp-b', 'm-a', '噪声测量与屏蔽', true, 1, 2),
            ('kp-c', 'm-a', '成形时间与信噪比', true, 1, 3)`,
  );
  await q(
    `INSERT INTO ${schema.name}.sources (id, title, kind)
     VALUES ('src-1', '核电子学基础', 'book')`,
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
