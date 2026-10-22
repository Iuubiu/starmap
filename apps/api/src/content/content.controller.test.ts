import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../db/database.service.js';
import { ScriptedLlm } from '../llm/scripted-llm.js';
import { LLM_PORT } from '../llm/llm.port.js';
import { createTestSchema, type TestSchema } from '../../test/test-schema.js';
import { assertMatchesContract } from '../../test/contract.js';

/**
 * 数据库展示页的后端读数。
 *
 * 这一组测试守的是「票 02 说内容入库了，怎么证明」：
 * 数字对得上不够，还要能点开一个知识点看到它出自第几页。
 */
describe('ContentController（集成）', () => {
  let app: INestApplication;
  let schema: TestSchema;
  let db: DatabaseService;

  beforeAll(async () => {
    schema = await createTestSchema();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PORT)
      .useValue(new ScriptedLlm([{ text: '假的' }]))
      .compile();

    app = moduleRef.createNestApplication();
    db = app.get(DatabaseService);
    await db.useSchema(schema.name);
    await app.init();

    // 一棵两层的树：叶节点 kp-noise 下有 2 个 chunk，其中 1 个是答案块。
    await db.query(`INSERT INTO subjects (id, name) VALUES ('nuclear', '核电子学')`);
    await db.query(
      `INSERT INTO sources (id, title, kind) VALUES ('src-book', '测试教材', 'book')`,
    );
    await db.query(
      `INSERT INTO modules (id, subject_id, name, tier, ordinal)
       VALUES ('m-a', 'nuclear', '信号与噪声', 'A', 1)`,
    );
    await db.query(
      `INSERT INTO knowledge_points (id, module_id, parent_id, name, is_leaf, depth, ordinal)
       VALUES ('kp-root', 'm-a', NULL, '前置放大器', false, 0, 1),
              ('kp-noise', 'm-a', 'kp-root', '噪声来源', true, 1, 1)`,
    );
    await db.query(
      `INSERT INTO chunks (id, source_id, ordinal, kind, text, page, micro_kp_id)
       VALUES ('ck-1', 'src-book', 0, 'text', '热噪声功率正比于温度', 12, 'kp-noise'),
              ('ck-2', 'src-book', 1, 'formula', 'P = 4kTB', 13, 'kp-noise')`,
    );
    await db.query(
      `INSERT INTO chunk_kp_answer (chunk_id, micro_kp_id) VALUES ('ck-2', 'kp-noise')`,
    );
    await db.query(
      `INSERT INTO kp_edges (from_id, to_id, kind, evidence, evidence_detail)
       VALUES ('kp-root', 'kp-noise', 'prereq', '式(1.1.1)（p.3）',
               '[{"kind":"式引用","quote":"根据式(1.1.1)","printedPage":3,"chunkId":"ck-0","ref":"式(1.1.1"}]'::jsonb)`,
    );
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await schema?.drop();
  });

  it('GET /api/v1/content/stats 报出知识点/chunk/答案块/先修边的真实计数', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/content/stats').expect(200);
    expect(res.body.knowledgePoints).toEqual({ total: 2, leaves: 1 });
    expect(res.body.chunks.total).toBe(2);
    expect(res.body.chunks.byKind).toEqual({ formula: 1, text: 1 });
    expect(res.body.answers).toBe(1);
    expect(res.body.edges).toEqual({ total: 1, withEvidence: 1 });
    assertMatchesContract('/api/v1/content/stats', 'get', 200, res.body);
  });

  it('来源统计里答案数按 chunk 计，不按关系行数计', async () => {
    // 同一个 chunk 对两个知识点是答案时，库里是 2 行关系但只有 1 个切片。
    // 报 2 会让人以为有 2 份材料。
    await db.query(
      `INSERT INTO knowledge_points (id, module_id, parent_id, name, is_leaf, depth, ordinal)
       VALUES ('kp-noise2', 'm-a', 'kp-root', '噪声的另一种说法', true, 1, 2)`,
    );
    await db.query(
      `INSERT INTO chunk_kp_answer (chunk_id, micro_kp_id) VALUES ('ck-2', 'kp-noise2')`,
    );

    const res = await request(app.getHttpServer()).get('/api/v1/content/stats').expect(200);
    const src = res.body.sources.find((s: { id: string }) => s.id === 'src-book');
    expect(src.chunkCount).toBe(2);
    expect(src.answerChunkCount).toBe(1);
  });

  it('GET /api/v1/nodes/:id/sources 给出该知识点的页码与切片', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nodes/kp-noise/sources').expect(200);
    expect(res.body.name).toBe('噪声来源');
    expect(res.body.pages).toEqual([12, 13]);
    expect(res.body.chunks).toHaveLength(2);
    const byKind = Object.fromEntries(
      res.body.chunks.map((c: { kind: string; isAnswer: boolean }) => [c.kind, c.isAnswer]),
    );
    expect(byKind).toEqual({ text: false, formula: true });
    assertMatchesContract('/api/v1/nodes/{microKpId}/sources', 'get', 200, res.body);
  });

  it('非叶节点汇总整棵子树的来源页，而不是返回空', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nodes/kp-root/sources').expect(200);
    expect(res.body.pages).toEqual([12, 13]);
  });

  it('不存在的知识点返回 404 而不是空数组', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nodes/kp-missing/sources').expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
    assertMatchesContract('/api/v1/nodes/{microKpId}/sources', 'get', 404, res.body);
  });

  it('长文本被截断成摘要，避免列表页被整段正文撑爆', async () => {
    await db.query(`UPDATE chunks SET text = repeat('很长的正文', 100) WHERE id = 'ck-1'`);
    const res = await request(app.getHttpServer()).get('/api/v1/nodes/kp-noise/sources').expect(200);
    const text = res.body.chunks.find((c: { kind: string }) => c.kind === 'text');
    expect(text.excerpt.length).toBeLessThanOrEqual(121);
    expect(text.excerpt.endsWith('…')).toBe(true);
  });
});
