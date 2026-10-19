import { describe, it, expect } from 'vitest';
import { LevelSpecSchema, type LevelSpec } from './level.js';

/**
 * 关卡规范的结构不变量。
 *
 * 这些测试的价值不在「证明 Zod 能校验」，而在**把「什么算合法关卡」写死成
 * 可执行的规则**。手写关卡、AI 生成关卡、用户自制关卡都走同一个校验器，
 * 只要这里改了，三条路径同时生效。
 */

const baseSpec = (): unknown => ({
  schemaVersion: 1,
  meta: {
    id: 'lv-1',
    microKpId: 'kp-bool',
    title: '布尔代数基本律',
    tier: 'P1',
    estimatedMinutes: 12,
    author: 'system',
    isEntry: true,
  },
  sources: [{ ref: '康华光·数字部分·第5版', locator: 'p.42' }],
  cards: [{ id: 'c-1', title: '吸收律', body: 'A + A·B = A', figureRef: null }],
  steps: [
    { id: 's-1', kind: 'guide', title: '引导', cardIds: ['c-1'], itemIds: [], requiredCorrect: 0 },
    { id: 's-2', kind: 'quiz', title: '检验', cardIds: [], itemIds: ['i-1'], requiredCorrect: 1 },
  ],
  items: [
    {
      id: 'i-1',
      kind: 'concept',
      stem: 'A + A·B = ?',
      options: ['A', 'B', 'A+B', 'AB'],
      answer: 0,
      variantGroup: 'vg-1',
      explainCorrect: '吸收律',
      explainWrong: '混淆了吸收律与德摩根律',
      misconceptionTags: ['混淆吸收律'],
      sourceRef: '康华光·数字部分·p.42',
      pool: 'core',
      hintLadder: ['想想 A(1+B) 展开是什么'],
    },
  ],
  gating: { mode: 'none', itemCount: 1, passCount: 1 },
});

describe('LevelSpecSchema 结构不变量', () => {
  it('合法的关卡通过校验', () => {
    const result = LevelSpecSchema.safeParse(baseSpec());
    expect(result.success).toBe(true);
  });

  it('步骤引用了不存在的题目时报错（并指明是哪一步）', () => {
    const spec = baseSpec() as any;
    spec.steps[1].itemIds = ['i-不存在'];
    const result = LevelSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((i) => i.message).join('\n');
    expect(messages).toContain('i-不存在');
  });

  it('步骤引用了不存在的内容卡时报错', () => {
    const spec = baseSpec() as any;
    spec.steps[0].cardIds = ['c-不存在'];
    const result = LevelSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.message.includes('c-不存在'))).toBe(true);
  });

  it('判定题缺少 sourceRef 时不合法 —— 否则无法回答「为什么判我错」', () => {
    const spec = baseSpec() as any;
    spec.items[0].sourceRef = null;
    const result = LevelSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.message.includes('sourceRef'))).toBe(true);
  });

  it('AI 生成的关卡里题目必须全进练习池', () => {
    const spec = baseSpec() as any;
    spec.meta.author = 'ai';
    const result = LevelSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.message.includes('practice'))).toBe(true);
  });

  it('AI 生成关卡把题目标成 practice 后就合法', () => {
    const spec = baseSpec() as any;
    spec.meta.author = 'ai';
    spec.items[0].pool = 'practice';
    expect(LevelSpecSchema.safeParse(spec).success).toBe(true);
  });

  it('门控通过数不能超过题量', () => {
    const spec = baseSpec() as any;
    spec.gating = { mode: 'exit', itemCount: 8, passCount: 9 };
    const result = LevelSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.message.includes('不能超过'))).toBe(true);
  });

  it('每题都必须带 explainWrong —— 提交后要立即给反馈，不能临时生成', () => {
    const spec = baseSpec() as any;
    spec.items[0].explainWrong = '';
    const result = LevelSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
  });
});

describe('LevelSpec 类型对下游可见', () => {
  it('类型推断包含 steps 与 gating', () => {
    const parsed: LevelSpec = LevelSpecSchema.parse(baseSpec());
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.gating.mode).toBe('none');
  });
});
