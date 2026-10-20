import { describe, it, expect } from 'vitest';
import type { LevelSpec } from '../api/generated/model';
import {
  advance,
  countedRecordCount,
  createFlow,
  currentStep,
  feedbackFor,
  inRemediation,
  masteryTotal,
  stepProgress,
  submitAnswer,
  type FlowState,
} from './flow';

/**
 * 播放器状态机的测试。
 *
 * 这里**不渲染任何组件**：七段流程的分支规则是纯逻辑，用点击去测既慢又测不到
 * 「深究分支不扣掌握度」这类不变量。界面测试在 LevelPage.test.tsx，只验证
 * 「状态机说的东西显示出来了」。
 */

/** 造一段够长的讲解正文（校验器要求 ≥40 字，这里与真实关卡同量级）。 */
const LONG_BODY =
  '吸收律说的是：如果一个与项是另一个与项的子集，那么它会被吸收掉，不留下任何痕迹。' +
  '推导只用分配律与 1 的性质：A + A·B = A·(1 + B) = A·1 = A，因为 1 + B 恒等于 1。';

const card = (id: string): LevelSpec['cards'][number] => ({
  id,
  title: `卡片 ${id}`,
  body: LONG_BODY,
  figureRef: null,
});

const item = (
  id: string,
  overrides: Partial<LevelSpec['items'][number]> = {},
): LevelSpec['items'][number] => ({
  id,
  kind: 'concept',
  stem: `题目 ${id} 的题干`,
  options: ['选项一', '选项二', '选项三'],
  answer: 1,
  variantGroup: 'vg-1',
  explainCorrect: `${id} 答对了：吸收律 A + A·B = A。`,
  explainWrong: `${id} 答错了：漏掉了运算符翻转这一步。`,
  misconceptionTags: ['吸收律误用'],
  sourceRef: '康华光·数字部分·第5版·表 2.1.1',
  pool: 'core',
  hintLadder: ['先提取公因子'],
  ...overrides,
});

/**
 * 七段齐全的教学关卡：guide → detail → probe → deepen → reteach → quiz → summary。
 *
 * 与 `content/levels/lv-bool-laws.spec.json` 同构但更小，让断言好写。
 */
const makeSpec = (): LevelSpec => ({
  schemaVersion: 1,
  meta: {
    id: 'lv-test',
    microKpId: 'kp-bool',
    title: '测试关卡',
    type: 'teaching',
    tier: 'P1',
    estimatedMinutes: 10,
    author: 'system',
    isEntry: false,
    nextLevelId: null,
  },
  sources: [{ ref: '康华光·数字部分·第5版', locator: 'p.34' }],
  cards: ['c-guide', 'c-detail', 'c-deepen', 'c-reteach', 'c-summary'].map(card),
  steps: [
    { id: 's-guide', kind: 'guide', title: '引导', cardIds: ['c-guide'], itemIds: [], requiredCorrect: 0 },
    {
      id: 's-detail',
      kind: 'detail',
      title: '展示细节',
      cardIds: ['c-detail'],
      itemIds: [],
      requiredCorrect: 0,
    },
    {
      id: 's-probe',
      kind: 'probe',
      title: '简单问题',
      cardIds: [],
      itemIds: ['i-probe'],
      requiredCorrect: 1,
    },
    {
      id: 's-deepen',
      kind: 'deepen',
      title: '深究',
      cardIds: ['c-deepen'],
      itemIds: ['i-deepen'],
      requiredCorrect: 0,
    },
    {
      id: 's-reteach',
      kind: 'reteach',
      title: '进一步讲解',
      cardIds: ['c-reteach'],
      itemIds: [],
      requiredCorrect: 0,
    },
    {
      id: 's-quiz',
      kind: 'quiz',
      title: '判定',
      cardIds: [],
      itemIds: ['i-quiz-1', 'i-quiz-2'],
      requiredCorrect: 1,
    },
    {
      id: 's-summary',
      kind: 'summary',
      title: '小结',
      cardIds: ['c-summary'],
      itemIds: [],
      requiredCorrect: 0,
    },
  ],
  items: [
    item('i-probe', { answer: 0 }),
    item('i-deepen', { answer: 1, pool: 'practice', sourceRef: null }),
    item('i-quiz-1', { answer: 1 }),
    item('i-quiz-2', { answer: 2 }),
  ],
  gating: { mode: 'none', itemCount: 2, passCount: 2 },
});

/** 一路推进到某一段（沿途所有题都按 `correct` 作答）。 */
const walkTo = (spec: LevelSpec, kind: string, correct: boolean): FlowState => {
  let state = createFlow();
  for (let guard = 0; guard < 20; guard += 1) {
    const step = currentStep(spec, state);
    if (!step) return state;
    if (step.kind === kind) return state;
    for (const itemId of step.itemIds) {
      const target = spec.items.find((entry) => entry.id === itemId);
      if (!target) throw new Error(`fixture 缺题 ${itemId}`);
      const wanted = target.answer;
      const choice = correct ? wanted : typeof wanted === 'number' ? (wanted + 1) % 3 : 'wrong';
      state = submitAnswer(spec, state, itemId, choice).state;
    }
    state = advance(spec, state);
  }
  throw new Error('推进次数超限，状态机疑似卡住');
};

describe('七段流程', () => {
  it('步骤齐全且顺序符合需求 17', () => {
    const spec = makeSpec();
    expect(spec.steps.map((step) => step.kind)).toEqual([
      'guide',
      'detail',
      'probe',
      'deepen',
      'reteach',
      'quiz',
      'summary',
    ]);
  });

  it('简单问题答对 → 跳过深究与进一步讲解，直接进入判定', () => {
    const spec = makeSpec();
    const state = walkTo(spec, 'quiz', true);
    expect(currentStep(spec, state)?.kind).toBe('quiz');
    // 深究与进一步讲解都被跳过，且跳过的 id 有据可查
    expect(state.skippedStepIds).toEqual(['s-deepen', 's-reteach']);
    expect(state.tookRemediation).toBe(false);
    expect(state.probePassed).toBe(true);
  });

  it('简单问题答错 → 真的走进深究，再经进一步讲解回到判定', () => {
    const spec = makeSpec();
    const state = walkTo(spec, 'deepen', false);
    expect(currentStep(spec, state)?.kind).toBe('deepen');
    expect(state.tookRemediation).toBe(true);
    expect(state.probePassed).toBe(false);

    const afterDeepen = walkTo(spec, 'reteach', false);
    expect(currentStep(spec, afterDeepen)?.kind).toBe('reteach');

    const afterReteach = walkTo(spec, 'quiz', false);
    expect(currentStep(spec, afterReteach)?.kind).toBe('quiz');
  });

  it('走完全程后 finished 为真，进度条每一段都有状态', () => {
    const spec = makeSpec();
    let state = createFlow();
    for (let guard = 0; guard < 20 && !state.finished; guard += 1) {
      const step = currentStep(spec, state);
      if (!step) break;
      for (const itemId of step.itemIds) {
        const target = spec.items.find((entry) => entry.id === itemId);
        if (!target) throw new Error('fixture 缺题');
        state = submitAnswer(spec, state, itemId, target.answer).state;
      }
      state = advance(spec, state);
    }
    expect(state.finished).toBe(true);
    expect(currentStep(spec, state)).toBeUndefined();
    const progress = stepProgress(spec, state);
    expect(progress).toHaveLength(7);
    // 全对的一趟：补救两段被跳过，其余各段都已走完 —— 没有「未开始」的段留下
    expect(progress.map((entry) => entry.status)).toEqual([
      'done',
      'done',
      'done',
      'skipped',
      'skipped',
      'done',
      'done',
    ]);
    expect(progress.every((entry) => entry.status !== 'upcoming')).toBe(true);
  });

  it('未答完的段落不会被推进（按钮禁用由界面负责，状态机保证不半途跳段）', () => {
    const spec = makeSpec();
    const atProbe = walkTo(spec, 'probe', true);
    const beforeAnswer = advance(spec, atProbe);
    expect(beforeAnswer.stepIndex).toBe(atProbe.stepIndex);
  });
});

describe('预写反馈（票 04 验收 3：提交后立即显示，不调模型）', () => {
  it('答对返回 explainCorrect，答错返回 explainWrong，全部来自 spec', () => {
    const spec = makeSpec();
    const atProbe = walkTo(spec, 'probe', true);
    const right = submitAnswer(spec, atProbe, 'i-probe', 0);
    expect(right.feedback.correct).toBe(true);
    expect(right.feedback.text).toBe(spec.items[0]?.explainCorrect);
    // 反馈是同步返回的：这个函数是同步函数，没有 await 可写
    expect(right.feedback.origin).toBe('spec');

    const wrong = submitAnswer(spec, atProbe, 'i-probe', 2);
    expect(wrong.feedback.correct).toBe(false);
    expect(wrong.feedback.text).toBe(spec.items[0]?.explainWrong);
    expect(wrong.feedback.misconceptionTags).toEqual(['吸收律误用']);
  });

  it('每道题的对错反馈都不为空且互不相同（防「复制粘贴同一句」）', () => {
    const spec = makeSpec();
    for (const entry of spec.items) {
      expect(entry.explainCorrect.trim().length).toBeGreaterThan(0);
      expect(entry.explainWrong.trim().length).toBeGreaterThan(0);
      expect(entry.explainCorrect).not.toBe(entry.explainWrong);
    }
  });

  it('已作答的题可以重建反馈（页面重渲染不丢）', () => {
    const spec = makeSpec();
    const submitted = submitAnswer(spec, walkTo(spec, 'probe', true), 'i-probe', 2);
    const rebuilt = feedbackFor(spec, submitted.state, 'i-probe');
    expect(rebuilt).toEqual(submitted.feedback);
  });

  it('同一题重复提交被忽略，作答不可改（证据一旦提交就是证据）', () => {
    const spec = makeSpec();
    const atProbe = walkTo(spec, 'probe', true);
    const first = submitAnswer(spec, atProbe, 'i-probe', 2);
    const again = submitAnswer(spec, first.state, 'i-probe', 0);
    expect(again.state.records).toHaveLength(1);
    expect(again.state.choices['i-probe']).toBe(2);
    expect(again.feedback.correct).toBe(false);
  });

  it('不属于当前步骤的题会被拒绝，而不是静默记录', () => {
    const spec = makeSpec();
    expect(() => submitAnswer(spec, createFlow(), 'i-quiz-1', 1)).toThrow(/不属于当前步骤/);
  });
});

describe('深究分支不扣掌握度（票 04 验收 4）', () => {
  it('深究段的作答记 0 分且标记为不计入掌握度', () => {
    const spec = makeSpec();
    const atDeepen = walkTo(spec, 'deepen', false);
    expect(inRemediation(currentStep(spec, atDeepen))).toBe(true);

    const { feedback, state } = submitAnswer(spec, atDeepen, 'i-deepen', 2);
    expect(feedback.correct).toBe(false);
    expect(feedback.masteryCredit).toBe(0);
    expect(feedback.countsTowardMastery).toBe(false);
    expect(state.records.at(-1)?.masteryCredit).toBe(0);
  });

  it('深究段答错也不会让掌握度总和下降', () => {
    const spec = makeSpec();
    const atDeepen = walkTo(spec, 'deepen', false);
    const before = masteryTotal(atDeepen);
    const after = submitAnswer(spec, atDeepen, 'i-deepen', 2).state;
    expect(masteryTotal(after)).toBe(before);
  });

  it('走了深究分支与没走，判定段的记分口径一致（都只算判定题）', () => {
    const spec = makeSpec();
    // 路径 A：简单问题答对，跳过补救分支，判定题全对
    let pass = walkTo(spec, 'quiz', true);
    for (const itemId of ['i-quiz-1', 'i-quiz-2']) {
      const target = spec.items.find((entry) => entry.id === itemId);
      if (!target) throw new Error('fixture 缺题');
      pass = submitAnswer(spec, pass, itemId, target.answer).state;
    }

    // 路径 B：简单问题答错，走完深究+进一步讲解（深究题答错），判定题同样全对
    let remediate = walkTo(spec, 'quiz', false);
    for (const itemId of ['i-quiz-1', 'i-quiz-2']) {
      const target = spec.items.find((entry) => entry.id === itemId);
      if (!target) throw new Error('fixture 缺题');
      remediate = submitAnswer(spec, remediate, itemId, target.answer).state;
    }

    const passQuizOnly = pass.records
      .filter((record) => record.stepKind === 'quiz')
      .reduce((sum, record) => sum + record.masteryCredit, 0);
    const remediateQuizOnly = remediate.records
      .filter((record) => record.stepKind === 'quiz')
      .reduce((sum, record) => sum + record.masteryCredit, 0);
    // 判定段记分完全相同 → 深究分支对掌握度零影响
    expect(remediateQuizOnly).toBe(passQuizOnly);
    // 而计入掌握度的记录数确实不同（深究那道题被排除在外）
    expect(remediate.records.length).toBeGreaterThan(pass.records.length);
    expect(remediate.records.length - pass.records.length).toBe(1);
    expect(countedRecordCount(remediate)).toBe(countedRecordCount(pass) - 0);
  });

  it('深究段即使答对也不加分（不靠补救分支刷掌握度）', () => {
    const spec = makeSpec();
    const atDeepen = walkTo(spec, 'deepen', false);
    const target = spec.items.find((entry) => entry.id === 'i-deepen');
    if (!target) throw new Error('fixture 缺题');
    const { feedback } = submitAnswer(spec, atDeepen, 'i-deepen', target.answer);
    expect(feedback.correct).toBe(true);
    expect(feedback.masteryCredit).toBe(0);
  });
});

describe('进度条与提示', () => {
  it('当前段标 current，之前的段 done，之后的段 upcoming，跳过的段 skipped', () => {
    const spec = makeSpec();
    const state = walkTo(spec, 'quiz', true);
    const statuses = stepProgress(spec, state).map((entry) => [entry.step.kind, entry.status]);
    expect(statuses).toEqual([
      ['guide', 'done'],
      ['detail', 'done'],
      ['probe', 'done'],
      ['deepen', 'skipped'],
      ['reteach', 'skipped'],
      ['quiz', 'current'],
      ['summary', 'upcoming'],
    ]);
  });

  it('inRemediation 只对深究与进一步讲解为真', () => {
    const spec = makeSpec();
    expect(inRemediation(spec.steps.find((step) => step.kind === 'deepen'))).toBe(true);
    expect(inRemediation(spec.steps.find((step) => step.kind === 'reteach'))).toBe(true);
    expect(inRemediation(spec.steps.find((step) => step.kind === 'quiz'))).toBe(false);
    expect(inRemediation(undefined)).toBe(false);
  });
});

/**
 * 拿**真实的手写关卡文件**跑一遍状态机 —— 这是验收 2 最直接的证明。
 *
 * 上面的 `makeSpec()` 是测试替身，它证明代码逻辑对；这一段证明**实际会发布的
 * 那张关卡**也能走通。两者缺一不可：只测替身会漏掉「作者写的内容不合流程」，
 * 只测真文件会因为断言难写而漏掉分支规则。
 */
describe('真实手写关卡（content/levels/lv-bool-laws.spec.json）', () => {
  const specPath = fileURLToPath(
    new URL('../../../../content/levels/lv-bool-laws.spec.json', import.meta.url),
  );
  const realSpec = JSON.parse(readFileSync(specPath, 'utf8')) as LevelSpec;

  it('七段齐全且顺序就是需求 17 的那条链路', () => {
    expect(realSpec.steps.map((step) => step.kind)).toEqual([
      'guide',
      'detail',
      'probe',
      'deepen',
      'reteach',
      'quiz',
      'summary',
    ]);
  });

  it('未掌握分支能真的走通：简单问题答错 → 深究 → 进一步讲解 → 判定 → 小结', () => {
    let state = walkTo(realSpec, 'deepen', false);
    expect(currentStep(realSpec, state)?.kind).toBe('deepen');
    expect(state.tookRemediation).toBe(true);

    // 深究段的题无论对错都记 0 分
    const deepenStep = currentStep(realSpec, state);
    const deepenItemId = deepenStep?.itemIds[0];
    if (!deepenItemId) throw new Error('深究段没有题');
    const deepenItem = realSpec.items.find((entry) => entry.id === deepenItemId);
    if (!deepenItem) throw new Error('深究题的 id 在 items 里找不到');
    const before = masteryTotal(state);
    const afterDeepen = submitAnswer(realSpec, state, deepenItemId, deepenItem.answer).state;
    expect(masteryTotal(afterDeepen)).toBe(before);

    state = advance(realSpec, afterDeepen);
    expect(currentStep(realSpec, state)?.kind).toBe('reteach');
    state = advance(realSpec, state);
    expect(currentStep(realSpec, state)?.kind).toBe('quiz');
    state = walkThroughStep(realSpec, state);
    state = advance(realSpec, state);
    expect(state.finished).toBe(true);
  });

  it('一次通过的分支：简单问题答对则跳过深究与进一步讲解', () => {
    const state = walkTo(realSpec, 'quiz', true);
    expect(currentStep(realSpec, state)?.kind).toBe('quiz');
    expect(state.skippedStepIds).toEqual(['s-deepen', 's-reteach']);
    expect(state.tookRemediation).toBe(false);
  });

  it('每道题都有可用的预写反馈，且对错两段不是同一句话', () => {
    for (const item of realSpec.items) {
      expect(item.explainCorrect.trim().length).toBeGreaterThan(20);
      expect(item.explainWrong.trim().length).toBeGreaterThan(20);
      expect(item.explainCorrect).not.toBe(item.explainWrong);
    }
  });
});
