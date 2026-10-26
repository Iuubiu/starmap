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
    // 两本书（票 18 验收 6）：详情页要能说出「来自哪本书哪一页」。种两本而不是
    // 一本，是为了让「只 JOIN 了一张固定的书」这类错误无法蒙混过关。
    await db.query(
      `INSERT INTO ${schema.name}.sources (id, title, kind)
       VALUES ('book-a', '测试教材甲', 'book'), ('book-b', '测试教材乙', 'book')`,
    );
    await db.query(
      `INSERT INTO ${schema.name}.knowledge_points (id, module_id, parent_id, name, is_leaf, depth, ordinal, source_id, source_page)
       VALUES ('kp-root', 'm-a', NULL, '前置放大器', false, 0, 1, NULL, NULL),
              ('kp-noise', 'm-a', 'kp-root', '电荷灵敏前放的噪声来源', true, 1, 1, 'book-a', 12)`,
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

  // ---------------------------------------------------------------------------
  // 票 18 验收 6：每个知识点都能说出「来自哪本书哪一页」
  // ---------------------------------------------------------------------------

  it('真实书节点带出来源：书名、页码与给人看的 pageLabel 三样都在', async () => {
    const db = app.get(DatabaseService);
    // 第二本书（book-b）：只种一本书的话，「把书名写死成第一本」这类错误
    // 能蒙混过关。
    await db.query(
      `INSERT INTO ${schema.name}.knowledge_points
         (id, module_id, name, is_leaf, depth, ordinal, source_id, source_page)
       VALUES ('kp-adc', 'm-a', 'ADC 的量化噪声', true, 1, 5, 'book-b', 87)`,
    );

    const first = await request(app.getHttpServer()).get('/api/v1/nodes/kp-noise').expect(200);
    expect(first.body.source).toEqual({
      sourceId: 'book-a',
      title: '测试教材甲',
      page: 12,
      pageLabel: '「测试教材甲」第 12 页',
    });

    const second = await request(app.getHttpServer()).get('/api/v1/nodes/kp-adc').expect(200);
    expect(second.body.source).toEqual({
      sourceId: 'book-b',
      title: '测试教材乙',
      page: 87,
      pageLabel: '「测试教材乙」第 87 页',
    });

    // 反向对照：两个节点真的来自两本书，不是一个常量被复制了两遍
    expect(first.body.source.sourceId).not.toBe(second.body.source.sourceId);
    expect(first.body.source.page).not.toBe(second.body.source.page);

    // page 必须等于库里那一列，不能是「从 chunk 里猜的页码」
    const rows = await db.query<{ source_page: number }>(
      `SELECT source_page FROM knowledge_points WHERE id = 'kp-adc'`,
    );
    expect(second.body.source.page).toBe(rows[0]!.source_page);

    assertMatchesContract('/api/v1/nodes/{microKpId}', 'get', 200, second.body);
  });

  it('示例知识点（source_id 为 NULL）返回 source: null，而不是 404 也不是编个假书名', async () => {
    const db = app.get(DatabaseService);
    // 与真实库里的 kp-bool / kp-kmap / kp-logic 同一形状：手工种的、不来自任何书。
    await db.query(
      `INSERT INTO ${schema.name}.knowledge_points (id, module_id, name, is_leaf, depth, ordinal)
       VALUES ('kp-seed', 'm-a', '布尔代数基本运算', true, 1, 7)`,
    );

    const res = await request(app.getHttpServer()).get('/api/v1/nodes/kp-seed').expect(200);
    expect(res.body.source).toBeNull();
    // 反向对照：字段存在且是 null，不是「字段缺失」
    expect('source' in res.body).toBe(true);
    // 节点本体照常返回 —— 它在界面上可点，不能因为查不到来源就变 404
    expect(res.body.node.microKpId).toBe('kp-seed');

    assertMatchesContract('/api/v1/nodes/{microKpId}', 'get', 200, res.body);
  });

  it('全库级核对：source 为 null 的节点数 == 库里 source_id 为 NULL 的节点数', async () => {
    // 这条防的是「某本书的 source_id 悄悄丢了」。
    //
    // 只查一两个节点挡不住这种缺陷：丢的是几百个节点里的某一个，抽查很难恰好
    // 命中。这里拿**两个独立来源**对账 —— 逐个打接口看 `source`，与直接数库
    // 里的 `source_id IS NULL`。两者必须相等。
    //
    // 注意：这里数的是**测试 schema**，不是生产库的 7312 行。生产库的同一个
    // 断言靠 `pnpm verify` 里真实后端的 e2e 与人工探针（见票面 Comments）。
    const db = app.get(DatabaseService);
    const server = app.getHttpServer();

    const list = await request(server).get('/api/v1/nodes?limit=200').expect(200);
    const ids: string[] = list.body.items.map((n: { microKpId: string }) => n.microKpId);

    const nullFromApi: string[] = [];
    for (const id of ids) {
      const detail = await request(server).get(`/api/v1/nodes/${id}`).expect(200);
      if (detail.body.source === null) nullFromApi.push(id);
    }

    const rows = await db.query<{ id: string }>(
      `SELECT id FROM knowledge_points WHERE is_leaf = true AND source_id IS NULL ORDER BY id`,
    );
    const nullFromDb = rows.map((r) => r.id);

    expect(nullFromApi.sort()).toEqual(nullFromDb.sort());

    // 还得证明「有来源」是绝大多数，否则「全部 null 也相等」会让上面那条
    // 在功能完全没实现时也绿。
    expect(ids.length - nullFromApi.length).toBeGreaterThan(0);
  });

  it('有 source_id 但没有页码是数据缺陷：报错，不拼出「第 null 页」', async () => {
    // `source_page` 与 `source_id` 在生产库里一一对应（7312 行里为 NULL 的
    // 正好就是那 3 个两者都为 NULL 的示例节点）。真出现「有书没页」说明入库
    // 坏了，那时宁可 500 也不要让学习者看到「第 0 页」或者一行空白。
    const db = app.get(DatabaseService);
    await db.query(
      `INSERT INTO ${schema.name}.knowledge_points
         (id, module_id, name, is_leaf, depth, ordinal, source_id, source_page)
       VALUES ('kp-broken-source', 'm-a', '有书没页码的点', true, 1, 8, 'book-a', NULL)`,
    );

    const res = await request(app.getHttpServer())
      .get('/api/v1/nodes/kp-broken-source')
      .expect(500);
    expect(res.body.code).toBe('INTERNAL');

    // 清场：后面的用例会遍历全部节点，留着它会让那个循环也 500
    await db.query(`DELETE FROM ${schema.name}.knowledge_points WHERE id = 'kp-broken-source'`);
  });

  // ---------------------------------------------------------------------------
  // 票 08：章节路径 ancestors（根在前，不含自身）
  // ---------------------------------------------------------------------------

  it('三级祖先链根在前返回，不含自身', async () => {
    const db = app.get(DatabaseService);
    // 章(0) → 节(1) → 小节(2) → 叶(3)：层级跨度越大，顺序写反（叶在前）越藏不住。
    await db.query(
      `INSERT INTO ${schema.name}.knowledge_points (id, module_id, parent_id, name, is_leaf, depth, ordinal)
       VALUES ('kp-ch',  'm-a', NULL,      '第 1 章 逻辑代数', false, 0, 1),
              ('kp-sec', 'm-a', 'kp-ch',   '第 1.2 节 布尔恒等式', false, 1, 1),
              ('kp-sub', 'm-a', 'kp-sec',  '第 1.2.1 小节 吸收律', false, 2, 1),
              ('kp-deep','m-a', 'kp-sub',  '吸收律的证明', true, 3, 1)`,
    );

    const res = await request(app.getHttpServer()).get('/api/v1/nodes/kp-deep').expect(200);
    expect(res.body.ancestors).toEqual([
      '第 1 章 逻辑代数',
      '第 1.2 节 布尔恒等式',
      '第 1.2.1 小节 吸收律',
    ]);
    // 自身名字不在路径里：「正在学」卡第二行是「我在哪」，不是把名字念两遍。
    expect(res.body.ancestors).not.toContain('吸收律的证明');
    assertMatchesContract('/api/v1/nodes/{microKpId}', 'get', 200, res.body);
  });

  it('一级父节点（现有种子 kp-noise）返回单元素路径', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nodes/kp-noise').expect(200);
    expect(res.body.ancestors).toEqual(['前置放大器']);
  });

  it('手工 kp（parent 为 NULL，depth 0）路径为空数组，不报错', async () => {
    const db = app.get(DatabaseService);
    await db.query(
      `INSERT INTO ${schema.name}.knowledge_points (id, module_id, name, is_leaf, depth, ordinal)
       VALUES ('kp-orphan', 'm-a', '无父的手工点', true, 0, 20)`,
    );
    const res = await request(app.getHttpServer()).get('/api/v1/nodes/kp-orphan').expect(200);
    // 空数组是合法态（字段在、值为 []），不是字段缺失 —— 前端据此降级显示
    // pageLabel，而不是拿到 undefined 去拼「undefined · undefined」。
    expect(res.body.ancestors).toEqual([]);
    assertMatchesContract('/api/v1/nodes/{microKpId}', 'get', 200, res.body);
  });
});
