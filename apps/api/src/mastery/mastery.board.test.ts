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
 * 票 80：个人看板（知识点 / 学科 / 课本三级进度）。
 *
 * ## 这个套件盯的是什么
 *
 * 最容易错、也最难被发现的一条是**五态之和 ≠ 叶节点总数**。它不会抛错：
 * 页面照常渲染，只是百分比加起来不到 100%，而看一眼「已掌握 7 个」没人会
 * 去把五态加一遍。所以这里把它变成断言，而不是留给验收时手动数。
 *
 * 第二件事是**层与书的分母来自同一批叶子**：八层的分母之和 + 未归层数必须
 * 等于全库分母。若层与书各写一条 SQL 去数，某个 join 少一个 `is_leaf`
 * 就会让三个数字来自三个总体 —— 页面看起来完全正常。
 *
 * 第三件事是空库：没有作答记录时，五个态全是 0，而且 `evaluatedAt` 仍然
 * 存在（服务端不该在空库里没数可算就报错）。
 */
describe('MasteryController.board（集成）', () => {
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

    await db.query(`INSERT INTO subjects (id, name) VALUES ('subj-board', '看板测试学科')`);
    // 课程层由迁移 0061 建表时就种好了 8 行（ordinal 上有唯一约束），测试不再插入，
    // 只把模块挂到其中两层上——这同时验证了「层是从库里来的，不是代码里写死的 8 个名字」。
    await db.query(
      `INSERT INTO modules (id, subject_id, name, tier, ordinal, course_layer_id)
       VALUES ('mod-circuit', 'subj-board', '电路模块', 'foundation', 1, 'circuit-analysis'),
              ('mod-analog', 'subj-board', '模拟模块', 'foundation', 2, 'analog-electronics'),
              ('mod-loose', 'subj-board', '未归层模块', 'foundation', 3, NULL)`,
    );
    await db.query(
      `INSERT INTO sources (id, title, kind, lang, enabled)
       VALUES ('board-book-a', '看板测试教材甲', 'book', 'zh', true),
              ('board-book-off', 'Lookahead English Book', 'book', 'en', false),
              ('board-paper', '看板测试论文', 'paper', 'zh', true)`,
    );

    // 四个叶节点 + 一个折叠父节点：
    //   kp-c1 / kp-c2 → 电路分析 / 教材甲
    //   kp-a1        → 模拟电子技术 / 教材甲
    //   kp-loose     → 没有课程层、没有 source（票面实测里那 1,054 + 2 个的缩影）
    //   kp-parent    → 非叶，绝不进出分母
    await db.query(
      `INSERT INTO knowledge_points (id, module_id, parent_id, name, is_leaf, depth, ordinal, source_id)
       VALUES ('kp-c1', 'mod-circuit', NULL, '基尔霍夫定律', true, 0, 1, 'board-book-a'),
              ('kp-c2', 'mod-circuit', NULL, '戴维南定理', true, 0, 2, 'board-book-a'),
              ('kp-a1', 'mod-analog', NULL, '共射放大电路', true, 0, 3, 'board-book-a'),
              ('kp-loose', 'mod-loose', NULL, '布尔代数基本运算', true, 0, 4, NULL),
              ('kp-parent', 'mod-circuit', NULL, '电路分析（折叠）', false, 0, 5, NULL)`,
    );

    // attempts.item_id 有外键指向 level_items，所以先有一关一道题。
    // spec 用最小可解析形状：看板只读 kp 的掌握度，不读 spec 的细节。
    const spec = {
      schemaVersion: 1,
      meta: {
        id: 'lv-board',
        microKpId: 'kp-a1',
        title: '看板测试关卡',
        type: 'teaching',
        tier: 'P1',
        estimatedMinutes: 10,
        author: 'system',
        isEntry: false,
        nextLevelId: null,
      },
      sources: [],
      cards: [],
      steps: [],
      items: [],
      gating: { mode: 'none', itemCount: 1, passCount: 1 },
    };
    await db.query(
      `INSERT INTO levels (id, micro_kp_id, title, kind, ordinal, spec)
       VALUES ('lv-board', 'kp-a1', '看板测试关卡', 'teach', 1, $1::jsonb)`,
      [JSON.stringify(spec)],
    );
    await db.query(
      `INSERT INTO level_items
         (id, level_id, stem, options, answer, explain_correct, explain_wrong, variant_group, pool)
       VALUES ('item-board-1', 'lv-board', '看板测试题', '["甲","乙"]'::jsonb, '0'::jsonb,
               '答对了', '答错了', 'vg-board-1', 'quiz')`,
    );

    // 一条真实作答：`kp-a1` 因此不再是 unseen，教材甲的「已学过」必须是 1。
    // `counts_toward_mastery = true` 是必须的（深究段作答不计掌握度）。
    await db.query(
      `INSERT INTO attempts
         (micro_kp_id, item_id, variant_group, correct, answer, created_at,
          attempt_no, counts_toward_mastery, knowledge_kind)
       VALUES ('kp-a1', 'item-board-1', 'vg-board-1', true, '0'::jsonb, now(), 1, true, 'concept')`,
    );
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await schema.drop();
  });

  it('五态之和 === 叶节点总数，且 mastered + learning + untouched === total', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/mastery/board').expect(200);
    assertMatchesContract('/api/v1/mastery/board', 'get', 200, res.body);

    const board = res.body;
    // 四个叶节点；那个 is_leaf = false 的父节点不在分母里。
    expect(board.knowledgePoints.total).toBe(4);
    const byStateSum = board.knowledgePoints.byState.reduce(
      (sum: number, row: { count: number }) => sum + row.count,
      0,
    );
    expect(byStateSum).toBe(board.knowledgePoints.total);
    expect(
      board.knowledgePoints.mastered +
        board.knowledgePoints.learning +
        board.knowledgePoints.untouched,
    ).toBe(board.knowledgePoints.total);
    // 唯一有过作答的知识点至少是「在学」，另外三个是「未学」。
    expect(board.knowledgePoints.untouched).toBe(3);
    expect(board.knowledgePoints.learning + board.knowledgePoints.mastered).toBe(1);
  });

  it('八层按 ordinal 排序、空层也出现，八层之和 + 未归层 === 全库分母', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/mastery/board').expect(200);
    const layers = res.body.layers as { id: string; ordinal: number; total: number }[];

    // 迁移 0061 种下的 8 层，按 ordinal 升序，一行都不能少。
    expect(layers.map((layer) => layer.id)).toEqual([
      'circuit-analysis',
      'analog-electronics',
      'digital-electronics',
      'atomic-nuclear-physics',
      'nuclear-electronics',
      'radiation-detection',
      'radiation-measurement-methods',
      'advanced-digital',
    ]);
    expect(layers.map((layer) => layer.ordinal)).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
    // 没有叶子的层照样出现，分母是 0 而不是「消失」。
    expect(layers.find((layer) => layer.id === 'advanced-digital')?.total).toBe(0);

    const layered = layers.reduce((sum, layer) => sum + layer.total, 0);
    expect(layered).toBe(3);
    expect(res.body.unlayeredLeafCount).toBe(1);
    expect(layered + res.body.unlayeredLeafCount).toBe(res.body.knowledgePoints.total);
  });

  it('课本只含 kind=book；停用书单列且 total=0；已学过按非 unseen 计', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/mastery/board').expect(200);
    const books = res.body.books as {
      id: string;
      enabled: boolean;
      total: number;
      learned: number;
    }[];

    // paper 不进课本块。
    expect(books.map((book) => book.id).sort()).toEqual(['board-book-a', 'board-book-off']);
    const enabled = books.find((book) => book.id === 'board-book-a');
    expect(enabled?.enabled).toBe(true);
    expect(enabled?.total).toBe(3);
    expect(enabled?.learned).toBe(1);

    const disabled = books.find((book) => book.id === 'board-book-off');
    expect(disabled?.enabled).toBe(false);
    expect(disabled?.total).toBe(0);
    expect(disabled?.learned).toBe(0);
    // 启用的排在停用的前面。
    expect(books[0]?.enabled).toBe(true);
  });

  it('空库：五态全 0、分母 0，但仍返回可供界面渲染的空态而不是报错', async () => {
    await db.query('DELETE FROM attempts');

    const res = await request(app.getHttpServer()).get('/api/v1/mastery/board').expect(200);
    const board = res.body;
    expect(board.knowledgePoints.untouched).toBe(4);
    expect(board.knowledgePoints.mastered).toBe(0);
    expect(board.knowledgePoints.learning).toBe(0);
    expect(board.knowledgePoints.byState.every((row: { count: number }) => row.count >= 0)).toBe(true);
    expect(board.books.find((book: { id: string }) => book.id === 'board-book-a')?.learned).toBe(0);
    // evaluatedAt 是 UTC 日界（毫秒为 0），三块共用同一个时刻。
    expect(new Date(board.evaluatedAt).getUTCHours()).toBe(0);
    expect(new Date(board.evaluatedAt).getUTCMinutes()).toBe(0);
    expect(new Date(board.evaluatedAt).getUTCSeconds()).toBe(0);
    expect(new Date(board.evaluatedAt).getUTCMilliseconds()).toBe(0);
  });
});
