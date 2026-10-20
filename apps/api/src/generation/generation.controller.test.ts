/**
 * 票 16 的 HTTP 面测试：起真实 Nest 应用，走 supertest。
 *
 * ## 与 `generation.service.test.ts` 的分工
 *
 * 那边测「数据库语义对不对」（触发器、幂等、汇总）；这边测「HTTP 契约对不对」
 * （状态码、响应形状、错误编码、后台执行真的跑起来了）。
 *
 * 两处都要真库：`POST /generations` 的后台执行会写 `level_generation_task`，
 * 用 mock 的 service 就测不出「发起接口返回时任务明细已经建齐」这件事 ——
 * 而那正是「可观察进度」的前提。
 *
 * ## 为什么用 `wait: true`
 *
 * 默认行为是后台跑（返回时 status 还是 running）。测试如果不等，断言时序会
 * 变成「有时刚跑完、有时还没开始」，随机红。`wait: true` 是**为测试和 CLI
 * 准备的**（见契约注释），用它把「等这批跑完」变成确定行为；后台语义本身
 * 在最后一个用例里单独验证。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../db/database.service.js';
import { LLM_PORT, type LlmCompleteOptions, type LlmPort, type LlmResult } from '../llm/llm.port.js';
import { createTestSchema } from '../../test/test-schema.js';
import { assertMatchesContract } from '../../test/contract.js';
import { GenerationController } from './generation.controller.js';

/** 够长的中文解析，过 checkLanguage 的 8 汉字下限 */
const EXPLAIN = '吸收律说的是：当一项被另一项完全包含时，被包含的那一项是多余的，可以直接去掉，剩下的就是被包含项。';

const VALID_QUESTION = {
  stem: 'A + A·B 化简后等于什么？',
  options: ['A', 'B', 'A·B', 'A + B'],
  answer: 0,
  explainCorrect: `吸收律：A + A·B = A。${EXPLAIN}`,
  explainWrong: `这里把吸收律和分配律混了。${EXPLAIN}`,
  misconceptionTags: ['吸收律与分配律混淆'],
  sourceRef: 'CT-PLACEHOLDER', // 运行时改成本次材料里真实的 chunkId
  hintLadder: ['看看哪一项被另一项包含'],
};

/**
 * 按知识点分派的假模型。
 *
 * `mode` 决定这个知识点怎么失败；未登记的一律成功。分派依据是用户消息里的
 * `id=<microKpId>` —— 并发下也稳定，不像顺序脚本会串。
 */
class RoutingLlm implements LlmPort {
  readonly id = 'generation-test-llm';
  readonly calls: string[] = [];

  constructor(private readonly modes: Record<string, 'ok' | 'not-json' | 'throw' | 'english'> = {}) {}

  async complete(options: LlmCompleteOptions): Promise<LlmResult> {
    const user = options.messages.map((m) => m.content).join('\n');
    const microKpId = /id=([\w-]+)/.exec(user)?.[1] ?? '';
    this.calls.push(microKpId);

    const mode = this.modes[microKpId] ?? 'ok';
    if (mode === 'throw') throw new Error('upstream 503 Service Unavailable');
    if (mode === 'not-json') return { text: '这是中文解释，不是 JSON。', parsed: null };

    // 从提示词里抓一个真实的 chunkId —— 假模型也得遵守「只能引用给定片段」
    const chunkId = /chunkId=([\w-]+)/.exec(user)?.[1] ?? 'missing';

    if (mode === 'english') {
      const en = {
        ...VALID_QUESTION,
        stem: 'What does A + A·B simplify to?',
        explainCorrect: 'By absorption, A + A·B equals A.',
        explainWrong: 'You confused absorption with distributivity.',
        sourceRef: chunkId,
      };
      return { text: JSON.stringify(en), parsed: en };
    }

    const q = { ...VALID_QUESTION, sourceRef: chunkId };
    return { text: JSON.stringify(q), parsed: q };
  }
}

describe('GenerationController（集成，连真实 Postgres）', () => {
  let schema: { name: string; drop: () => Promise<void> };
  let app: INestApplication;
  let db: DatabaseService;
  let llm: RoutingLlm;

  beforeAll(async () => {
    schema = await createTestSchema();
    llm = new RoutingLlm({
      'gen-http-en': 'english',
      'gen-http-throw': 'throw',
      'gen-http-nojson': 'not-json',
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      // 显式注册，让这个测试不依赖 domains.ts 的接线进度（那行由 integrator 加）。
      // 全仓多个套件都这么做，是并行泳道的既定做法。
      controllers: [GenerationController],
    })
      .overrideProvider(LLM_PORT)
      .useValue(llm)
      .compile();

    app = moduleRef.createNestApplication();
    db = app.get(DatabaseService);
    await db.useSchema(schema.name);
    await app.init();

    // 种一批知识点（全部带 gen-http 前缀，避开其他套件）
    await db.query(`INSERT INTO subjects (id, name) VALUES ('gen-http-subj', '核电子学')`);
    await db.query(
      `INSERT INTO modules (id, subject_id, name, tier)
       VALUES ('gen-http-mod', 'gen-http-subj', '数字逻辑', 'D')`,
    );
    await db.query(
      `INSERT INTO sources (id, title, kind) VALUES ('gen-http-src', '康华光·电子技术基础', 'book')`,
    );
    for (const id of ['gen-http-a', 'gen-http-en', 'gen-http-throw', 'gen-http-nojson', 'gen-http-idem']) {
      await db.query(
        `INSERT INTO knowledge_points (id, module_id, name, is_leaf, depth, ordinal)
         VALUES ($1, 'gen-http-mod', $2, true, 2, 1)`,
        [id, `知识点 ${id}`],
      );
      await db.query(
        `INSERT INTO chunks (id, source_id, ordinal, kind, text, page, micro_kp_id)
         VALUES ($1, 'gen-http-src', 1, 'text', $2, 34, $3)`,
        [
          `${id}-chunk`,
          'A + A·B = A，这是吸收律。吸收律说的是当一项被另一项完全包含时，被包含的那一项是多余的。',
          id,
        ],
      );
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await schema?.drop();
  });

  const start = (body: unknown) =>
    request(app.getHttpServer()).post('/api/v1/market/generations').send(body as object);

  // ── 发起（验收①）──────────────────────────────────────────────────────

  it(
    'wait=true 时返回 200，且响应里每条任务都已落定（可观察进度）',
    async () => {
      const res = await start({ microKpIds: ['gen-http-a'], wait: true }).expect(200);

      assertMatchesContract('/api/v1/market/generations', 'post', 200, res.body);

      const body = res.body as {
        runId: string;
        concurrency: number;
        requestedCount: number;
        succeededCount: number;
        failedCount: number;
        tasks: Array<{ microKpId: string; status: string; levelId: string | null; itemCount: number }>;
        failures: unknown[];
      };
      expect(body.runId).toMatch(/^run-/);
      expect(body.concurrency).toBe(4); // 票 16 指定的默认并发度
      expect(body.requestedCount).toBe(1);
      expect(body.succeededCount).toBe(1);
      expect(body.failedCount).toBe(0);
      expect(body.tasks).toHaveLength(1);
      expect(body.tasks[0]!.status).toBe('succeeded');
      expect(body.tasks[0]!.levelId).toBe('lv-ai-gen-http-a');
      expect(body.tasks[0]!.itemCount).toBe(1);
    },
    60_000,
  );

  it(
    '默认后台跑：不传 wait 时立刻返回，此时状态还是 running，明细已建齐',
    async () => {
      const res = await start({ microKpIds: ['gen-http-idem'] }).expect(200);
      const body = res.body as {
        tasks: Array<{ status: string }>;
        succeededCount: number;
      };
      // 立刻返回 → 明细已在（ denominators 稳定 ），但还没跑完
      expect(body.tasks).toHaveLength(1);
      expect(['pending', 'running']).toContain(body.tasks[0]!.status);
      expect(body.succeededCount).toBe(0);

      // 轮询直到跑完，顺带验证 GET 能观察进度（验收①）
      const runId = (res.body as { runId: string }).runId;
      let status = '';
      for (let i = 0; i < 50; i += 1) {
        const poll = await request(app.getHttpServer())
          .get(`/api/v1/market/generations/${runId}`)
          .expect(200);
        status = (poll.body as { tasks: Array<{ status: string }> }).tasks[0]!.status;
        if (status === 'succeeded' || status === 'failed') break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(status).toBe('succeeded');
    },
    60_000,
  );

  it('请求体既没给 microKpIds 也没给 limit → 400', async () => {
    const res = await start({ concurrency: 2 }).expect(400);
    expect((res.body as { code: string }).code).toBe('VALIDATION_FAILED');
    assertMatchesContract('/api/v1/market/generations', 'post', 400, res.body);
  });

  it('并发度越界（9 > 上限 8）→ 400', async () => {
    const res = await start({ microKpIds: ['gen-http-a'], concurrency: 9 }).expect(400);
    expect((res.body as { code: string }).code).toBe('VALIDATION_FAILED');
  });

  it('给了不存在的知识点 id → 404 且点名（不等跑完才发现）', async () => {
    const res = await start({ microKpIds: ['gen-http-a', 'gen-http-does-not-exist'] }).expect(404);
    const body = res.body as { code: string; message: string };
    expect(body.code).toBe('NOT_FOUND');
    expect(body.message).toContain('gen-http-does-not-exist');
    assertMatchesContract('/api/v1/market/generations', 'post', 404, res.body);
  });

  // ── 失败不拖垮整批（验收③）────────────────────────────────────────────

  it(
    '一批里混着成功与三种失败 → partial，每条失败都有分类与具体原因',
    async () => {
      const res = await start({
        microKpIds: ['gen-http-a', 'gen-http-en', 'gen-http-throw', 'gen-http-nojson'],
        wait: true,
      }).expect(200);

      const body = res.body as {
        succeededCount: number;
        failedCount: number;
        tasks: Array<{
          microKpId: string;
          status: string;
          failureKind: string | null;
          failureMessage: string | null;
        }>;
        failures: Array<{ kind: string; count: number; sample: string }>;
      };

      // 关键：一批 4 条，1 成功 3 失败，运行本身仍然是 200 而不是异常
      expect(body.succeededCount).toBe(1);
      expect(body.failedCount).toBe(3);
      expect(body.tasks).toHaveLength(4);

      const byKp = new Map(body.tasks.map((t) => [t.microKpId, t]));
      expect(byKp.get('gen-http-a')!.status).toBe('succeeded');
      expect(byKp.get('gen-http-en')!.failureKind).toBe('language_not_compliant');
      expect(byKp.get('gen-http-throw')!.failureKind).toBe('llm_error');
      expect(byKp.get('gen-http-nojson')!.failureKind).toBe('not_json');

      // 验收⑤：失败原因具体到能下手改，不是「失败了」三个字
      expect(byKp.get('gen-http-throw')!.failureMessage).toContain('503');
      expect(byKp.get('gen-http-en')!.failureMessage).toMatch(/汉字/);
      expect(byKp.get('gen-http-nojson')!.failureMessage).toContain('JSON');

      // 汇总视图：三类各 1 条
      expect(body.failures).toHaveLength(3);
      expect(body.failures.every((f) => f.count === 1)).toBe(true);
      expect(body.failures.map((f) => f.kind).sort()).toEqual([
        'language_not_compliant',
        'llm_error',
        'not_json',
      ]);
    },
    60_000,
  );

  // ── 幂等（验收②）──────────────────────────────────────────────────────

  it(
    '同一批跑两次，第二张关卡覆盖第一张而不是新增',
    async () => {
      const countRuns = async () => {
        const rows = await db.query<{ n: string }>(
          `SELECT count(DISTINCT run_id)::text AS n FROM level_generation_task
            WHERE micro_kp_id = 'gen-http-idem'`,
        );
        return Number(rows[0]!.n);
      };

      // 这个知识点在本套件前面那个「后台跑」用例里已经被用过一次，
      // 所以断言用增量而不是绝对值 —— 否则加一条用例就会把这里弄红。
      const before = await countRuns();

      await start({ microKpIds: ['gen-http-idem'], wait: true }).expect(200);
      await start({ microKpIds: ['gen-http-idem'], wait: true }).expect(200);

      const rows = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM levels WHERE id = 'lv-ai-gen-http-idem'`,
      );
      expect(Number(rows[0]!.n)).toBe(1);

      // 两次运行各自有自己的记录（可追溯），但关卡只有一张（幂等）
      expect(await countRuns()).toBe(before + 2);
    },
    60_000,
  );

  // ── practice 池（验收④）───────────────────────────────────────────────

  it(
    '生成出来的关卡在库里每题都是 practice 池、author 是 ai',
    async () => {
      await start({ microKpIds: ['gen-http-a'], wait: true }).expect(200);

      const rows = await db.query<{
        spec: { meta: { author: string }; items: Array<{ pool: string }> };
      }>(`SELECT spec FROM levels WHERE id = 'lv-ai-gen-http-a'`);
      expect(rows[0]!.spec.meta.author).toBe('ai');
      expect(rows[0]!.spec.items.length).toBeGreaterThan(0);
      for (const item of rows[0]!.spec.items) expect(item.pool).toBe('practice');

      const items = await db.query<{ pool: string }>(
        `SELECT pool FROM level_items WHERE level_id = 'lv-ai-gen-http-a'`,
      );
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => i.pool === 'practice')).toBe(true);
    },
    60_000,
  );

  // ── 查询 ──────────────────────────────────────────────────────────────

  it('GET /generations 返回最近若干次运行（只给头部计数）', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/market/generations?limit=5')
      .expect(200);
    assertMatchesContract('/api/v1/market/generations', 'get', 200, res.body);

    const body = res.body as { items: Array<{ runId: string; status: string }> };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.length).toBeLessThanOrEqual(5);
    expect(body.items[0]!.runId).toMatch(/^run-/);
    // 列表不带明细 —— 那是详情接口的事
    expect(body.items[0]).not.toHaveProperty('tasks');
  });

  it('limit 越界 → 400', async () => {
    await request(app.getHttpServer()).get('/api/v1/market/generations?limit=0').expect(400);
    await request(app.getHttpServer()).get('/api/v1/market/generations?limit=101').expect(400);
  });

  it('GET /generations/{runId} 不存在 → 404', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/market/generations/run-does-not-exist')
      .expect(404);
    expect((res.body as { code: string }).code).toBe('NOT_FOUND');
    assertMatchesContract('/api/v1/market/generations/{runId}', 'get', 404, res.body);
  });

  it(
    'GET /generations/{runId} 的详情里能逐条看到失败原因与字段级明细',
    async () => {
      const started = await start({
        microKpIds: ['gen-http-en', 'gen-http-a'],
        wait: true,
      }).expect(200);
      const runId = (started.body as { runId: string }).runId;

      const res = await request(app.getHttpServer())
        .get(`/api/v1/market/generations/${runId}`)
        .expect(200);
      assertMatchesContract('/api/v1/market/generations/{runId}', 'get', 200, res.body);

      const body = res.body as {
        tasks: Array<{
          microKpId: string;
          failureKind: string | null;
          failureDetail: unknown;
        }>;
      };
      const failed = body.tasks.find((t) => t.microKpId === 'gen-http-en');
      expect(failed!.failureKind).toBe('language_not_compliant');
      // 字段级明细：能指向具体字段（stem/explainCorrect/explainWrong）
      expect(Array.isArray(failed!.failureDetail)).toBe(true);
      const detail = failed!.failureDetail as Array<{ path: string; message: string }>;
      expect(detail.length).toBeGreaterThan(0);
      expect(detail[0]!.path).toMatch(/stem|explain/);
    },
    60_000,
  );

  it('microKpIds 里重复的 id 只跑一次', async () => {
    const res = await start({
      microKpIds: ['gen-http-a', 'gen-http-a', 'gen-http-a'],
      wait: true,
    }).expect(200);
    const body = res.body as { requestedCount: number; tasks: unknown[] };
    expect(body.requestedCount).toBe(1);
    expect(body.tasks).toHaveLength(1);
  });
});
