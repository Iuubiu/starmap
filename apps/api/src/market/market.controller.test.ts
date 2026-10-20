import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { validateLevelSpec, type LevelSpec } from '@starmap/shared';
import type { MarketDraftResponse, MarketLevelListResponse } from '@starmap/api-contract';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../db/database.service.js';
import { ScriptedLlm } from '../llm/scripted-llm.js';
import { LLM_PORT } from '../llm/llm.port.js';
import { createTestSchema, type TestSchema } from '../../test/test-schema.js';
import { assertMatchesContract } from '../../test/contract.js';
import { MarketController } from './market.controller.js';

/**
 * 关卡市场（票 14）的集成测试。
 *
 * 覆盖五条验收里**能在后端看见**的四条：
 *   ① 打包草稿、② 校验不过不入库、③ 保存后出现在列表且能重新取到、⑤ 与内置关卡同一套校验器。
 * 第④条（市场页标注「保存」而不是「分发」）是文案与路由面的性质：
 * 断言点在 `MarketController` 的路由表上 —— 见文件末尾「没有分发路由」那段。
 *
 * 数据前缀一律 `mk-`，避免与其它套件的固定 id 相撞（测试 schema 里各套件共用）。
 */
describe('MarketController（集成）', () => {
  let app: INestApplication;
  let schema: TestSchema;
  let db: DatabaseService;

  beforeAll(async () => {
    schema = await createTestSchema();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      // `MarketController` 在 `domains.ts` 里还没有那一行（那个文件由 integrator
      // 统一收口，五条泳道并行时是冲突热点）。这里显式注册，测试就能独立于
      // 接线进度跑：本票验收的是控制器行为，不是它被登记进数组这件事。
      controllers: [MarketController],
    })
      .overrideProvider(LLM_PORT)
      .useValue(new ScriptedLlm([{ text: '假的' }]))
      .compile();

    app = moduleRef.createNestApplication();
    db = app.get(DatabaseService);
    await db.useSchema(schema.name);
    await app.init();

    // 测试 schema 只重放迁移的 DDL，内容迁移被跳过（test-schema.ts 有解释），
    // 所以这里自己种最小数据：一个叶知识点 + 一张内置教学关卡 + 一道内置题。
    await db.query(`INSERT INTO subjects (id, name) VALUES ('mk-subj', '测试学科')`);
    await db.query(
      `INSERT INTO modules (id, subject_id, name, tier, ordinal)
       VALUES ('mk-mod', 'mk-subj', '测试模块', 'A', 1)`,
    );
    await db.query(
      `INSERT INTO knowledge_points (id, module_id, parent_id, name, is_leaf, depth, ordinal)
       VALUES ('mk-kp', 'mk-mod', NULL, '布尔代数', true, 0, 1)`,
    );
    await db.query(
      `INSERT INTO levels (id, micro_kp_id, title, kind, ordinal, spec)
       VALUES ('mk-lv-preset', 'mk-kp', '内置教学关卡', 'teach', 1, $1::jsonb)`,
      [JSON.stringify(presetSpec)],
    );
    // 内置关卡的题也进 level_items：草稿打包是 JOIN 这张表拿题干与错因的
    // （spec 里虽然也有，但「当时做了什么题」由 attempts → level_items 回答）。
    for (const item of presetSpec.items) {
      await db.query(
        `INSERT INTO level_items
           (id, level_id, stem, options, answer, explain_correct, explain_wrong,
            misconception_tags, source_ref, variant_group, pool)
         VALUES ($1, 'mk-lv-preset', $2, $3::jsonb, $4::jsonb, $5, $6, $7::text[], $8, $9, $10)`,
        [
          item.id,
          item.stem,
          JSON.stringify(item.options),
          JSON.stringify(item.answer),
          item.explainCorrect,
          item.explainWrong,
          item.misconceptionTags,
          item.sourceRef,
          item.variantGroup,
          item.pool === 'practice' ? 'practice' : 'quiz',
        ],
      );
    }
    // 两次作答：一道对、一道错。草稿要把这两道都带上，且错题排前面。
    await db.query(
      `INSERT INTO attempts (micro_kp_id, item_id, variant_group, correct, answer)
       VALUES ('mk-kp', 'mk-i-absorb', 'vg-absorb', true, '"A"'),
              ('mk-kp', 'mk-i-demorgan', 'vg-demorgan', false, '"B"')`,
    );
    // 一段学习会话：草稿按会话时间窗过滤时用它。
    await db.query(
      `INSERT INTO sessions (id, started_at, ended_at)
       VALUES ('mk-sess', now() - interval '1 hour', now() + interval '1 hour')`,
    );
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await schema?.drop();
  });

  it('GET /market/levels 里内置关卡在列表里，且标成 preset', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/market/levels').expect(200);
    assertMatchesContract('/api/v1/market/levels', 'get', 200, res.body);

    const body = res.body as MarketLevelListResponse;
    const preset = body.items.find((i) => i.levelId === 'mk-lv-preset');
    expect(preset).toBeDefined();
    expect(preset?.origin).toBe('preset');
    expect(preset?.savedAt).toBeNull();
    // 知识点名字来自 JOIN，不是 id
    expect(preset?.microKpName).toBe('布尔代数');
    // itemCount 与 author 都从 spec 派生
    expect(preset?.itemCount).toBe(presetSpec.items.length);
    expect(preset?.author).toBe('system');
  });

  it('POST /market/drafts 把做过的题打包成草稿，错题排前面', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/market/drafts')
      .send({ microKpId: 'mk-kp' })
      .expect(200);
    assertMatchesContract('/api/v1/market/drafts', 'post', 200, res.body);

    const body = res.body as MarketDraftResponse;
    expect(body.learning.microKpId).toBe('mk-kp');
    expect(body.learning.attemptCount).toBe(2);
    expect(body.learning.correctCount).toBe(1);
    // 两道做过的题都在，错的那道在前
    expect(body.learning.items.map((i) => i.itemId)).toEqual(['mk-i-demorgan', 'mk-i-absorb']);
    expect(body.learning.items[0]?.correct).toBe(false);
    // 讲解卡来自内置关卡的 spec
    expect(body.learning.cardIds.length).toBeGreaterThan(0);
    expect(body.learning.sourceLevelIds).toContain('mk-lv-preset');
  });

  it('草稿本身是一份（可能不完整的）level.spec，且能说出缺什么', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/market/drafts')
      .send({ microKpId: 'mk-kp' })
      .expect(200);
    const body = res.body as MarketDraftResponse;

    // 草稿是 JSON 对象而不是字符串：用户要能直接编辑
    const draft = body.spec as Record<string, unknown>;
    expect(typeof draft).toBe('object');
    expect(draft.schemaVersion).toBe(1);
    expect((draft.meta as Record<string, unknown>).author).toBe('self');

    // 草稿的 issues 与「点保存会得到的错误」是同一份 —— 校验器只有一套
    const check = validateLevelSpec(draft);
    expect(check.ok).toBe(check.ok ? body.issues.length === 0 : body.issues.length > 0);
    if (!check.ok) {
      expect(body.issues.map((i) => i.path)).toEqual(check.issues.map((i) => i.path));
    }
  });

  it('草稿可以按会话时间窗打包（只算这段时间里的作答）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/market/drafts')
      .send({ microKpId: 'mk-kp', sessionId: 'mk-sess' })
      .expect(200);
    expect((res.body as MarketDraftResponse).learning.attemptCount).toBe(2);

    // 一个早于所有作答的窗口：打包结果为空，但仍然是合法响应而不是 500
    await db.query(
      `INSERT INTO sessions (id, started_at, ended_at)
       VALUES ('mk-sess-old', now() - interval '10 days', now() - interval '9 days')`,
    );
    const empty = await request(app.getHttpServer())
      .post('/api/v1/market/drafts')
      .send({ microKpId: 'mk-kp', sessionId: 'mk-sess-old' })
      .expect(200);
    const body = empty.body as MarketDraftResponse;
    expect(body.learning.attemptCount).toBe(0);
    expect(body.learning.items).toEqual([]);
    // 「没有作答」不是错误：草稿照出，issues 里会说缺什么
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it('知识点或会话不存在时 404，不是空草稿', async () => {
    const noKp = await request(app.getHttpServer())
      .post('/api/v1/market/drafts')
      .send({ microKpId: '没有这个知识点' })
      .expect(404);
    expect(noKp.body.code).toBe('NOT_FOUND');

    const noSession = await request(app.getHttpServer())
      .post('/api/v1/market/drafts')
      .send({ microKpId: 'mk-kp', sessionId: '没有这个会话' })
      .expect(404);
    expect(noSession.body.code).toBe('NOT_FOUND');
  });

  it('缺少 microKpId 时 400（请求体语法错误，与 spec 语义错误分开）', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/market/drafts').send({}).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    assertMatchesContract('/api/v1/market/drafts', 'post', 400, res.body);
  });

  it('非法关卡不能入库，且错误是字段级路径', async () => {
    const broken = structuredClone(presetSpec) as LevelSpec;
    broken.meta.id = 'mk-lv-broken';
    // 判定题丢掉 sourceRef：这是校验器的一条硬不变量
    const quizItem = broken.items.find((i) => i.pool === 'core');
    if (!quizItem) throw new Error('夹具缺少判定题，测试前提不成立');
    quizItem.sourceRef = null;

    const res = await request(app.getHttpServer())
      .post('/api/v1/market/levels')
      .send({ spec: broken })
      .expect(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.message).toContain('未写入关卡库');
    const details = res.body.details as { path: string; message: string }[];
    expect(details.some((i) => /^items\.\d+\.sourceRef$/.test(i.path))).toBe(true);
    assertMatchesContract('/api/v1/market/levels', 'post', 422, res.body);

    // 关键断言：库里确实没有这行
    const rows = await db.query(`SELECT id FROM levels WHERE id = 'mk-lv-broken'`);
    expect(rows).toHaveLength(0);
  });

  it('合法关卡保存后出现在市场列表，并且能重新开始（取回可播放的 spec）', async () => {
    const spec = portableSpec();

    const saved = await request(app.getHttpServer())
      .post('/api/v1/market/levels')
      .send({ spec, tags: ['自测', '布尔代数'] })
      .expect(200);
    assertMatchesContract('/api/v1/market/levels', 'post', 200, saved.body);
    expect(saved.body.created).toBe(true);
    expect(saved.body.level.origin).toBe('saved');
    expect(saved.body.level.author).toBe('self');
    expect(saved.body.level.tags).toEqual(['自测', '布尔代数']);

    // 验收③：出现在市场页
    const list = await request(app.getHttpServer()).get('/api/v1/market/levels').expect(200);
    const listed = (list.body as MarketLevelListResponse).items.find((i) => i.levelId === spec.meta.id);
    expect(listed).toBeDefined();
    expect(listed?.origin).toBe('saved');
    expect(listed?.savedAt).not.toBeNull();

    // 验收③：可以重新开始 —— 取回的 spec 必须能被校验器接受，
    // 因为播放器（GET /levels/:id）走的就是同一道校验。
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/market/levels/${spec.meta.id}`)
      .expect(200);
    assertMatchesContract('/api/v1/market/levels/{levelId}', 'get', 200, detail.body);
    const returned = detail.body.spec as LevelSpec;
    expect(validateLevelSpec(returned).ok).toBe(true);
    expect(returned).toEqual(spec);

    // 验收⑤：与内置关卡走同一套校验器 —— 自制关卡在 /levels/:id 也能读到
    const asPlayable = await request(app.getHttpServer())
      .get(`/api/v1/levels/${spec.meta.id}`)
      .expect(200);
    expect((asPlayable.body.spec as LevelSpec).meta.id).toBe(spec.meta.id);
  });

  it('重复保存同一关卡是覆盖而不是重复登记（created=false，列表只有一张）', async () => {
    const spec = portableSpec();
    const first = await request(app.getHttpServer())
      .post('/api/v1/market/levels')
      .send({ spec })
      .expect(200);
    expect(first.body.created).toBe(false); // 上一条测试已经存过一次

    const updated = structuredClone(spec) as LevelSpec;
    updated.meta.title = '改过标题的关卡';
    const second = await request(app.getHttpServer())
      .post('/api/v1/market/levels')
      .send({ spec: updated })
      .expect(200);
    expect(second.body.created).toBe(false);
    expect(second.body.level.title).toBe('改过标题的关卡');

    const list = await request(app.getHttpServer()).get('/api/v1/market/levels').expect(200);
    const same = (list.body as MarketLevelListResponse).items.filter((i) => i.levelId === spec.meta.id);
    expect(same).toHaveLength(1);
  });

  it('不能顶掉内置关卡的 id（409，不覆盖别人的关卡）', async () => {
    const hijack = structuredClone(presetSpec) as LevelSpec;
    hijack.meta.title = '我要改内置关卡';
    const res = await request(app.getHttpServer())
      .post('/api/v1/market/levels')
      .send({ spec: hijack })
      .expect(409);
    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.message).toContain('系统关卡');
    assertMatchesContract('/api/v1/market/levels', 'post', 409, res.body);

    // 内置关卡没变
    const row = await db.query<{ title: string }>(
      `SELECT title FROM levels WHERE id = 'mk-lv-preset'`,
    );
    expect(row[0]?.title).toBe('内置教学关卡');
  });

  /**
   * `details` 有**两种真实形状**，因为错误来自两层不同的校验：
   *
   *   - 422（spec 语义不合法）：`validateLevelSpec()` 的 issues，`path` 是
   *     **点号字符串**（`items.0.sourceRef`），因为那个校验器为了给人看而
   *     把路径拍平了。
   *   - 400（请求体语法不合法）：Zod 原生 `error.issues`，`path` 是**数组**
   *     （`['spec']` / `['microKpId']`）。
   *
   * 前端 `MarketAuthorPage` 的 `toIssues()` 对两种都收（数组就 join 成点号）。
   * 这条测试是把那个兼容层的存在理由钉在服务端：形状一旦统一/改变，这里先红，
   * 而不是等用户看到空白的错误列表。
   */
  it('422 与 400 的 details 是两种形状：点号字符串路径 vs Zod 数组路径', async () => {
    const broken = structuredClone(presetSpec) as LevelSpec;
    broken.meta.id = 'mk-lv-shape';
    const quizItem = broken.items.find((i) => i.pool === 'core');
    if (!quizItem) throw new Error('夹具缺少判定题，测试前提不成立');
    quizItem.sourceRef = null;

    const semantic = await request(app.getHttpServer())
      .post('/api/v1/market/levels')
      .send({ spec: broken })
      .expect(422);
    const semanticDetails = semantic.body.details as { path: unknown; message: string; code: string }[];
    expect(Array.isArray(semanticDetails)).toBe(true);
    expect(semanticDetails.length).toBeGreaterThan(0);
    for (const issue of semanticDetails) {
      // 点号字符串，不是数组
      expect(typeof issue.path).toBe('string');
      expect(typeof issue.message).toBe('string');
      expect(typeof issue.code).toBe('string');
    }
    expect(semanticDetails.some((i) => i.path === 'items.0.sourceRef')).toBe(true);

    const syntactic = await request(app.getHttpServer())
      .post('/api/v1/market/levels')
      .send({ nope: 1 })
      .expect(400);
    const syntacticDetails = syntactic.body.details as { path: unknown; message: string }[];
    expect(Array.isArray(syntacticDetails)).toBe(true);
    // Zod 原生：path 是数组
    expect(Array.isArray(syntacticDetails[0]?.path)).toBe(true);
    expect(syntacticDetails[0]?.path).toEqual(['spec']);
  });

  it('关卡不存在时 GET /market/levels/:id 返回 404', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/market/levels/没有这个关卡')
      .expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
    assertMatchesContract('/api/v1/market/levels/{levelId}', 'get', 404, res.body);
  });

  it('保存时把题目同步进 level_items，且 pool 词表在两边都正确', async () => {
    const rows = await db.query<{ id: string; pool: string; level_id: string }>(
      `SELECT id, pool, level_id FROM level_items WHERE level_id = 'mk-lv-self' ORDER BY id`,
    );
    const spec = portableSpec();
    expect(rows).toHaveLength(spec.items.length);
    // spec 的 'core' 落表写成 'quiz'（0001_init 的 CHECK 只有 quiz/practice）
    for (const row of rows) {
      const item = spec.items.find((i) => i.id === row.id);
      expect(item).toBeDefined();
      expect(row.pool).toBe(item?.pool === 'practice' ? 'practice' : 'quiz');
    }
  });
});

/**
 * 验收④：市场**只做保存、不做分发**。
 *
 * 这条断言落在路由表上而不是文案上：只要没有 publish/share 之类的路由，
 * 前端就不可能长出「分享到社区」的按钮 —— 它会调到一个 404。
 */
describe('市场没有分发路由', () => {
  it('路由表里不存在 publish / share / upload 类端点', () => {
    const router = MarketController as unknown as {
      prototype: Record<string, unknown>;
    };
    const methods = Object.getOwnPropertyNames(router.prototype).filter((n) => n !== 'constructor');
    // 公共方法只有这四条：列表、取单张、打包草稿、保存。
    expect(methods.sort()).toEqual(['createDraft', 'get', 'list', 'save'].sort());
  });
});

/** 一份合法的内置教学关卡（七段流程齐全，见票 04 的校验器）。 */
const presetSpec: LevelSpec = {
  schemaVersion: 1,
  meta: {
    id: 'mk-lv-preset',
    microKpId: 'mk-kp',
    title: '内置教学关卡',
    type: 'teaching',
    tier: 'P1',
    estimatedMinutes: 10,
    author: 'system',
    isEntry: true,
    nextLevelId: null,
  },
  sources: [{ ref: '教材第三章', locator: 'p.42' }],
  cards: [
    {
      id: 'mk-c-1',
      title: '吸收律',
      body: 'A + A·B = A。直觉是：A 已经为真时，后面那项是否成立都不影响结果，可以整块丢掉。',
      figureRef: null,
    },
  ],
  steps: [
    { id: 'mk-s-guide', kind: 'guide', title: '引导', cardIds: ['mk-c-1'], itemIds: [], requiredCorrect: 0 },
    { id: 'mk-s-detail', kind: 'detail', title: '细节', cardIds: ['mk-c-1'], itemIds: [], requiredCorrect: 0 },
    {
      id: 'mk-s-probe',
      kind: 'probe',
      title: '试一试',
      cardIds: [],
      itemIds: ['mk-i-absorb'],
      requiredCorrect: 0,
    },
    {
      id: 'mk-s-quiz',
      kind: 'quiz',
      title: '判定',
      cardIds: [],
      itemIds: ['mk-i-absorb', 'mk-i-demorgan'],
      requiredCorrect: 1,
    },
    { id: 'mk-s-summary', kind: 'summary', title: '小结', cardIds: ['mk-c-1'], itemIds: [], requiredCorrect: 0 },
  ],
  items: [
    {
      id: 'mk-i-absorb',
      kind: 'fact',
      stem: 'A + A·B 化简后等于什么？',
      options: ['A', 'B', 'A·B', 'A+B'],
      answer: 0,
      variantGroup: 'vg-absorb',
      explainCorrect: '吸收律：A 为真时整式为真。',
      explainWrong: '再想想：A 为真时，A·B 是否影响结果？',
      misconceptionTags: ['吸收律混淆'],
      sourceRef: '教材 p.42',
      pool: 'core',
      hintLadder: ['先看 A 为真时'],
    },
    {
      id: 'mk-i-demorgan',
      kind: 'comprehensive',
      stem: '¬(A·B) 等值于？',
      options: ['¬A + ¬B', '¬A·¬B', 'A + B'],
      answer: 0,
      variantGroup: 'vg-demorgan',
      explainCorrect: '德摩根律：乘积取反等于取反之和。',
      explainWrong: '注意是「取反后相加」，不是相乘。',
      misconceptionTags: ['德摩根律方向错'],
      sourceRef: '教材 p.44',
      pool: 'core',
      hintLadder: [],
    },
  ],
  gating: { mode: 'exit', itemCount: 2, passCount: 1 },
};

/** 自制关卡：id 与内置的不同，其余结构同样合法。 */
function portableSpec(): LevelSpec {
  const spec = structuredClone(presetSpec) as LevelSpec;
  spec.meta.id = 'mk-lv-self';
  spec.meta.title = '我保存的关卡';
  spec.meta.author = 'self';
  spec.meta.isEntry = false;
  spec.items = spec.items.map((item, i) => ({ ...item, id: `mk-lv-self-i${i}` }));
  spec.steps = spec.steps.map((step) => ({
    ...step,
    itemIds: step.itemIds.map((_, idx) => `mk-lv-self-i${idx}`).filter((id) =>
      spec.items.some((item) => item.id === id),
    ),
  }));
  return spec;
}
