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
import { replayMastery } from '@starmap/engine';

/**
 * 票 13：可解释推荐与看板。
 *
 * 这一套的全部意义在验收第 4 条上：**理由里的数字必须来自真实掌握度**。
 * 所以这里不 mock 掌握度——测试自己往 `attempts` 里插真实作答行，再用同一个
 * 回放函数（`replayMastery`）独立算一遍期望值，最后断言推荐理由里的数字
 * 与它逐位一致。如果实现悄悄改读 `app.mastery` 的缓存列（那列会随时间衰减、
 * 也可能压根没写），这个断言立刻红。
 *
 * 同一个理由也解释了为什么每条用例都自己插 `attempts` 而不是插 `mastery`：
 * `mastery` 是派生缓存，caption 裁定 canonical 是 attempts 回放。插缓存再去
 * 断言推荐，等于测「缓存读得对不对」，与本票无关。
 */

interface ReasonFactBody {
  type: string;
  value?: number;
  microKpId?: string;
  name?: string;
  current?: number;
}

interface RecommendationBody {
  microKpId: string;
  name: string;
  moduleName: string;
  reason: { kind: string; facts: ReasonFactBody[] };
}

/** 一批同构作答（同一天内、按分钟错开，保证回放顺序确定）。 */
function attemptsFor(options: {
  microKpId: string;
  count: number;
  variants: number;
  correct: boolean;
  day: string;
  startingMinute?: number;
}): Array<[string, string, string, boolean, string]> {
  const start = options.startingMinute ?? 0;
  return Array.from({ length: options.count }, (_, i) => {
    const variant = i % options.variants;
    const minute = String(start + i).padStart(2, '0');
    return [
      options.microKpId,
      `${options.microKpId}-item-${variant}`,
      `vg-${options.microKpId}-${variant}`,
      options.correct,
      `${options.day} ${minute}:00+00`,
    ] as [string, string, string, boolean, string];
  });
}

describe('RecommendController（集成）', () => {
  let app: INestApplication;
  let schema: TestSchema;
  let db: DatabaseService;

  /**
   * 图谱形状（全部是叶节点）：
   *
   *   kp-base  ──prereq──▶  kp-mid  ──prereq──▶  kp-top
   *
   * `kp-base` 是「卡住」的那个（在 kp-top 上做了 8 题还是 0.14，而它的前置
   * kp-mid 只有一次作答史、`current` 很低），所以推荐里应该出现 kp-mid 的
   * `blocked_by_prereq` 理由——这正是票面第 2 条举的例子。
   */
  const KP = {
    base: 'kp-base',
    mid: 'kp-mid',
    top: 'kp-top',
    lonely: 'kp-lonely',
  };

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

    await db.query(`INSERT INTO ${schema.name}.subjects (id, name) VALUES ('nuclear', '核电子学')`);
    await db.query(
      `INSERT INTO ${schema.name}.modules (id, subject_id, name, tier, ordinal)
       VALUES ('m-a', 'nuclear', '信号与噪声', 'A', 1)`,
    );
    await db.query(
      `INSERT INTO ${schema.name}.knowledge_points (id, module_id, parent_id, name, is_leaf, depth, ordinal)
       VALUES ('kp-base',  'm-a', NULL, '差分放大器',   true, 1, 1),
              ('kp-mid',   'm-a', NULL, '共模抑制比',   true, 1, 2),
              ('kp-top',   'm-a', NULL, '噪声系数',     true, 1, 3),
              ('kp-lonely','m-a', NULL, '锁相环',       true, 1, 4)`,
    );
    await db.query(
      `INSERT INTO ${schema.name}.kp_edges (from_id, to_id, kind, evidence)
       VALUES ('kp-base', 'kp-mid', 'prereq', '差分增益决定了共模抑制'),
              ('kp-mid',  'kp-top', 'prereq', '共模抑制比进入噪声系数公式')`,
    );

    // 题目行：`attempts.item_id` 有外键，测试必须真插题目（不能只插 attempts）。
    await db.query(
      `INSERT INTO ${schema.name}.levels (id, micro_kp_id, title, kind, ordinal, spec)
       VALUES ('lv-a', 'kp-base', '差分放大器关卡', 'quiz', 1, '{}'::jsonb)`,
    );

    // `kp-top`：8 次作答、3 变式、全错 → 证据够但 current 很低 = 卡住。
    // `kp-mid`：3 次作答、3 变式（证据不够）→ 它是卡住节点的前置，且没满足。
    for (const [microKpId, count, variants, correct] of [
      [KP.top, 8, 3, false],
      [KP.mid, 3, 3, false],
    ] as const) {
      for (let variant = 0; variant < variants; variant += 1) {
        await db.query(
          `INSERT INTO ${schema.name}.level_items
             (id, level_id, stem, options, answer, explain_correct, explain_wrong,
              variant_group, pool)
           VALUES ($1, 'lv-a', $2, '["甲","乙"]'::jsonb, '0'::jsonb, '对', '错', $3, 'practice')`,
          [`${microKpId}-item-${variant}`, `${microKpId} 的第 ${variant} 个变式`, `vg-${microKpId}-${variant}`],
        );
      }
      const rows = attemptsFor({
        microKpId,
        count,
        variants,
        correct,
        day: '2026-10-01',
      });
      for (const [kp, itemId, variantGroup, isCorrect, at] of rows) {
        await db.query(
          `INSERT INTO ${schema.name}.attempts
             (micro_kp_id, item_id, variant_group, correct, answer, knowledge_kind,
              counts_toward_mastery, created_at)
           VALUES ($1, $2, $3, $4, '0'::jsonb, 'concept', true, $5::timestamptz)`,
          [kp, itemId, variantGroup, isCorrect, at],
        );
      }
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await schema?.drop();
  });

  /**
   * 补一批 chunk 行，让知识点「有内容」。
   *
   * t24 第 4 条给推荐加了内容前置：`chunkCount===0` 且无关卡的节点不进候选集
   * （零内容的知识点推给学习者，点进去只有空白页；与 generation 的 pickTargets
   * 同一条理由）。这个 seed 原本不插 chunk，于是 /recommendations 返回空数组，
   * 下游「理由里的数字」与「卡住节点的前置」两条用例都失去被测对象。
   *
   * 只给 KP.base / KP.top / KP.mid 三类插：正好覆盖下面两条用例自己的断言对象。
   * `kp-lonely` 刻意不插 —— 它只作为「改道目标」存在，不需要在推荐里出现。
   */
  async function seedChunks(microKpId: string, count: number): Promise<void> {
    await db.query(
      `INSERT INTO ${schema.name}.sources (id, title, kind, meta)
       VALUES ('src-t24', '测试用书', 'book', '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
    );
    for (let i = 0; i < count; i += 1) {
      await db.query(
        `INSERT INTO ${schema.name}.chunks (id, source_id, ordinal, kind, text, page, micro_kp_id, meta)
         VALUES ($1, 'src-t24', $2, 'text', $3, 1, $4, '{}'::jsonb)`,
        [`ck-t24-${microKpId}-${i}`, i, `${microKpId} 的第 ${i} 段原文`, microKpId],
      );
    }
  }

  /** 用独立回放算出「库里应该是多少」——与被测代码无关的第二条路径。 */
  async function replayed(microKpId: string): Promise<ReturnType<typeof replayMastery>> {
    const rows = await db.query<{
      micro_kp_id: string;
      item_id: string;
      variant_group: string;
      correct: boolean;
      created_at: Date;
      knowledge_kind: string | null;
    }>(
      `SELECT micro_kp_id, item_id, variant_group, correct, created_at, knowledge_kind
         FROM ${schema.name}.attempts
        WHERE micro_kp_id = $1 AND counts_toward_mastery = true
        ORDER BY created_at ASC, id ASC`,
      [microKpId],
    );
    const now = await db.query<{ now: Date }>('SELECT now() AS now');
    return replayMastery(
      rows.map((row) => ({
        itemId: row.item_id,
        variantGroup: row.variant_group,
        kind: (row.knowledge_kind ?? 'concept') as 'fact' | 'concept' | 'comprehensive',
        correct: row.correct,
        at: row.created_at.toISOString(),
      })),
      // 掌握度的时间粒度是 UTC 日界（`floorToGranularity`）：回放也必须用
      // 同一个截断值，否则跨日运行时断言会因为「今天衰减了几个小时」而飘。
      `${now[0]!.now.toISOString().slice(0, 10)}T00:00:00.000Z`,
    );
  }

  it('返回推荐列表与今日摘要，形状满足契约', async () => {
    // 内容前置（t24 第 4 条）要求叶节点「有 chunk 或有关卡」才进候选集，
    // 所以先给会被断言的三类节点补上原文。见 seedChunks 的注释。
    await seedChunks(KP.base, 2);
    await seedChunks(KP.top, 2);
    await seedChunks(KP.mid, 2);

    const res = await request(app.getHttpServer()).get('/api/v1/recommendations').expect(200);
    expect(Array.isArray(res.body.recommendations)).toBe(true);
    expect(res.body.summary).toMatchObject({ available: true });
    expect(typeof res.body.generatedAt).toBe('string');
    assertMatchesContract('/api/v1/recommendations', 'get', 200, res.body);
  });

  it('理由里的百分比等于库里 attempts 回放出来的值（不读 mastery 缓存）', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/recommendations').expect(200);
    const recommendations = res.body.recommendations as RecommendationBody[];
    expect(recommendations.length).toBeGreaterThan(0);

    let checked = 0;
    for (const item of recommendations) {
      const expected = await replayed(item.microKpId);
      const currentFact = item.reason.facts.find((fact) => fact.type === 'current');
      if (!currentFact) continue;
      // 回放出来的 current 是 current 的真值；理由里说的百分比必须是它。
      // 用 toBeCloseTo 而不是 toBe：JSON 往返会过一遍 double，末位可能差 1e-16。
      expect(currentFact.value).toBeCloseTo(expected.current, 10);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('卡住节点的前置被提升上来，理由说得清「你卡在哪、它卡在谁」', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/recommendations').expect(200);
    const recommendations = res.body.recommendations as RecommendationBody[];

    // kp-top 做了 8 题 3 变式全错（current≈0.109），它的前置 kp-mid 也没满足
    // → kp-mid 应当以 blocked_by_prereq 出现在推荐里，并指名它解开了 kp-top。
    const blocked = recommendations.find(
      (item) => item.reason.kind === 'blocked_by_prereq' && item.microKpId === KP.mid,
    );
    expect(blocked).toBeDefined();

    const unblocks = blocked!.reason.facts.find((fact) => fact.type === 'unblocks');
    expect(unblocks).toBeDefined();
    expect(unblocks!.microKpId).toBe(KP.top);
    expect(unblocks!.name).toBe('噪声系数');

    const topReplay = await replayed(KP.top);
    expect(unblocks!.current).toBeCloseTo(topReplay.current, 10);
  });

  it('图谱响应里的 recommendedIds 与看板同一批、同一顺序', async () => {
    const [graph, board] = await Promise.all([
      request(app.getHttpServer()).get('/api/v1/graph').expect(200),
      request(app.getHttpServer()).get('/api/v1/recommendations').expect(200),
    ]);
    const ids = graph.body.recommendedIds as string[];
    const boardIds = (board.body.recommendations as RecommendationBody[]).map((item) => item.microKpId);
    // 两次请求是分开的（getGraph 与 getRecommendations），但推荐是同一批：
    // 除非中间有数据变更，否则顺序也必须一样（纯函数 + 全序排序）。
    expect(ids).toEqual(boardIds);
    assertMatchesContract('/api/v1/graph', 'get', 200, graph.body);
  });

  it('改道后再查，被拒的那条不再出现（选择被记住）', async () => {
    const before = await request(app.getHttpServer()).get('/api/v1/recommendations').expect(200);
    const first = (before.body.recommendations as RecommendationBody[])[0];
    expect(first).toBeDefined();

    await request(app.getHttpServer())
      .post('/api/v1/recommendations/redirect')
      .send({ recommended: first.microKpId, chosen: KP.lonely })
      .expect(200);

    const after = await request(app.getHttpServer()).get('/api/v1/recommendations').expect(200);
    const ids = (after.body.recommendations as RecommendationBody[]).map((item) => item.microKpId);
    expect(ids).not.toContain(first.microKpId);
  });

  it('改道请求体不合法返回 400 与 VALIDATION_FAILED', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/recommendations/redirect')
      .send({ recommended: KP.base })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('改道指向不存在的知识点返回 404（不是 500）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/recommendations/redirect')
      .send({ recommended: KP.base, chosen: 'kp-not-exist' })
      .expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toContain('kp-not-exist');
  });

  it('今日摘要的数字来自 attempts：答了几题、碰了几个知识点', async () => {
    // 把 kp-lonely 的一次作答挪到今天，好让「今日」有非零值。
    // 注意 `created_at` 默认就是 now()，但前面的种子全是 2026-10-01，这里
    // 显式插一条今天的，避免依赖「测试恰好在 10-01 运行」。
    //
    // ⚠️ 这里**不能用 `date_trunc('day', now())`**：那个函数按连接会话的
    // TimeZone 截断，而 `recommend.service.ts` 的 `dayStart()` 用的是 UTC
    // 日界。本机 PG 会话时区是 Asia/Shanghai（UTC+8），于是在 UTC 08:00
    // 之前跑这条测试会得到 `今天 00:00+08 = 昨天 16:00Z`，`created_at` 落到
    // UTC 日界之前，被 `WHERE created_at >= $1` 筛掉 → answered=0。
    // 这条测试曾因此在 UTC 上午必红、下午必绿。用 `now()` 最稳：它一定
    // ≥ 今天 UTC 零点，且这行只需要「是今天的」，不需要精确到某个时刻。
    await db.query(
      `INSERT INTO ${schema.name}.level_items
         (id, level_id, stem, options, answer, explain_correct, explain_wrong, variant_group, pool)
       VALUES ('kp-lonely-item-0', 'lv-a', '锁相环题干', '["甲","乙"]'::jsonb, '0'::jsonb,
               '对', '错', 'vg-kp-lonely-0', 'practice')`,
    );
    await db.query(
      `INSERT INTO ${schema.name}.attempts
         (micro_kp_id, item_id, variant_group, correct, answer, knowledge_kind,
          counts_toward_mastery, created_at)
       VALUES ('kp-lonely', 'kp-lonely-item-0', 'vg-kp-lonely-0', true, '0'::jsonb,
               'concept', true, now())`,
    );

    const res = await request(app.getHttpServer()).get('/api/v1/recommendations').expect(200);
    const summary = res.body.summary as {
      available: boolean;
      answered: number;
      knowledgePoints: number;
      newlyMastered: number;
    };
    expect(summary.available).toBe(true);
    expect(summary.answered).toBeGreaterThanOrEqual(1);
    expect(summary.knowledgePoints).toBeGreaterThanOrEqual(1);
    expect(summary.newlyMastered).toBeGreaterThanOrEqual(0);
  });

  // ---- t24 第 4 条：推荐的内容前置 ---------------------------------------
  //
  // 缺陷：`leafRows` 只过滤 `n.is_leaf = true`，不看有没有内容。附录里的
  // 常数表/换算表/性质表也是叶节点，却没有任何 chunk（图书把它们印成表格图，
  // OCR 没出块）。零内容的知识点推给学习者，他点进去只能看到空白页 ——
  // 与 `generation.service.ts` 的 `pickTargets` 同一条理由：零 chunk 生成
  // 关卡必有凭空编题，违反可溯源红线。
  //
  // 判据是「**有内容 chunk 或有可用关卡**」而不是 `chunk > 0`：`kp-bool` 是
  // 零 chunk 但有 1 张手写关卡 + 41 条作答的知识点，把它挡掉会让一个已掌握
  // 的节点从推荐里消失。
  //
  // ## 这三条用例为什么都插 `ordinal = -1` 的节点
  //
  // `/recommendations` 走 engine 的默认上限（3 条），而排序键里 `ordinal`
  // 排在很后面。若把探针节点插成 `ordinal = 10`，它本来就会被前三条挤掉，
  // 于是「不在结果里」既可解释成「被内容前置过滤」、也可解释成「排序靠后」
  // —— 一条永远绿的假测试。把 `ordinal` 设成 -1 让它在 `next_in_line` 里
  // 排最前：**只要它没被过滤就必然出现在响应里**，断言才有判别力。

  it('零 chunk 且无关卡的叶节点不进候选集', async () => {
    // 探针：满足 is_leaf、ordinal 最靠前，但既没有 chunk 也没有关卡。
    await db.query(
      `INSERT INTO ${schema.name}.knowledge_points
         (id, module_id, parent_id, name, is_leaf, depth, ordinal)
       VALUES ('kp-t24-empty', 'm-a', NULL, '只有名字的叶子', true, 1, -1)`,
    );
    try {
      const res = await request(app.getHttpServer()).get('/api/v1/recommendations').expect(200);
      const ids = (res.body.recommendations as RecommendationBody[]).map((item) => item.microKpId);
      expect(ids, '零 chunk 且无关卡的节点不该出现在推荐里').not.toContain('kp-t24-empty');
    } finally {
      await db.query(`DELETE FROM ${schema.name}.knowledge_points WHERE id = 'kp-t24-empty'`);
    }
  });

  it('零 chunk 但有关卡的叶节点仍然留在候选集里（kp-bool 那类）', async () => {
    // 探针：没有 chunk、但有 1 张关卡 —— 这正是真实库里 `kp-bool`
    // （`lv-bool-laws`）的形状。它必须仍然进候选集：手写关卡的正文就是
    // 内容，若只看 chunk 会把「内容来自关卡而不是书页」的知识点静默排除。
    await db.query(
      `INSERT INTO ${schema.name}.knowledge_points
         (id, module_id, parent_id, name, is_leaf, depth, ordinal)
       VALUES ('kp-t24-levelonly', 'm-a', NULL, '只有关卡的叶子', true, 1, -1)`,
    );
    // 关键：关卡只用 `levels.micro_kp_id` 归属，`spec` 里**不写** meta。
    // 手写关卡就是这样（AI 关卡才在 spec->meta 里声明），所以查询必须两个
    // 真源都认 —— 只认 spec 会把这类节点当成无关卡。
    await db.query(
      `INSERT INTO ${schema.name}.levels (id, micro_kp_id, title, kind, ordinal, spec)
       VALUES ('lv-t24-levelonly', 'kp-t24-levelonly', '只有关卡的叶子', 'quiz', 2, '{}'::jsonb)`,
    );
    await db.query(
      `INSERT INTO ${schema.name}.level_items
         (id, level_id, stem, options, answer, explain_correct, explain_wrong, variant_group, pool)
       VALUES ('lv-t24-levelonly-item', 'lv-t24-levelonly', '题干', '["甲","乙"]'::jsonb,
               '0'::jsonb, '对', '错', 'vg-t24', 'practice')`,
    );
    try {
      const res = await request(app.getHttpServer()).get('/api/v1/recommendations').expect(200);
      const ids = (res.body.recommendations as RecommendationBody[]).map((item) => item.microKpId);
      expect(ids, '有关卡就算有内容，不该被内容前置过滤').toContain('kp-t24-levelonly');
    } finally {
      await db.query(`DELETE FROM ${schema.name}.level_items WHERE id = 'lv-t24-levelonly-item'`);
      await db.query(`DELETE FROM ${schema.name}.levels WHERE id = 'lv-t24-levelonly'`);
      await db.query(`DELETE FROM ${schema.name}.knowledge_points WHERE id = 'kp-t24-levelonly'`);
    }
  });

  it('有 chunk 的叶节点照样进候选集（内容前置的回归基线）', async () => {
    // 探针：有 2 条 chunk、无关卡。内容前置只该挡掉「什么都没有」的节点，
    // 有正文的必须照常入选 —— 否则这条改动会把整库推荐清空。
    await db.query(
      `INSERT INTO ${schema.name}.knowledge_points
         (id, module_id, parent_id, name, is_leaf, depth, ordinal)
       VALUES ('kp-t24-chunked', 'm-a', NULL, '有正文的叶子', true, 1, -1)`,
    );
    try {
      await seedChunks('kp-t24-chunked', 2);
      const res = await request(app.getHttpServer()).get('/api/v1/recommendations').expect(200);
      const ids = (res.body.recommendations as RecommendationBody[]).map((item) => item.microKpId);
      expect(ids, '有 chunk 的叶节点不该被内容前置过滤').toContain('kp-t24-chunked');
    } finally {
      await db.query(`DELETE FROM ${schema.name}.chunks WHERE micro_kp_id = 'kp-t24-chunked'`);
      await db.query(`DELETE FROM ${schema.name}.knowledge_points WHERE id = 'kp-t24-chunked'`);
    }
  });
});
