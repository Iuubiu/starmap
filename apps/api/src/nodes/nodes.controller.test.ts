import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
      // spec 显式给空对象，别再依赖列默认值：0004 之后 `levels.spec` 已经
      // 没有默认值了（那个 `DEFAULT '{}'` 把「忘了写 spec」藏成了运行时 500）。
      // 这个用例只验 level_items 的计数，从不读 spec，所以显式写空是诚实的
      // 声明「这里不关心 spec」，而不是又一次忘记。
      `INSERT INTO ${schema.name}.levels (id, micro_kp_id, title, kind, ordinal, spec)
       VALUES ('lv-1', 'kp-noise', '噪声从哪里来', 'teach', 1, '{}'::jsonb)`,
    );
    await db.query(
      `INSERT INTO ${schema.name}.level_items
         (id, level_id, stem, answer, explain_correct, explain_wrong, variant_group, pool)
       VALUES ('it-1', 'lv-1', '串联电阻热噪声与温度的关系？', '{"value":"正比于 sqrt(T)"}',
               '热噪声功率正比于温度', '注意是功率正比 T，电压正比 sqrt(T)', 'vg-1', 'quiz')`,
    );

    // 掌握度的**唯一**真源是 `attempts` 回放（见 `mastery.service.ts` 的文件头）。
    //
    // 这里曾经插的是一行 `mastery` 快照（0.62/0.48/familiar/9 次），于是
    // 「有证据时 percent 是数字」那条断言验证的是一个错误的事实：`/nodes`
    // 当时直读快照列，`/mastery/:id` 走回放，同一个知识点两个接口两个数。
    // 现在种子必须是真正的作答证据。
    //
    // 9 次作答跨 3 个变式组：刚好越过 `MASTERY_MIN_ATTEMPTS(8)` 与
    // `MASTERY_MIN_VARIANTS(3)`。少一条回放就会（正确地）给出 null 而不是数字
    // ——那是「证据不足」的正确答案，不是更好的测试数据。
    await db.query(
      `INSERT INTO ${schema.name}.attempts
         (micro_kp_id, item_id, variant_group, correct, counts_toward_mastery, knowledge_kind, created_at)
       SELECT 'kp-noise', 'it-1', 'vg-' || (i % 3), true, true, 'concept',
              now() - (i || ' minutes')::interval
         FROM generate_series(1, 9) AS i`,
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
    // 数字来自回放，不再是快照列里那个 0.48 常量。具体值由下面的
    // 「与 /mastery/:id 逐位相等」那条测试对账，这里只验「是数字」。
    expect(typeof byId['kp-noise']).toBe('number');
    expect(byId['kp-noise']).toBeGreaterThan(0);
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

  // ---------------------------------------------------------------------------
  // 票 23：nodes 与 mastery 必须同源
  // ---------------------------------------------------------------------------

  it('只有 mastery 快照行、没有 attempts ⇒ /nodes/:id 与 /mastery/:id 都报 unseen 且 attemptCount 都是 0', async () => {
    // 这条是本次修的真缺陷的最小复现：captain 在生产库上用探针造过同一形状
    // （只插 `app.mastery` 一行 0.9/proficient，零条 attempts），当时
    // `/nodes/:id` 报 `proficient / 0.9`、`/mastery/:id` 报 `unseen / null`。
    //
    // 断言两边**都**是 unseen，而不是只说「nodes 变了」：只收紧一边的话，
    // 将来谁把 mastery 改成读快照，这条测试会继续绿。
    const db = app.get(DatabaseService);
    await db.query(
      `INSERT INTO ${schema.name}.knowledge_points (id, module_id, name, is_leaf, depth, ordinal)
       VALUES ('kp-snapshot-only', 'm-a', '只有快照没有证据的点', true, 1, 9)`,
    );
    await db.query(
      `INSERT INTO ${schema.name}.mastery
         (micro_kp_id, achieved, current, state, attempt_count, variant_count, evidence_sufficient)
       VALUES ('kp-snapshot-only', 0.9, 0.9, 'proficient', 10, 4, true)`,
    );

    const node = await request(app.getHttpServer())
      .get('/api/v1/nodes/kp-snapshot-only')
      .expect(200);
    expect(node.body.node.state).toBe('unseen');
    expect(node.body.node.percent).toBeNull();

    const mastery = await request(app.getHttpServer())
      .get('/api/v1/mastery/kp-snapshot-only')
      .expect(200);
    expect(mastery.body.state).toBe('unseen');
    expect(mastery.body.attemptCount).toBe(0);
    expect(mastery.body.current).toBeNull();

    // 两个接口必须说同一件事，不是「各自都说得像自己那套」
    expect(node.body.node.state).toBe(mastery.body.state);
    expect(node.body.node.percent).toBe(mastery.body.current);
  });

  it('列表里的 percent 与 /mastery/:id 的 current 逐位相等（同一时刻、同一算法）', async () => {
    const server = app.getHttpServer();
    const list = await request(server).get('/api/v1/nodes?limit=200').expect(200);
    const byId = new Map<string, number | null>(
      list.body.items.map((n: { microKpId: string; percent: number | null }) => [n.microKpId, n.percent]),
    );

    // 逐个知识点对账，不只抽查 kp-noise：抽查会让「大部分节点仍走旧路径」
    // 这种半途而废的改法溜过去。
    let compared = 0;
    for (const [microKpId, percent] of byId) {
      const mastery = await request(server).get(`/api/v1/mastery/${microKpId}`).expect(200);
      expect(percent).toBe(mastery.body.current);
      expect(percent === null ? null : typeof percent).toBe(
        mastery.body.current === null ? null : typeof mastery.body.current,
      );
      compared += 1;
    }
    expect(compared).toBeGreaterThan(1);
  });

  it('SQL 查询次数不随节点数增长：200 个节点与 2 个节点的查询次数相同', async () => {
    // 验收要求「`/nodes?limit=200` 时 SQL 查询次数不随节点数增长」。
    //
    // 计数点在 `DatabaseService.query`：`MasteryService` 的 `runner` 就是通过
    // 它落到池上的，所以「在循环里逐个查」会直接反映成调用次数。
    const db = app.get(DatabaseService);
    const original = db.query.bind(db);
    let calls = 0;
    const spy = vi.spyOn(db, 'query').mockImplementation((...args: Parameters<typeof original>) => {
      calls += 1;
      return original(...args);
    });

    try {
      calls = 0;
      await request(app.getHttpServer()).get('/api/v1/nodes?limit=2').expect(200);
      const twoNodes = calls;

      // 直接插 48 个叶子节点，把列表拉到 50 条（默认 limit）；一次批量回放
      // 应当仍是同样几条 SQL。
      await db.query(
        `INSERT INTO ${schema.name}.knowledge_points (id, module_id, name, is_leaf, depth, ordinal)
         SELECT 'kp-bulk-' || i, 'm-a', '批量节点 ' || i, true, 1, 100 + i
           FROM generate_series(1, 48) AS i`,
      );

      calls = 0;
      await request(app.getHttpServer()).get('/api/v1/nodes?limit=200').expect(200);
      const manyNodes = calls;

      // 判据是「不随节点数增长」，不是某个魔数：50 个节点与 2 个节点的查询
      // 次数必须一样。写成固定上限（例如 <= 4）会在加一条无关查询时误报。
      expect(manyNodes).toBe(twoNodes);
    } finally {
      spy.mockRestore();
    }
  });
});
