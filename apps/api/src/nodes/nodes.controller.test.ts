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

describe('NodesController（集成）', () => {
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
    // 用独立 schema 隔离；切换后整个连接池重建
    await db.useSchema(schema.name);
    await app.init();

    // 种两棵树：一个叶节点 + 它的父节点，验证「只有叶节点持有掌握度」
    await db.query(
      `INSERT INTO ${schema.name}.subjects (id, name) VALUES ('nuclear', '核电子学')`,
    );
    await db.query(
      `INSERT INTO ${schema.name}.modules (id, subject_id, name, tier, ordinal)
       VALUES ('m-a', 'nuclear', '信号与噪声', 'A', 1)`,
    );
    await db.query(
      `INSERT INTO ${schema.name}.knowledge_points (id, module_id, parent_id, name, is_leaf, depth, ordinal)
       VALUES ('kp-root', 'm-a', NULL, '前置放大器', false, 0, 1),
              ('kp-noise', 'm-a', 'kp-root', '电荷灵敏前放的噪声来源', true, 1, 1)`,
    );
    await db.query(
      `INSERT INTO ${schema.name}.mastery (micro_kp_id, achieved, current, state, attempt_count, variant_count)
       VALUES ('kp-noise', 0.62, 0.48, 'familiar', 9, 3)`,
    );
    await db.query(
      `INSERT INTO ${schema.name}.levels (id, micro_kp_id, title, kind, ordinal)
       VALUES ('lv-1', 'kp-noise', '噪声从哪里来', 'teach', 1)`,
    );
    await db.query(
      `INSERT INTO ${schema.name}.level_items
         (id, level_id, stem, answer, explain_correct, explain_wrong, variant_group, pool)
       VALUES ('it-1', 'lv-1', '串联电阻热噪声与温度的关系？', '{"value":"正比于 sqrt(T)"}',
               '热噪声功率正比于温度', '注意是功率正比 T，电压正比 sqrt(T)', 'vg-1', 'quiz')`,
    );
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await schema?.drop();
  });

  it('调试：确认种子数据写到了测试 schema', async () => {
    const db = app.get(DatabaseService);
    const sp = await db.query<{ search_path: string }>('SHOW search_path');
    expect(sp[0]?.search_path).toContain(schema.name);
    const rows = await db.query<{ id: string }>('SELECT id FROM knowledge_points');
    expect(rows.map((r) => r.id).sort()).toEqual(['kp-noise', 'kp-root']);
  });

  it('GET /api/v1/health 返回真实数据库时间', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
    // 真库时间不是固定值：与当前时钟差在 5 分钟内
    const drift = Math.abs(Date.now() - new Date(res.body.dbNow).getTime());
    expect(drift).toBeLessThan(5 * 60_000);
    assertMatchesContract('/api/v1/health', 'get', 200, res.body);
  });

  it('GET /api/v1/nodes 只返回叶节点（掌握度不挂在父节点上）', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nodes').expect(200);
    const ids = res.body.items.map((n: { microKpId: string }) => n.microKpId);
    expect(ids).toEqual(['kp-noise']);
    expect(ids).not.toContain('kp-root');
    assertMatchesContract('/api/v1/nodes', 'get', 200, res.body);
  });

  it('有证据时 percent 是数字，无证据时为 null 而不是 0', async () => {
    await app.get(DatabaseService).query(
      `INSERT INTO ${schema.name}.knowledge_points (id, module_id, name, is_leaf, depth, ordinal)
       VALUES ('kp-none', 'm-a', '还没学过的点', true, 1, 2)`,
    );
    const res = await request(app.getHttpServer()).get('/api/v1/nodes').expect(200);
    const byId = Object.fromEntries(
      res.body.items.map((n: { microKpId: string; percent: number | null }) => [n.microKpId, n.percent]),
    );
    expect(byId['kp-noise']).toBeCloseTo(0.48, 4);
    expect(byId['kp-none']).toBeNull();
  });

  it('GET /api/v1/nodes/:id 带出关卡与可解释推荐理由', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nodes/kp-noise').expect(200);
    expect(res.body.node.microKpId).toBe('kp-noise');
    expect(res.body.levels).toHaveLength(1);
    expect(res.body.levels[0].itemCount).toBe(1);
    expect(res.body.reasons.length).toBeGreaterThan(0);
    assertMatchesContract('/api/v1/nodes/{microKpId}', 'get', 200, res.body);
  });

  it('不存在的节点返回统一错误结构而不是堆栈', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nodes/不存在').expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toContain('不存在');
    expect(res.body.stack).toBeUndefined();
    assertMatchesContract('/api/v1/nodes/{microKpId}', 'get', 404, res.body);
  });

  it('父节点不会因为子节点有掌握度而被当成叶节点返回', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nodes').expect(200);
    const ids = res.body.items.map((n: { microKpId: string }) => n.microKpId);
    expect(ids).not.toContain('kp-root');
  });
});
