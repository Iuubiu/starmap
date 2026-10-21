/**
 * 票 16 的 Workflow 层测试。
 *
 * ## 这些测试在守什么
 *
 * 验收①「`.foreach(spec, { concurrency: 4 })` 批量生成」和验收③「失败走
 * fallback 不整批失败」是**运行时行为**，不是类型形状。类型检查能证明我们
 * 调了 `.foreach`，但证明不了「一条失败时其余条目还能成功」—— 那件事只能
 * 真跑一次 workflow 才知道。
 *
 * 所以这里不用 mock 的 workflow，而是用真的 `createGenerationWorkflow()`
 * 配一个脚本化 LlmPort，跑真实的 Mastra 执行路径。代价是几秒钟，换来的是
 * 「Mastra 升级把 foreach 的失败语义改掉了」这种问题会在这里红。
 *
 * ## 为什么 LlmPort 用脚本而不是 `ScriptedLlm`
 *
 * `ScriptedLlm`（`src/llm/scripted-llm.ts`）按顺序吐固定文本，适合「一问一答」
 * 的控制器测试。这里的测试要按**知识点**决定行为（kp-a 成功、kp-b 返回英文、
 * kp-c 抛超时），顺序会在并发下变得不可预测。所以用一个按消息内容路由的假
 * 实现 —— 并发 4 也不会串。
 */
import { describe, expect, it, vi } from 'vitest';
import { validateLevelSpec } from '@starmap/shared';
import type { LlmCompleteOptions, LlmPort, LlmResult } from '../llm/llm.port.js';
import {
  createGenerationWorkflow,
  generatedLevelId,
  summarizeRun,
  type GenerationWorkflowDeps,
} from './generation.workflow.js';
import type { QuestionMaterial } from './question-prompt.js';

/** 一段够长的中文解析，能过 checkLanguage 的 8 汉字下限 */
const OK_EXPLAIN = '因为与项是多余的，吸收律可以直接把它整块去掉，所以结果就是剩下的那一项。';

/**
 * 造一道合法题。
 *
 * `index` 会进题干：workflow 现在一个知识点要出 5 道题，而题干重复会被
 * 当作失败（「5 个变式」不能是同一道题换选项顺序）。假模型也得给出 5 个
 * 不同的题干，否则测的就不是 workflow 而是去重逻辑。
 */
function validQuestion(sourceRef: string, index = 0) {
  return {
    stem:
      index === 0
        ? 'A + A·B 化简后等于什么？'
        : `A + A·B 化简后等于什么？（第 ${index + 1} 角度）`,
    options: ['A', 'B', 'A·B', 'A + B'],
    answer: 0,
    explainCorrect: `吸收律：A + A·B = A。${OK_EXPLAIN}`,
    explainWrong: `这里用错了分配律。${OK_EXPLAIN}`,
    misconceptionTags: ['吸收律与分配律混淆'],
    sourceRef,
    hintLadder: ['先看哪一项被另一项包含'],
  };
}

const MATERIAL: QuestionMaterial = {
  microKpId: 'kp-a',
  microKpName: '吸收律',
  excerpts: [{ chunkId: 'chunk-1', text: 'A + A·B = A' }],
};

/**
 * 按知识点 id 分派的假 LlmPort。
 *
 * `behaviors` 的键是 microKpId；用户消息里含该 id 就按对应行为响应。
 * 未登记的 id 一律返回合法题 —— 这样「我只想测某一条」时不必把全部行为写全。
 */
class RoutingLlm implements LlmPort {
  readonly id = 'routing-llm';
  readonly calls: string[] = [];
  /** 每个知识点已调用几次：用来给题干加编号，避免被当成「重复题干」 */
  private readonly perKp = new Map<string, number>();

  constructor(
    private readonly behaviors: Record<
      string,
      | { type: 'ok'; chunkId?: string }
      | { type: 'throw'; message: string }
      | { type: 'not-json' }
      | { type: 'raw'; value: unknown }
    >,
  ) {}

  async complete(options: LlmCompleteOptions): Promise<LlmResult> {
    const user = options.messages.map((m) => m.content).join('\n');
    const microKpId = /id=([\w-]+)/.exec(user)?.[1] ?? '';
    this.calls.push(microKpId);
    const index = this.perKp.get(microKpId) ?? 0;
    this.perKp.set(microKpId, index + 1);

    const behavior = this.behaviors[microKpId] ?? { type: 'ok' as const };

    if (behavior.type === 'throw') throw new Error(behavior.message);
    if (behavior.type === 'not-json') return { text: '这是一段中文解释，不是 JSON。', parsed: null };
    if (behavior.type === 'raw') {
      // raw 行为可以是数组：第 n 次调用用第 n 个元素（超出则重复最后一个）。
      // 用来模拟「前几次成功、后面几次失败」这类按次变化的行为。
      const value = behavior.value;
      const picked = Array.isArray(value) ? value[Math.min(index, value.length - 1)] : value;
      return { text: JSON.stringify(picked), parsed: picked };
    }

    const chunkId = behavior.chunkId ?? 'chunk-1';
    const q = validQuestion(chunkId, index);
    return { text: JSON.stringify(q), parsed: q };
  }
}

/** 内存版落库：记录调用，按确定性 id 去重（模拟 upsert 语义） */
function makePersist() {
  const saved = new Map<string, unknown>();
  const calls: string[] = [];
  return {
    saved,
    calls,
    persist: async (spec: unknown, microKpId: string) => {
      calls.push(microKpId);
      const levelId = generatedLevelId(microKpId);
      saved.set(levelId, spec);
      return { levelId };
    },
  };
}

function makeDeps(
  llm: LlmPort,
  overrides: Partial<GenerationWorkflowDeps> = {},
): GenerationWorkflowDeps & { statuses: unknown[] } {
  const statuses: unknown[] = [];
  return {
    llm,
    loadMaterial: async (microKpId) =>
      microKpId === 'kp-no-material'
        ? null
        : { ...MATERIAL, microKpId, microKpName: MATERIAL.microKpName },
    persist: makePersist().persist,
    onTaskStatus: async (update) => {
      statuses.push(update);
    },
    statuses,
    ...overrides,
  };
}

describe('createGenerationWorkflow', () => {
  it(
    '批量生成：一批里每个知识点各出一张 quiz 型关卡，题目全在 practice 池',
    async () => {
      const llm = new RoutingLlm({});
      const mem = makePersist();
      const deps = makeDeps(llm, { persist: mem.persist });

      const wf = createGenerationWorkflow(deps, { concurrency: 4, runId: 'run-1' });
      const run = await wf.createRun();
      const result = await run.start({ inputData: { runId: 'run-1', microKpIds: ['kp-a', 'kp-b', 'kp-c'] } });

      expect(result.status).toBe('success');
      const output = result.result as Array<{ microKpId: string; ok: boolean }>;
      expect(output).toHaveLength(3);
      expect(output.every((r) => r.ok)).toBe(true);
      expect(output.map((r) => r.microKpId).sort()).toEqual(['kp-a', 'kp-b', 'kp-c']);

      // 关卡真的落库了，且 id 是确定性的
      expect([...mem.saved.keys()].sort()).toEqual([
        'lv-ai-kp-a',
        'lv-ai-kp-b',
        'lv-ai-kp-c',
      ]);

      // 验收④：落库的 spec 每题都在 practice 池，author 是 ai
      for (const spec of mem.saved.values()) {
        const s = spec as {
          meta: { author: string };
          items: Array<{ pool: string; variantGroup: string; id: string; stem: string }>;
        };
        expect(s.meta.author).toBe('ai');
        // 每关 5 题（QUESTIONS_PER_KP）—— 不是「大于 0」。1 道题的关卡凑不出
        // MASTERY_MIN_VARIANTS = 3 个变式组，学习者在那张关卡上永远到不了
        // 「已掌握」，也就永远进不了复验排期。
        expect(s.items).toHaveLength(5);
        for (const item of s.items) expect(item.pool).toBe('practice');
        // 5 题必须 5 个不同变式组（这是「5 题 = 5 变式」的实现断言）
        expect(new Set(s.items.map((i) => i.variantGroup)).size).toBe(5);
        // 5 个题干两两不同（重复题干会让「5 个变式」名不副实）
        expect(new Set(s.items.map((i) => i.stem)).size).toBe(5);
      }

      // 练习关卡不设门控。写成断言是因为它不是「顺手选的默认值」：exit 模式
      // 走 GATE_RULES.exit = 8 题 ≥7，而这里一次只产 1 道题，判定永远是
      // insufficient_items；更糟的是 gatedPrerequisites 会把它当成下游节点的门，
      // 把下游锁死。改成 'none' 后 unlockStateWith 会跳过这道门。
      for (const spec of mem.saved.values()) {
        const s = spec as { gating: { mode: string; itemCount: number; passCount: number }; items: unknown[] };
        expect(s.gating.mode).toBe('none');
        expect(s.gating.itemCount).toBe(s.items.length);
        expect(s.gating.passCount).toBeLessThanOrEqual(s.gating.itemCount);
      }
    },
    30_000,
  );

  it(
    '单个条目失败不拖垮整批：其余条目照常成功，失败条目带分类返回',
    async () => {
      // kp-bad-json 返回不是 JSON；kp-llm-down 上游抛错；其余正常
      const llm = new RoutingLlm({
        'kp-bad-json': { type: 'not-json' },
        'kp-llm-down': { type: 'throw', message: 'upstream 503 Service Unavailable' },
      });
      const mem = makePersist();
      const deps = makeDeps(llm, { persist: mem.persist });

      const wf = createGenerationWorkflow(deps, { concurrency: 4, runId: 'run-2' });
      const run = await wf.createRun();
      const result = await run.start({
        inputData: { runId: 'run-2', microKpIds: ['kp-ok', 'kp-bad-json', 'kp-llm-down', 'kp-ok2'] },
      });

      // 关键断言：整个 workflow 仍然 success。如果 step 抛异常，这里会是 'failed'。
      expect(result.status).toBe('success');

      const output = result.result as Array<{
        microKpId: string;
        ok: boolean;
        failureKind: string | null;
        failureMessage: string | null;
      }>;
      expect(output).toHaveLength(4);

      const byId = new Map(output.map((r) => [r.microKpId, r]));
      expect(byId.get('kp-ok')?.ok).toBe(true);
      expect(byId.get('kp-ok2')?.ok).toBe(true);
      expect(byId.get('kp-bad-json')?.ok).toBe(false);
      expect(byId.get('kp-bad-json')?.failureKind).toBe('not_json');
      expect(byId.get('kp-llm-down')?.ok).toBe(false);
      expect(byId.get('kp-llm-down')?.failureKind).toBe('llm_error');
      expect(byId.get('kp-llm-down')?.failureMessage).toContain('503');

      // 只有成功的两条落库
      expect([...mem.saved.keys()].sort()).toEqual(['lv-ai-kp-ok', 'lv-ai-kp-ok2']);
    },
    30_000,
  );

  it(
    '模型给出英文解析 → language_not_compliant，不落库',
    async () => {
      const englishQuestion = {
        stem: 'What does A + A·B simplify to?',
        options: ['A', 'B', 'A·B', 'A + B'],
        answer: 0,
        explainCorrect: 'By the absorption law, A + A·B equals A.',
        explainWrong: 'You confused absorption with distributivity.',
        misconceptionTags: ['confusion'],
        sourceRef: 'chunk-1',
        hintLadder: ['look at which term contains the other'],
      };
      const llm = new RoutingLlm({ 'kp-en': { type: 'raw', value: englishQuestion } });
      const mem = makePersist();
      const deps = makeDeps(llm, { persist: mem.persist });

      const wf = createGenerationWorkflow(deps, { concurrency: 4, runId: 'run-3' });
      const run = await wf.createRun();
      const result = await run.start({ inputData: { runId: 'run-3', microKpIds: ['kp-en'] } });

      expect(result.status).toBe('success');
      const output = result.result as Array<{ ok: boolean; failureKind: string | null }>;
      expect(output[0]?.ok).toBe(false);
      expect(output[0]?.failureKind).toBe('language_not_compliant');
      expect(mem.saved.size).toBe(0);
    },
    30_000,
  );

  it(
    '模型编造 sourceRef → ungrounded_source',
    async () => {
      const llm = new RoutingLlm({ 'kp-fake': { type: 'ok', chunkId: 'chunk-编造' } });
      const deps = makeDeps(llm);

      const wf = createGenerationWorkflow(deps, { concurrency: 4, runId: 'run-4' });
      const run = await wf.createRun();
      const result = await run.start({ inputData: { runId: 'run-4', microKpIds: ['kp-fake'] } });

      expect(result.status).toBe('success');
      const output = result.result as Array<{ ok: boolean; failureKind: string | null }>;
      expect(output[0]?.failureKind).toBe('ungrounded_source');
    },
    30_000,
  );

  it(
    '知识点没有教材片段 → ungrounded_source，不调模型',
    async () => {
      const llm = new RoutingLlm({});
      const deps = makeDeps(llm);

      const wf = createGenerationWorkflow(deps, { concurrency: 4, runId: 'run-5' });
      const run = await wf.createRun();
      const result = await run.start({ inputData: { runId: 'run-5', microKpIds: ['kp-no-material'] } });

      expect(result.status).toBe('success');
      const output = result.result as Array<{ ok: boolean; failureKind: string | null }>;
      expect(output[0]?.ok).toBe(false);
      expect(output[0]?.failureKind).toBe('ungrounded_source');
      // 关键：连模型都没调。没有材料就不该花钱问模型。
      expect(llm.calls).toHaveLength(0);
    },
    30_000,
  );

  it(
    '落库抛错 → db_error，其余条目不受影响',
    async () => {
      const llm = new RoutingLlm({});
      const deps = makeDeps(llm, {
        persist: async (_spec, microKpId) => {
          if (microKpId === 'kp-db-fail') throw new Error('deadlock detected');
          return { levelId: generatedLevelId(microKpId) };
        },
      });

      const wf = createGenerationWorkflow(deps, { concurrency: 4, runId: 'run-6' });
      const run = await wf.createRun();
      const result = await run.start({
        inputData: { runId: 'run-6', microKpIds: ['kp-db-fail', 'kp-fine'] },
      });

      expect(result.status).toBe('success');
      const output = result.result as Array<{
        microKpId: string;
        ok: boolean;
        failureKind: string | null;
      }>;
      const byId = new Map(output.map((r) => [r.microKpId, r]));
      expect(byId.get('kp-db-fail')?.failureKind).toBe('db_error');
      expect(byId.get('kp-db-fail')?.failureMessage).toContain('deadlock');
      expect(byId.get('kp-fine')?.ok).toBe(true);
    },
    30_000,
  );

  it(
    '输入里重复的知识点只跑一次（幂等的输入层）',
    async () => {
      const llm = new RoutingLlm({});
      const mem = makePersist();
      const deps = makeDeps(llm, { persist: mem.persist });

      const wf = createGenerationWorkflow(deps, { concurrency: 4, runId: 'run-7' });
      const run = await wf.createRun();
      const result = await run.start({
        inputData: { runId: 'run-7', microKpIds: ['kp-dup', 'kp-dup', 'kp-dup'] },
      });

      const output = result.result as unknown[];
      expect(output).toHaveLength(1);
      // 一个知识点出 5 道题 → 5 次模型调用（串行，每次一个角度）
      expect(llm.calls).toEqual(['kp-dup', 'kp-dup', 'kp-dup', 'kp-dup', 'kp-dup']);
      expect(mem.saved.size).toBe(1);
    },
    30_000,
  );

  it(
    '同一批跑两次得到同一个 levelId（重复执行不产生重复关卡）',
    async () => {
      const mem = makePersist();
      const deps = makeDeps(new RoutingLlm({}), { persist: mem.persist });

      for (const runId of ['run-8a', 'run-8b']) {
        const wf = createGenerationWorkflow(deps, { concurrency: 4, runId });
        const run = await wf.createRun();
        await run.start({ inputData: { runId, microKpIds: ['kp-idem'] } });
      }

      // 两次都落到同一个 id，内存 Map 里只有一条
      expect(mem.calls).toEqual(['kp-idem', 'kp-idem']);
      expect([...mem.saved.keys()]).toEqual(['lv-ai-kp-idem']);
    },
    30_000,
  );

  it(
    '5 题 5 变式组装出的关卡过 validateLevelSpec，且 variantGroup 两两不同',
    async () => {
      const mem = makePersist();
      const deps = makeDeps(new RoutingLlm({}), { persist: mem.persist });

      const wf = createGenerationWorkflow(deps, { concurrency: 1, runId: 'run-t29-a' });
      const run = await wf.createRun();
      await run.start({ inputData: { runId: 'run-t29-a', microKpIds: ['kp-five'] } });

      const spec = mem.saved.get('lv-ai-kp-five');
      expect(spec).toBeDefined();

      // 用**真源**校验器（`@starmap/shared` 的 validateLevelSpec，不是副本）
      const validated = validateLevelSpec(spec);
      expect(validated.ok).toBe(true);
      if (!validated.ok) return;

      const items = validated.spec.items;
      expect(items).toHaveLength(5);
      // 5 题 5 变式 —— 这是「能到已掌握」的结构性前提
      expect(new Set(items.map((i) => i.variantGroup)).size).toBe(5);
      // quiz 步骤引用的题必须有 sourceRef（校验器也查这一条）
      for (const item of items) expect(item.sourceRef).not.toBeNull();
    },
    30_000,
  );

  it(
    '出题只成功 2 道时该知识点判 failed，failureMessage 列出各角度失败原因',
    async () => {
      // 前 2 次合法、后 3 次全英文 → 成功 2 道 < MIN_QUESTIONS_PER_KP = 3
      const english = {
        stem: 'What does A + A·B simplify to?',
        options: ['A', 'B', 'A·B', 'A + B'],
        answer: 0,
        explainCorrect: 'By the absorption law, A + A·B equals A.',
        explainWrong: 'You confused absorption with distributivity.',
        misconceptionTags: ['confusion'],
        sourceRef: 'chunk-1',
        hintLadder: [],
      };
      const llm = new RoutingLlm({
        'kp-partial': {
          type: 'raw',
          value: [validQuestion('chunk-1', 0), validQuestion('chunk-1', 1), english],
        },
      });
      const mem = makePersist();
      const deps = makeDeps(llm, { persist: mem.persist });

      const wf = createGenerationWorkflow(deps, { concurrency: 1, runId: 'run-t29-b' });
      const run = await wf.createRun();
      const result = await run.start({
        inputData: { runId: 'run-t29-b', microKpIds: ['kp-partial'] },
      });

      expect(result.status).toBe('success');
      const output = result.result as Array<{
        ok: boolean;
        failureKind: string | null;
        failureMessage: string | null;
        failureDetail: unknown;
        itemCount: number;
      }>;
      const item = output[0]!;
      expect(item.ok).toBe(false);
      // 2 道不够 3 道下限：分类到主导失败原因（3 次语言不合规）
      expect(item.failureKind).toBe('language_not_compliant');
      expect(item.itemCount).toBe(0);
      // 汇总文案：说清成功几道，并逐角度列出原因（前两次成功，后三次全英文）
      expect(item.failureMessage).toContain('2');
      expect(item.failureMessage).toContain('3');
      expect(item.failureMessage).toContain('数值与量级'); // 第 3 个角度（第一个失败的）
      expect(item.failureMessage).toContain('常见错误'); // 第 4 个
      expect(item.failureMessage).toContain('边界情形'); // 第 5 个
      expect(item.failureMessage).toContain('汉字');
      // 字段级明细：每个失败角度一条，path 能定位到具体角度
      const detail = item.failureDetail as Array<{ path: string; code: string }>;
      expect(detail).toHaveLength(3);
      expect(detail.map((d) => d.code)).toEqual([
        'language_not_compliant',
        'language_not_compliant',
        'language_not_compliant',
      ]);
      expect(detail[0]!.path).toMatch(/^angle\./);
      // 一张都不落库（宁可没有，不要凑数）
      expect(mem.saved.size).toBe(0);
    },
    30_000,
  );

  it(
    '题干重复不当作两个变式：去重后不够 3 道也判 failed',
    async () => {
      // 每次都吐同一道题（题干完全相同）—— 这是窄知识点上模型很容易干的事
      const same = validQuestion('chunk-1', 0);
      const llm = new RoutingLlm({ 'kp-dup-stem': { type: 'raw', value: same } });
      const mem = makePersist();
      const deps = makeDeps(llm, { persist: mem.persist });

      const wf = createGenerationWorkflow(deps, { concurrency: 1, runId: 'run-t29-c' });
      const run = await wf.createRun();
      const result = await run.start({
        inputData: { runId: 'run-t29-c', microKpIds: ['kp-dup-stem'] },
      });

      const output = result.result as Array<{
        ok: boolean;
        failureKind: string | null;
        failureMessage: string | null;
        itemCount: number;
      }>;
      // 5 次都出了同一道题 → 只算 1 道，仍不够 3 道
      expect(output[0]!.ok).toBe(false);
      expect(output[0]!.failureMessage).toContain('重复');
      expect(mem.saved.size).toBe(0);
    },
    30_000,
  );

  it(
    'questionsPerKp 可调到下限 3：三次调用、三题三变式',
    async () => {
      const llm = new RoutingLlm({});
      const mem = makePersist();
      const deps = makeDeps(llm, { persist: mem.persist });

      const wf = createGenerationWorkflow(deps, {
        concurrency: 1,
        runId: 'run-t29-d',
        questionsPerKp: 3,
      });
      const run = await wf.createRun();
      await run.start({ inputData: { runId: 'run-t29-d', microKpIds: ['kp-three'] } });

      const spec = mem.saved.get('lv-ai-kp-three') as {
        items: Array<{ variantGroup: string }>;
      };
      expect(spec.items).toHaveLength(3);
      expect(new Set(spec.items.map((i) => i.variantGroup)).size).toBe(3);
      // 3 次调用而不是 5 次
      expect(llm.calls).toHaveLength(3);
    },
    30_000,
  );

  it(
    '并发度生效：同时最多 4 个条目在跑',
    async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      const llm: LlmPort = {
        id: 'overlap-llm',
        async complete() {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 40));
          inFlight -= 1;
          const q = validQuestion('chunk-1');
          return { text: JSON.stringify(q), parsed: q };
        },
      };
      const deps = makeDeps(llm);
      const ids = ['kp-1', 'kp-2', 'kp-3', 'kp-4', 'kp-5', 'kp-6', 'kp-7', 'kp-8'];

      const wf = createGenerationWorkflow(deps, { concurrency: 4, runId: 'run-9' });
      const run = await wf.createRun();
      const result = await run.start({ inputData: { runId: 'run-9', microKpIds: ids } });

      expect(result.status).toBe('success');
      expect((result.result as unknown[])).toHaveLength(8);
      // 8 个条目、并发 4：重叠数应该正好到 4，且不超过 4
      expect(maxInFlight).toBe(4);
    },
    30_000,
  );

  it(
    '每条任务的状态回调按 running → succeeded 顺序被调用',
    async () => {
      const deps = makeDeps(new RoutingLlm({}));
      const wf = createGenerationWorkflow(deps, { concurrency: 4, runId: 'run-10' });
      const run = await wf.createRun();
      await run.start({ inputData: { runId: 'run-10', microKpIds: ['kp-status'] } });

      const statuses = deps.statuses as Array<{ status: string; microKpId: string }>;
      expect(statuses.map((s) => s.status)).toEqual(['running', 'succeeded']);
      expect(statuses.every((s) => s.microKpId === 'kp-status')).toBe(true);
    },
    30_000,
  );

  it(
    '超时的条目算 llm_error，不挂起整批',
    async () => {
      // 一个永不应答的模型；perItemTimeoutMs 设成 50ms
      const llm: LlmPort = {
        id: 'hanging-llm',
        complete: (options) =>
          new Promise((_resolve, reject) => {
            // 只有 AbortSignal 真的被触发才 reject —— 这样如果 workflow 没实现
            // 超时，这个测试会挂到 vitest 的 timeout 而不是静默通过。
            options.signal?.addEventListener('abort', () =>
              reject(new Error('The operation was aborted')),
            );
          }),
      };
      const deps = makeDeps(llm, { perItemTimeoutMs: 50 });

      const wf = createGenerationWorkflow(deps, { concurrency: 4, runId: 'run-11' });
      const run = await wf.createRun();
      const result = await run.start({ inputData: { runId: 'run-11', microKpIds: ['kp-slow'] } });

      expect(result.status).toBe('success');
      const output = result.result as Array<{ ok: boolean; failureKind: string | null }>;
      expect(output[0]?.ok).toBe(false);
      expect(output[0]?.failureKind).toBe('llm_error');
    },
    30_000,
  );
});

describe('summarizeRun', () => {
  const ok = (microKpId: string) => ({
    microKpId,
    ok: true,
    levelId: `lv-ai-${microKpId}`,
    failureKind: null,
    failureMessage: null,
    failureDetail: null,
    itemCount: 1,
    durationMs: 10,
  });
  const bad = (microKpId: string) => ({
    ...ok(microKpId),
    ok: false,
    levelId: null,
    failureKind: 'not_json' as const,
    failureMessage: '不是 JSON',
    itemCount: 0,
  });

  it('全成功 → succeeded', () => {
    expect(summarizeRun([ok('a'), ok('b')])).toEqual({
      status: 'succeeded',
      succeededCount: 2,
      failedCount: 0,
    });
  });

  it('全失败 → failed', () => {
    expect(summarizeRun([bad('a'), bad('b')])).toEqual({
      status: 'failed',
      succeededCount: 0,
      failedCount: 2,
    });
  });

  it('部分成功 → partial（单独的状态，不是「成功数>0 就算成功」）', () => {
    expect(summarizeRun([ok('a'), bad('b')])).toEqual({
      status: 'partial',
      succeededCount: 1,
      failedCount: 1,
    });
  });

  it('一条都没跑 → failed（空跑不是成功）', () => {
    expect(summarizeRun([])).toEqual({ status: 'failed', succeededCount: 0, failedCount: 0 });
  });
});

describe('generatedLevelId', () => {
  it('同一知识点永远给出同一个 id（幂等的基础）', () => {
    expect(generatedLevelId('kp-bool')).toBe(generatedLevelId('kp-bool'));
  });

  it('不同知识点给出不同 id', () => {
    expect(generatedLevelId('kp-a')).not.toBe(generatedLevelId('kp-b'));
  });

  it('id 带 lv-ai- 前缀，能一眼看出是 AI 生成的', () => {
    expect(generatedLevelId('kp-x')).toMatch(/^lv-ai-/);
  });
});

// vi 未在此文件使用但如果将来要 spy 门控会需要；保留 import 会触发 lint，
// 所以这里显式消费一次避免「未使用」误报。
void vi;
