import { describe, it, expect } from 'vitest';
import {
  LevelSpecSchema,
  formatIssuePath,
  prettyIssuePath,
  validateLevelSpec,
  type LevelSpec,
} from './level.js';

/**
 * 关卡规范的结构不变量。
 *
 * 这些测试的价值不在「证明 Zod 能校验」，而在**把「什么算合法关卡」写死成
 * 可执行的规则**。手写关卡、AI 生成关卡、用户自制关卡都走同一个校验器，
 * 只要这里改了，三条路径同时生效。
 */

const VALID_BODY =
  '吸收律：A + A·B = A。因为 A·B 恒为 A 的子集，把 A 并上去不增加任何元素，' +
  '整个表达式塌回 A。对偶形式是 A·(A + B) = A，两个方向都成立。';

const baseSpec = (): any => ({
  schemaVersion: 1,
  meta: {
    id: 'lv-1',
    microKpId: 'kp-bool',
    title: '布尔代数基本律',
    type: 'teaching',
    tier: 'P1',
    estimatedMinutes: 12,
    author: 'system',
    isEntry: true,
  },
  sources: [{ ref: '康华光·数字部分·第5版', locator: 'p.42' }],
  cards: [
    { id: 'c-1', title: '吸收律', body: VALID_BODY, figureRef: null },
    { id: 'c-2', title: '对偶形式', body: `${VALID_BODY} 对偶形式把乘法与加法互换。`, figureRef: null },
  ],
  steps: [
    { id: 's-1', kind: 'guide', title: '引导', cardIds: ['c-1'], itemIds: [], requiredCorrect: 0 },
    { id: 's-2', kind: 'detail', title: '展示细节', cardIds: ['c-2'], itemIds: [], requiredCorrect: 0 },
    { id: 's-3', kind: 'probe', title: '简单问题', cardIds: [], itemIds: ['i-1'], requiredCorrect: 1 },
    { id: 's-4', kind: 'quiz', title: '判定', cardIds: [], itemIds: ['i-1'], requiredCorrect: 1 },
    { id: 's-5', kind: 'summary', title: '小结', cardIds: [], itemIds: [], requiredCorrect: 0 },
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

/** 题目关卡：只判定，不含任何教学步骤。 */
const quizSpec = (): any => ({
  ...baseSpec(),
  meta: { ...baseSpec().meta, id: 'lv-q', type: 'quiz', title: '布尔代数判定关' },
  cards: [],
  steps: [
    { id: 's-1', kind: 'quiz', title: '判定', cardIds: [], itemIds: ['i-1'], requiredCorrect: 1 },
    { id: 's-2', kind: 'summary', title: '小结', cardIds: [], itemIds: [], requiredCorrect: 0 },
  ],
});

const issuesOf = (input: unknown) => {
  const result = validateLevelSpec(input);
  if (result.ok) throw new Error('期望校验失败，但通过了');
  return result.issues;
};

const pathsOf = (input: unknown) => issuesOf(input).map((i) => i.path);

describe('LevelSpecSchema 结构不变量', () => {
  it('合法的教学关卡通过校验', () => {
    expect(LevelSpecSchema.safeParse(baseSpec()).success).toBe(true);
  });

  it('合法的题目关卡通过校验 —— 两种 type 都被覆盖', () => {
    expect(LevelSpecSchema.safeParse(quizSpec()).success).toBe(true);
    const parsed = LevelSpecSchema.parse(quizSpec());
    expect(parsed.meta.type).toBe('quiz');
    expect(parsed.steps.map((s) => s.kind)).toEqual(['quiz', 'summary']);
  });

  it('步骤引用了不存在的题目时报错（并指明是哪一步）', () => {
    const spec = baseSpec();
    spec.steps[3].itemIds = ['i-不存在'];
    const result = LevelSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((i) => i.message).join('\n');
    expect(messages).toContain('i-不存在');
  });

  it('步骤引用了不存在的内容卡时报错', () => {
    const spec = baseSpec();
    spec.steps[0].cardIds = ['c-不存在'];
    const result = LevelSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.message.includes('c-不存在'))).toBe(true);
  });

  it('判定题缺少 sourceRef 时不合法 —— 否则无法回答「为什么判我错」', () => {
    const spec = baseSpec();
    spec.items[0].sourceRef = null;
    const result = LevelSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.message.includes('sourceRef'))).toBe(true);
  });

  it('AI 生成的关卡里题目必须全进练习池', () => {
    const spec = baseSpec();
    spec.meta.author = 'ai';
    const result = LevelSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.message.includes('practice'))).toBe(true);
  });

  it('AI 生成关卡把题目标成 practice 后就合法', () => {
    const spec = baseSpec();
    spec.meta.author = 'ai';
    spec.items[0].pool = 'practice';
    expect(LevelSpecSchema.safeParse(spec).success).toBe(true);
  });

  it('门控通过数不能超过题量', () => {
    const spec = baseSpec();
    spec.gating = { mode: 'exit', itemCount: 8, passCount: 9 };
    spec.items = Array.from({ length: 8 }, (_, i) => ({ ...spec.items[0], id: `i-${i}`, sourceRef: `p.${i}` }));
    spec.steps[3].itemIds = spec.items.map((i: any) => i.id);
    spec.steps[3].requiredCorrect = 8;
    spec.steps[2].itemIds = ['i-0'];
    spec.steps[2].requiredCorrect = 1;
    const result = LevelSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.message.includes('不能超过'))).toBe(true);
  });

  it('每题都必须带 explainWrong —— 提交后要立即给反馈，不能临时生成', () => {
    const spec = baseSpec();
    spec.items[0].explainWrong = '';
    const result = LevelSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
  });
});

describe('错误信息是字段级的，不是一句「校验失败」', () => {
  it('引用了不存在的题目 → 路径精确到 steps[3].itemIds[0]', () => {
    const spec = baseSpec();
    spec.steps[3].itemIds = ['i-不存在'];
    const [issue, ...rest] = issuesOf(spec);
    expect(rest).toHaveLength(0);
    expect(issue!.path).toBe('steps.3.itemIds.0');
    expect(prettyIssuePath(issue!.path)).toBe('steps[3].itemIds[0]');
    expect(issue!.message).toContain('i-不存在');
  });

  it('引用了不存在的内容卡 → 路径精确到 steps[1].cardIds[0]', () => {
    const spec = baseSpec();
    spec.steps[1].cardIds = ['c-不存在'];
    expect(pathsOf(spec)).toEqual(['steps.1.cardIds.0']);
  });

  it('判定题缺 sourceRef → 路径指到那一道题的 sourceRef 字段', () => {
    const spec = baseSpec();
    spec.items[0].sourceRef = null;
    const issues = issuesOf(spec);
    // probe 与 quiz 两处引用都会命中同一条内容缺陷，因此按 items 下标报一次、按引用报两次
    expect(issues.some((i) => i.path === 'items.0.sourceRef')).toBe(true);
    expect(issues.every((i) => i.path !== 'items')).toBe(true);
  });

  it('门控数字不自洽 → 路径指到 gating.passCount', () => {
    const spec = baseSpec();
    spec.gating = { mode: 'exit', itemCount: 8, passCount: 9 };
    expect(pathsOf(spec)).toContain('gating.passCount');
  });

  it('正确答案下标越界 → 路径指到 items[0].answer', () => {
    const spec = baseSpec();
    spec.items[0].answer = 9;
    const issues = issuesOf(spec);
    const hit = issues.find((i) => i.path === 'items.0.answer');
    expect(hit).toBeDefined();
    expect(hit!.message).toContain('超出选项个数');
  });

  it('讲解卡短于下限 → 路径指到 cards[0].body，并说明这是「一句话卡片」', () => {
    const spec = baseSpec();
    spec.cards[0].body = 'A + A·B = A';
    const issues = issuesOf(spec);
    const hit = issues.find((i) => i.path === 'cards.0.body');
    expect(hit).toBeDefined();
    expect(hit!.message).toContain('一句话卡片');
  });

  it('传进来的不是对象时给根级错误，而不是抛异常', () => {
    for (const input of [undefined, null, '字符串', 42, []]) {
      const result = validateLevelSpec(input);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('不可能');
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.path).toBe('');
      expect(result.issues[0]!.message).toContain('JSON 对象');
    }
  });

  it('formatIssuePath 把 Zod 的路径段拼成点号形式', () => {
    expect(formatIssuePath(['steps', 2, 'itemIds', 0])).toBe('steps.2.itemIds.0');
    expect(formatIssuePath([])).toBe('');
  });

  it('prettyIssuePath 把点号路径渲染成下标形式', () => {
    expect(prettyIssuePath('steps.2.itemIds.0')).toBe('steps[2].itemIds[0]');
    expect(prettyIssuePath('meta.title')).toBe('meta.title');
    expect(prettyIssuePath('')).toBe('（根）');
  });
});

describe('跨字段流程规则', () => {
  it('教学关卡按 引导→细节→简单问题→判定→小结 排布', () => {
    expect(LevelSpecSchema.safeParse(baseSpec()).success).toBe(true);
  });

  it('教学关卡乱序 → 路径指到出问题的那个步骤', () => {
    const spec = baseSpec(); // guide, detail, probe, quiz, summary
    const probe = spec.steps[2];
    const detail = spec.steps[1];
    spec.steps[1] = probe;
    spec.steps[2] = detail;
    const issues = issuesOf(spec);
    expect(issues.some((i) => /^steps\.\d+\.kind$/.test(i.path))).toBe(true);
  });

  it('教学关卡缺判定步骤不合法', () => {
    const spec = baseSpec();
    spec.steps = spec.steps.filter((s: any) => s.kind !== 'quiz');
    spec.gating = { mode: 'none', itemCount: 1, passCount: 1 };
    const issues = issuesOf(spec);
    expect(issues.some((i) => i.path === 'steps' && i.message.includes('判定'))).toBe(true);
  });

  it('深究步骤的题目必须在练习池 —— 「未掌握分支不扣掌握度」的结构保证', () => {
    const spec = baseSpec();
    spec.steps.splice(3, 0, {
      id: 's-deepen',
      kind: 'deepen',
      title: '深究',
      cardIds: [],
      itemIds: ['i-1'],
      requiredCorrect: 0,
    });
    const issues = issuesOf(spec);
    const hit = issues.find((i) => i.path === 'steps.3.itemIds.0');
    expect(hit).toBeDefined();
    expect(hit!.message).toContain('practice');
    expect(hit!.message).toContain('不扣掌握度');
  });

  it('深究步骤的 requiredCorrect 必须是 0', () => {
    const spec = baseSpec();
    spec.items[0].pool = 'practice';
    spec.steps.splice(3, 0, {
      id: 's-deepen',
      kind: 'deepen',
      title: '深究',
      cardIds: [],
      itemIds: ['i-1'],
      requiredCorrect: 1,
    });
    const issues = issuesOf(spec);
    expect(issues.some((i) => i.path === 'steps.3.requiredCorrect')).toBe(true);
  });

  it('深究 + 进一步讲解排好后教学关卡合法（七段齐备）', () => {
    const spec = baseSpec();
    spec.items.push({
      ...spec.items[0],
      id: 'i-practice',
      pool: 'practice',
      sourceRef: null,
      explainCorrect: 'A(1+B)=A',
      explainWrong: '展开后要记住 1+B=1',
    });
    spec.steps.splice(
      3,
      0,
      { id: 's-deepen', kind: 'deepen', title: '深究', cardIds: [], itemIds: ['i-practice'], requiredCorrect: 0 },
      { id: 's-reteach', kind: 'reteach', title: '进一步讲解', cardIds: ['c-2'], itemIds: [], requiredCorrect: 0 },
    );
    const result = LevelSpecSchema.safeParse(spec);
    expect(result.success).toBe(true);
  });

  it('进一步讲解排在深究之前不合法', () => {
    const spec = baseSpec();
    spec.steps.splice(2, 0, {
      id: 's-reteach',
      kind: 'reteach',
      title: '进一步讲解',
      cardIds: ['c-2'],
      itemIds: [],
      requiredCorrect: 0,
    });
    const issues = issuesOf(spec);
    expect(issues.some((i) => i.path === 'steps.2.kind' && i.message.includes('深究'))).toBe(true);
  });

  it('题目关卡混入教学步骤不合法，并给出改 type 的提示', () => {
    const spec = quizSpec();
    spec.steps.unshift({ id: 's-guide', kind: 'guide', title: '引导', cardIds: [], itemIds: [], requiredCorrect: 0 });
    const issues = issuesOf(spec);
    const hit = issues.find((i) => i.path === 'steps.0.kind');
    expect(hit).toBeDefined();
    expect(hit!.message).toContain("meta.type 改成 'teaching'");
  });

  it('题目关卡没有判定步骤不合法', () => {
    const spec = quizSpec();
    spec.steps = [{ id: 's-1', kind: 'summary', title: '小结', cardIds: [], itemIds: [], requiredCorrect: 0 }];
    const issues = issuesOf(spec);
    expect(issues.some((i) => i.path === 'steps' && i.message.includes('判定'))).toBe(true);
  });

  it('门控题量超过关卡实际题量不合法', () => {
    const spec = baseSpec();
    spec.gating = { mode: 'exit', itemCount: 5, passCount: 3 };
    expect(pathsOf(spec)).toContain('gating.itemCount');
  });

  it('重复的题目 id 被拒绝，且指向后出现的那一条', () => {
    const spec = baseSpec();
    spec.items.push({ ...spec.items[0] });
    const issues = issuesOf(spec);
    expect(issues.some((i) => i.path === 'items.1.id')).toBe(true);
  });
});

describe('LevelSpec 类型对下游可见', () => {
  it('类型推断包含 steps 与 gating', () => {
    const parsed: LevelSpec = LevelSpecSchema.parse(baseSpec());
    expect(parsed.steps).toHaveLength(5);
    expect(parsed.gating.mode).toBe('none');
  });

  it('meta.type 是必填的，默认值只补 tier / isEntry / nextLevelId', () => {
    const parsed = LevelSpecSchema.parse(baseSpec());
    expect(parsed.meta.type).toBe('teaching');
    expect(parsed.meta.nextLevelId).toBeNull();
  });
});
