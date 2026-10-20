/**
 * 关卡流程状态机 —— 票 04 的核心，**纯函数、不含 React**。
 *
 * 为什么要单独一层而不是把逻辑写在页面组件里：
 *
 * - 七段流程有一条「未掌握 → 深究 → 进一步讲解」的**分支**，分支条件（简单问题
 *   答对几道）和分支后果（跳过哪几步、掌握度记不记分）都是可测的规则。写进组件
 *   就只能靠点击去测，而点击测不出「深究分支的记分恒为 0」这种不变量。
 * - 票 05 要接 BKT：届时把 `masteryCredit` 换成概率增量即可，组件一行不用动。
 *
 * 状态是**不可变**的：每个函数返回新对象。React 里直接 `setState(next)`，
 * 不必担心原地改数组导致的漏渲染。
 */
import type {
  LevelSpec,
  LevelSpecItemsItem,
  LevelSpecStepsItem,
  LevelSpecStepsItemKind,
} from '../api/generated/model';

export type StepKind = LevelSpecStepsItemKind;
export type LevelStep = LevelSpecStepsItem;
export type LevelItem = LevelSpecItemsItem;

/**
 * 作答值。选择题是选项下标（数字），填空题是字符串。
 *
 * 校验器允许 `answer: number | string`，所以这里也必须两种都收 —— 只做选择题会
 * 让未来手写的填空题在类型上无处安放。
 */
export type AnswerValue = number | string;

/** 七段的规范顺序（与 packages/shared 的 TEACHING_SPINE 同一份措辞）。 */
export const STEP_KIND_LABEL: Record<StepKind, string> = {
  guide: '引导',
  detail: '展示细节',
  probe: '简单问题',
  deepen: '深究',
  reteach: '进一步讲解',
  quiz: '判定',
  summary: '小结',
};

/**
 * 深究分支的两段。
 *
 * 票 04 的硬要求：这一支**全程不扣掌握度**。它不是「答错了扣分」，而是
 * 「把你脑子里的错误规则挖出来」——扣分只会让学习者学会隐藏错误，而诊断恰恰
 * 需要错误暴露出来。所以这两段里的作答 `masteryCredit` 恒为 0。
 */
const REMEDIATION_KINDS: ReadonlySet<StepKind> = new Set<StepKind>(['deepen', 'reteach']);

/** 一次作答的留痕。票 05 的 BKT 会拿它当证据序列，票 07 的复验会拿它算变式覆盖。 */
export interface AnswerRecord {
  itemId: string;
  stepId: string;
  stepKind: StepKind;
  choice: AnswerValue;
  correct: boolean;
  /**
   * 这次作答对掌握度的记分。
   *
   * **票 04 还没有掌握度引擎**：这里是 ±1 的占位（对 +1、错 −1），只用于证明
   * 「深究分支恒为 0」这条不变量。票 05 会把它换成 BKT 的 p(L) 增量，字段名不变。
   */
  masteryCredit: number;
  /** 是否计入掌握度。深究/进一步讲解段恒为 `false`。 */
  countsTowardMastery: boolean;
}

/** 整个播放器的状态。 */
export interface FlowState {
  /** 当前步骤在 `spec.steps` 里的下标；`finished` 时为 `steps.length`。 */
  stepIndex: number;
  /** 已作答的题：itemId → 选择。有键即代表「已提交」，作答不可改。 */
  choices: Record<string, AnswerValue>;
  /** 按提交顺序排列的作答记录。 */
  records: AnswerRecord[];
  /** 简单问题的判定结果；还没走到 `probe` 时为 `null`。 */
  probePassed: boolean | null;
  /** 是否真的走进了深究分支（用于小结页显示「走了补救路径」）。 */
  tookRemediation: boolean;
  /** 因为简单问题达标而被跳过的步骤 id。 */
  skippedStepIds: string[];
  /** 已越过最后一段。 */
  finished: boolean;
}

/** 提交后立即返回给界面的反馈。**内容全部来自 spec**，不调模型。 */
export interface Feedback {
  itemId: string;
  correct: boolean;
  /** 预写反馈正文：答对取 `explainCorrect`，答错取 `explainWrong`。 */
  text: string;
  /** 错因标签（答对时为空数组）。 */
  misconceptionTags: string[];
  /** 教材溯源（题目作者填的，可能为 null）。 */
  sourceRef: string | null;
  masteryCredit: number;
  countsTowardMastery: boolean;
  /**
   * 固定为 `'spec'`：反馈来自作者预写的文本。
   *
   * 界面据此可以断言「不等模型」，测试也用它证明没有任何生成调用。
   */
  origin: 'spec';
}

/** 某一步在进度条上的状态。 */
export type StepStatus = 'done' | 'current' | 'upcoming' | 'skipped';

export interface StepProgressEntry {
  step: LevelStep;
  index: number;
  status: StepStatus;
}

/** 新建一次播放：从第一段开始，什么都没答。 */
export function createFlow(): FlowState {
  return {
    stepIndex: 0,
    choices: {},
    records: [],
    probePassed: null,
    tookRemediation: false,
    skippedStepIds: [],
    finished: false,
  };
}

/** 当前步骤。越界（已结束）返回 `undefined`。 */
export function currentStep(spec: LevelSpec, state: FlowState): LevelStep | undefined {
  return spec.steps[state.stepIndex];
}

/** 按 id 取题。找不到返回 `undefined`（校验器保证不会，但索引访问本来就可能空）。 */
export function findItem(spec: LevelSpec, itemId: string): LevelItem | undefined {
  return spec.items.find((item) => item.id === itemId);
}

/** 判对错。数字答案比下标，字符串答案去空白后逐字比。 */
export function judgeAnswer(item: LevelItem, choice: AnswerValue): boolean {
  if (typeof item.answer === 'number') {
    return typeof choice === 'number' && choice === item.answer;
  }
  return typeof choice === 'string' && choice.trim() === item.answer.trim();
}

/**
 * 这一段的作答对掌握度记多少分。
 *
 * 深究/进一步讲解 → 0；其余段对 +1、错 −1（占位，见 `AnswerRecord.masteryCredit`）。
 */
export function masteryCreditFor(kind: StepKind, correct: boolean): number {
  if (REMEDIATION_KINDS.has(kind)) return 0;
  return correct ? 1 : -1;
}

/**
 * 提交一道题的答案，返回**新状态**与**立即显示**的反馈。
 *
 * 「立即」是字面意思：反馈字符串就在 `spec.items[*].explainCorrect /
 * explainWrong` 里，这个函数只做一次查表和一次比较，没有异步、没有网络、
 * 没有模型调用。票 04 的验收 3 就是这一条。
 *
 * 同一题重复提交会被忽略（返回原状态的等值拷贝与既有反馈），因为作答一旦
 * 提交就是证据，不能改；要重来请重开整关。
 */
export function submitAnswer(
  spec: LevelSpec,
  state: FlowState,
  itemId: string,
  choice: AnswerValue,
): { state: FlowState; feedback: Feedback } {
  const step = currentStep(spec, state);
  if (!step) throw new Error('关卡已经结束，不能再作答');

  const item = findItem(spec, itemId);
  if (!item) throw new Error(`关卡里没有这道题：${itemId}`);
  if (!step.itemIds.includes(itemId)) {
    throw new Error(`题 ${itemId} 不属于当前步骤 ${step.id}`);
  }

  const existing = state.choices[itemId];
  if (existing !== undefined) {
    return { state, feedback: feedbackFor(spec, state, itemId) };
  }

  const correct = judgeAnswer(item, choice);
  const countsTowardMastery = !REMEDIATION_KINDS.has(step.kind);
  const record: AnswerRecord = {
    itemId,
    stepId: step.id,
    stepKind: step.kind,
    choice,
    correct,
    masteryCredit: masteryCreditFor(step.kind, correct),
    countsTowardMastery,
  };

  const nextState: FlowState = {
    ...state,
    choices: { ...state.choices, [itemId]: choice },
    records: [...state.records, record],
  };

  const feedback: Feedback = {
    itemId,
    correct,
    text: correct ? item.explainCorrect : item.explainWrong,
    misconceptionTags: correct ? [] : [...item.misconceptionTags],
    sourceRef: item.sourceRef,
    masteryCredit: record.masteryCredit,
    countsTowardMastery,
    origin: 'spec',
  };

  return { state: nextState, feedback };
}

/**
 * 取一道题已有反馈（已作答过才可用）。
 *
 * 与 `submitAnswer` 分开是为了「渲染时重建反馈」：页面重渲染或刷新进度时，
 * 已答题目仍要显示当时那条预写反馈，而不是重算一遍。
 */
export function feedbackFor(spec: LevelSpec, state: FlowState, itemId: string): Feedback {
  const record = state.records.find((entry) => entry.itemId === itemId);
  const item = findItem(spec, itemId);
  if (!record || !item) throw new Error(`题 ${itemId} 还没有作答记录`);

  return {
    itemId,
    correct: record.correct,
    text: record.correct ? item.explainCorrect : item.explainWrong,
    misconceptionTags: record.correct ? [] : [...item.misconceptionTags],
    sourceRef: item.sourceRef,
    masteryCredit: record.masteryCredit,
    countsTowardMastery: record.countsTowardMastery,
    origin: 'spec',
  };
}

/** 这一段答对了几道。 */
export function correctCountInStep(state: FlowState, step: LevelStep): number {
  return state.records.filter((record) => record.stepId === step.id && record.correct).length;
}

/** 这一段的题是否都提交了。没有题的段落视为已完成。 */
export function isStepComplete(state: FlowState, step: LevelStep): boolean {
  return step.itemIds.every((itemId) => state.choices[itemId] !== undefined);
}

/**
 * 推进一段。
 *
 * 分支规则（需求 17）：
 * - 走完「简单问题」时评估：答对数 ≥ `requiredCorrect` → **达标**，跳过
 *   深究与进一步讲解，直接进入判定段；
 * - 未达标 → 依次进入深究 → 进一步讲解，再回到判定段。
 *
 * 当前段还没答完时**原地不动**（返回等值状态）。按钮该禁用由界面负责，
 * 状态机只保证「不会半途跳段」。
 */
export function advance(spec: LevelSpec, state: FlowState): FlowState {
  const step = currentStep(spec, state);
  if (!step) return state;
  if (!isStepComplete(state, step)) return state;

  const isProbe = step.kind === 'probe';
  const probePassed = isProbe
    ? correctCountInStep(state, step) >= step.requiredCorrect
    : state.probePassed;

  // 达标才跳过补救分支。未达标时 next 就是紧随其后的深究段（若存在）。
  let next = state.stepIndex + 1;
  const skipped: string[] = [];
  if (isProbe && probePassed === true) {
    while (next < spec.steps.length) {
      const candidate = spec.steps[next];
      if (!candidate) break;
      if (!REMEDIATION_KINDS.has(candidate.kind)) break;
      skipped.push(candidate.id);
      next += 1;
    }
  }

  const entering = spec.steps[next];
  const tookRemediation = entering?.kind === 'deepen' ? true : state.tookRemediation;

  return {
    ...state,
    stepIndex: next,
    finished: next >= spec.steps.length,
    probePassed,
    tookRemediation,
    skippedStepIds: [...state.skippedStepIds, ...skipped],
  };
}

/** 掌握度记分总和。深究分支走完时它必须与「只答判定题」时完全相同 —— 这就是「不扣分」。 */
export function masteryTotal(state: FlowState): number {
  return state.records.reduce((sum, record) => sum + record.masteryCredit, 0);
}

/** 计入掌握度的作答条数。 */
export function countedRecordCount(state: FlowState): number {
  return state.records.filter((record) => record.countsTowardMastery).length;
}

/** 进度条数据：七段各自的状态。 */
export function stepProgress(spec: LevelSpec, state: FlowState): StepProgressEntry[] {
  return spec.steps.map((step, index) => {
    let status: StepStatus;
    if (state.skippedStepIds.includes(step.id)) {
      status = 'skipped';
    } else if (index < state.stepIndex || state.finished) {
      status = 'done';
    } else if (index === state.stepIndex) {
      status = 'current';
    } else {
      status = 'upcoming';
    }
    return { step, index, status };
  });
}

/** 当前段是否处于「深究分支」——界面据此显示「本步不扣掌握度」提示条。 */
export function inRemediation(step: LevelStep | undefined): boolean {
  return step !== undefined && REMEDIATION_KINDS.has(step.kind);
}
