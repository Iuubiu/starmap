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

interface GraphNodeBody {
  microKpId: string;
  name: string;
  state: string;
  percent: number | null;
  depth: number;
  moduleId: string;
  moduleName: string;
  moduleOrdinal: number;
  ordinal: number;
  reviewDueAt: string | null;
}

interface GraphEdgeBody {
  from: string;
  to: string;
  kind: string;
}

describe('GraphController（集成）', () => {
  let app: INestApplication;
  let schema: TestSchema;

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

    // 两个模块、三棵树、一个非叶父节点：验证「只返回叶节点」与
    // 「模块序 / 模块内序都带出来」（主线视图排序要用）。
    await db.query(
      `INSERT INTO ${schema.name}.subjects (id, name) VALUES ('nuclear', '核电子学')`,
    );
    await db.query(
      `INSERT INTO ${schema.name}.modules (id, subject_id, name, tier, ordinal)
       VALUES ('m-a', 'nuclear', '信号与噪声', 'A', 2),
              ('m-b', 'nuclear', '数字逻辑', 'D', 1)`,
    );
    await db.query(
      `INSERT INTO ${schema.name}.knowledge_points (id, module_id, parent_id, name, is_leaf, depth, ordinal)
       VALUES ('kp-nonleaf', 'm-a', NULL,      '前置放大器',       false, 0, 1),
              ('kp-noise',  'm-a', 'kp-nonleaf','电荷灵敏前放的噪声来源', true, 1, 1),
              ('kp-cmf',    'm-a', NULL,      '共模反馈',         true, 1, 2),
              ('kp-bool',   'm-b', NULL,      '布尔代数基本运算',   true, 1, 1)`,
    );
    await db.query(
      `INSERT INTO ${schema.name}.mastery
         (micro_kp_id, achieved, current, state, attempt_count, variant_count, evidence_sufficient)
       VALUES ('kp-noise', 0.62, 0.48, 'familiar', 9, 3, true),
              ('kp-bool',  0.91, 0.88, 'mastered', 6, 2, true)`,
    );
    await db.query(
      `INSERT INTO ${schema.name}.kp_edges (from_id, to_id, kind, evidence)
       VALUES ('kp-noise', 'kp-cmf', 'prereq', '先看懂噪声才谈得上共模抑制'),
              ('kp-bool',  'kp-cmf', 'prereq', '布尔代数用于判断反馈极性')`,
    );
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await schema?.drop();
  });

  it('返回全部叶节点，非叶节点不进图（掌握度只挂在微知识点上）', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/graph').expect(200);
    const nodes = res.body.nodes as GraphNodeBody[];
    const ids = nodes.map((n) => n.microKpId).sort();
    expect(ids).toEqual(['kp-bool', 'kp-cmf', 'kp-noise']);
    expect(ids).not.toContain('kp-nonleaf');
  });

  it('一次返回全部先修边，方向保持 from → to', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/graph').expect(200);
    const edges = res.body.edges as GraphEdgeBody[];
    expect(edges).toEqual([
      { from: 'kp-bool', to: 'kp-cmf', kind: 'prereq' },
      { from: 'kp-noise', to: 'kp-cmf', kind: 'prereq' },
    ]);
  });

  it('带出模块名与两级序号，供线性主线排序', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/graph').expect(200);
    const byId = new Map((res.body.nodes as GraphNodeBody[]).map((n) => [n.microKpId, n]));

    const bool = byId.get('kp-bool');
    expect(bool?.moduleId).toBe('m-b');
    expect(bool?.moduleName).toBe('数字逻辑');
    expect(bool?.moduleOrdinal).toBe(1);
    expect(bool?.ordinal).toBe(1);
    expect(bool?.depth).toBe(1);

    // 同一模块内的两个点保留各自 ordinal，排序不靠 id 字典序碰巧对上
    expect(byId.get('kp-noise')?.moduleOrdinal).toBe(2);
    expect(byId.get('kp-noise')?.ordinal).toBe(1);
    expect(byId.get('kp-cmf')?.ordinal).toBe(2);
  });

  it('无掌握度行 = unseen 且 percent 为 null（不是 0）', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/graph').expect(200);
    const cmf = (res.body.nodes as GraphNodeBody[]).find((n) => n.microKpId === 'kp-cmf');
    expect(cmf?.state).toBe('unseen');
    expect(cmf?.percent).toBeNull();

    const bool = (res.body.nodes as GraphNodeBody[]).find((n) => n.microKpId === 'kp-bool');
    expect(bool?.state).toBe('mastered');
    expect(bool?.percent).toBeCloseTo(0.88, 4);
  });

  it('reviewDueAt 默认 null；写了排期就原样带出（票 07 的读写分界）', async () => {
    const before = await request(app.getHttpServer()).get('/api/v1/graph').expect(200);
    for (const node of before.body.nodes as GraphNodeBody[]) {
      expect(node.reviewDueAt).toBeNull();
    }

    const db = app.get(DatabaseService);
    await db.query(
      `UPDATE ${schema.name}.mastery SET next_review_at = '2026-01-02T03:04:05Z'
       WHERE micro_kp_id = 'kp-bool'`,
    );

    const after = await request(app.getHttpServer()).get('/api/v1/graph').expect(200);
    const bool = (after.body.nodes as GraphNodeBody[]).find((n) => n.microKpId === 'kp-bool');
    expect(bool?.reviewDueAt).toBe('2026-01-02T03:04:05.000Z');
    // 未排期的点仍是 null（部分索引只管已排期的行）
    const cmf = (after.body.nodes as GraphNodeBody[]).find((n) => n.microKpId === 'kp-cmf');
    expect(cmf?.reviewDueAt).toBeNull();

    await db.query(
      `UPDATE ${schema.name}.mastery SET next_review_at = NULL WHERE micro_kp_id = 'kp-bool'`,
    );
  });

  it('响应满足契约（GraphResponse 的字段与枚举）', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/graph').expect(200);
    assertMatchesContract('/api/v1/graph', 'get', 200, res.body);
  });

  it('空库也返回合法形状而不是 null', async () => {
    // 用独立 schema 太贵，这里换个角度：删掉边，图仍要返回节点 + 空数组
    const db = app.get(DatabaseService);
    await db.query(`DELETE FROM ${schema.name}.kp_edges`);
    const res = await request(app.getHttpServer()).get('/api/v1/graph').expect(200);
    expect(res.body.edges).toEqual([]);
    expect((res.body.nodes as GraphNodeBody[]).length).toBe(3);
  });
});
