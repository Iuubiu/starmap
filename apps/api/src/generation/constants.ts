/**
 * 生成侧的容量常量。
 *
 * ## 为什么 `QUESTIONS_PER_KP = 5`
 *
 * 两个门槛把它夹住了：
 *
 *   - 下界：票面「每关 5–8 题」，5 是下界。少于 5 题的关卡在播放器里
 *     `StepRail` 只有一段 quiz，学生看不到「一批题」的感觉。
 *   - 变式：`packages/engine/src/mastery.ts` 的 `MASTERY_MIN_VARIANTS = 3`
 *     要求至少 3 个不同变式组才认为「证据足够」。1 个变式答 40 次仍然
 *     `variantCount = 1`，永远不会 `mastered`。
 *
 * 5 是能同时满足两者的最小整数式选择：5 题 **各占一个变式组**（
 * `assembleLevelSpec()` 给每题一个 `variantGroup`），所以 5 题 = 5 变式；
 * 两轮作答即 10 次 ≥ `MASTERY_MIN_ATTEMPTS = 8`。
 *
 * ## 为什么下限是 3 而不是「有几道算几道」
 *
 * 3 是 `MASTERY_MIN_VARIANTS` 本身。少于 3 道题的关卡即使全答对也凑不出
 * 3 个变式，学习者在这个知识点上永远到不了「已掌握」—— 落一张这样的关卡
 * 比不落更糟：它看起来能练，实际练不出来，而界面上不会有任何错误。
 */
export const QUESTIONS_PER_KP = 5;

/**
 * 一次生成至少成功几道题才组装关卡。
 *
 * 与 `MASTERY_MIN_VARIANTS` 对齐（都是 3）。低于它宁可不落库也不落一张
 * 凑数的关卡 —— 理由见上面 `QUESTIONS_PER_KP` 的注释。
 */
export const MIN_QUESTIONS_PER_KP = 3;

/**
 * 出题角度：让同一知识点的多次调用产出**不同侧面**的题，而不是同一道题
 * 换五种措辞。
 *
 * 为什么角度要写在这里而不是交给模型自由发挥：不指定角度时，5 次调用会
 * 收敛到「这个知识点最典型的那道题」，题干高度相似（实测同一材料连续 5 次
 * 出题，有 2–3 次题干几乎逐字相同）。指定角度把「出什么」从随机采样变成
 * 有覆盖的枚举。
 *
 * 8 个角度对应 `GenerationRunRequestSchema.questionsPerKp` 的上限 8。
 * 顺序有意义：靠前的角度更基础，`questionsPerKp` 小的时候先覆盖它们。
 */
export interface QuestionAngle {
  /** 稳定的机器标识，进日志与失败明细 */
  readonly key: string;
  /** 给学习者/排障者看的名字 */
  readonly label: string;
  /** 写进用户提示词的一句话指向 */
  readonly hint: string;
}

export const QUESTION_ANGLES: readonly QuestionAngle[] = [
  {
    key: 'concept',
    label: '概念辨析',
    hint: '考「这个知识点里最容易被混为一谈的两个东西有什么区别」，正确项要靠定义判断',
  },
  {
    key: 'applicability',
    label: '公式适用条件',
    hint: '考「这条公式/结论在什么前提下才能用」，干扰项是把它套到不满足前提的场合',
  },
  {
    key: 'magnitude',
    label: '数值与量级',
    hint: '给一组具体取值，考代入后的结果或数量级，干扰项是漏项、进位或单位错误',
  },
  {
    key: 'mistake',
    label: '常见错误',
    hint: '还原一个真实的学生错法，让正确项指出错在哪一步',
  },
  {
    key: 'boundary',
    label: '边界情形',
    hint: '考全 0、全 1、单变量、空集这类边界输入下的结果',
  },
  {
    key: 'derivation',
    label: '推导步骤',
    hint: '考从已知条件到结论的下一步，正确项是唯一合法的那一步变换',
  },
  {
    key: 'engineering',
    label: '工程应用',
    hint: '把知识点放进一个电路/芯片的实际场景，考该用哪条结论',
  },
  {
    key: 'representation',
    label: '表示与等价',
    hint: '考同一件事的另一种表示（真值表、逻辑图、表达式）之间的等价关系',
  },
];

/**
 * 取这次要用的 `count` 个角度。
 *
 * `count` 超出角度表长度时**循环复用**并追加序号：宁可同一个角度出两道题，
 * 也不要因为 9 > 8 就直接失败。序号写进 `label` 而不是 `key`，这样失败
 * 明细里两句都是「数值与量级（第 2 轮）」，能分清是哪一次。
 */
export function anglesFor(count: number): QuestionAngle[] {
  const total = Math.max(1, Math.trunc(count));
  return Array.from({ length: total }, (_unused, index) => {
    const base = QUESTION_ANGLES[index % QUESTION_ANGLES.length]!;
    const round = Math.floor(index / QUESTION_ANGLES.length);
    return round === 0
      ? base
      : { ...base, key: `${base.key}-${round + 1}`, label: `${base.label}（第 ${round + 1} 轮）` };
  });
}
