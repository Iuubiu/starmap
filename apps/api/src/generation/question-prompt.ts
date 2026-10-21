/**
 * 把「一批教材片段」变成「一道符合 level.spec 的练习题」的提示词。
 *
 * ## 为什么提示词要独立成文件，而不是拼在 service 里
 *
 * 因为它是**可单测的纯函数**，且它的失败模式与业务逻辑完全不同：业务错是
 * 状态机写错，提示词错是模型听不懂或缺字段。把两者混在一处，改提示词时
 * 要读 DB 代码，改逻辑时会误碰提示词。这里输入是纯数据，输出是纯字符串。
 *
 * ## 为什么要求模型只输出一个 JSON 对象，而不是整张关卡
 *
 * 一次生成一整关（5 段步骤 + 6 张卡 + 4 道题）会让单次输出过长、局部非法
 * 就整体作废。这个流程是**一次调用出一道题**，再由 `assembleLevelSpec()`
 * 把 N 道题组装成 quiz 型关卡 —— 组装的骨架（步骤顺序、门控）是我们自己的
 * 代码，不交给模型，于是模型只需要为「题干 + 选项 + 答案 + 两个解析 + 错因
 * 标签」负责。这五项正是出题技能（`skills/question-author/SKILL.md`）里定义
 * 的最小可判分单元。
 *
 * ## 为什么同一知识点要出多次、每次带一个「角度」
 *
 * 一个知识点只出一道题，学习者在这个知识点上永远只有一个变式组，而
 * `MASTERY_MIN_VARIANTS = 3` 要求至少 3 个不同变式组才算「证据足够」——
 * 于是那张关卡无论答多少次都到不了「已掌握」，也就永远进不了复验排期。
 * 5 道题各有各的变式组才能把这条路走通（见 `constants.ts` 的
 * `QUESTIONS_PER_KP`）。
 *
 * 而「连续问 5 次同一个问题」会收敛到同一道题：不指定角度时模型每次都
 * 挑该知识点最典型的那道，实测 5 次里有 2–3 次题干几乎逐字相同。把角度
 * 写进提示词，等于把「出什么」从随机采样变成有覆盖的枚举。
 *
 * ## 语言约束为什么要写三遍
 *
 * 实测便宜的模型在 JSON 模式下仍会夹英文解释或直接产出英文题干（内容全是
 * 中文教材时尤其反常）。所以约束写进：系统提示词、用户提示词、以及产出后
 * 的 `checkChinese()`。前两处是「请求」，第三处是「验收」——只有验收能失败。
 */
import type { LlmMessage } from '../llm/llm.port.js';
import type { QuestionAngle } from './constants.js';

/** 一道题的材料：知识点 + 若干教材片段 */
export interface QuestionMaterial {
  microKpId: string;
  microKpName: string;
  /** 教材原文片段（来自 app.chunks），按相关度排序后取前若干条 */
  excerpts: Array<{ chunkId: string; text: string }>;
}

/**
 * 系统提示词：角色 + 硬约束。
 *
 * `temperature` 之外没有任何「请尽量」的措辞 —— 一道题要么有唯一答案要么
 * 没有，这不是可以商量的质量偏好。
 */
export const QUESTION_AUTHOR_SYSTEM_PROMPT = `你是核电子学课程（康华光《电子技术基础·数字部分》）的命题助手。
你的唯一任务：根据给定教材片段，为指定的微知识点出一道单项选择题。

必须遵守的硬约束：
1. 只输出一个 JSON 对象，不要 markdown 代码围栏，不要在 JSON 前后写任何解释。
2. 所有面向学习者的文字（题干 stem、四个选项 options、答对解析 explainCorrect、答错解析 explainWrong）必须使用简体中文。
3. 题干必须自足：仅凭题干就能作答，不得出现「如图」「见上文」「根据教材」这类外部引用。
4. 恰好 4 个选项，只有 1 个正确；三个干扰项必须是具体的错法（符号错、漏项、混淆定律），不能是随手加减的数字。
5. 不得在题干中泄露解题步骤或指定使用哪条公式。
6. sourceRef 只能填下面「可用教材片段」里出现过的 chunkId，不得编造。
7. stem、explainCorrect、explainWrong 每条至少 12 个汉字；四个选项每条至少 2 个字符。

输出字段（严格按此命名，全部必填）：
{
  "stem": "题干",
  "options": ["选项A", "选项B", "选项C", "选项D"],
  "answer": 0,
  "explainCorrect": "答对时的解析",
  "explainWrong": "答错时的解析",
  "misconceptionTags": ["具体错法标签"],
  "sourceRef": "chunkId",
  "hintLadder": ["第一层提示", "第二层提示"]
}`;

/**
 * 用户提示词：把材料摊平。
 *
 * 明确写出「本批次只出 practice 池的题」——即使 schema 层已经强制，让模型
 * 知道这件事能减少它产出「判定题」语气的题干（那种题干会写「考试重点」）。
 */
export function buildQuestionPrompt(material: QuestionMaterial, angle?: QuestionAngle): string {
  const excerpts = material.excerpts
    .map((e, i) => `[${i + 1}] chunkId=${e.chunkId}\n${e.text}`)
    .join('\n\n');

  // 角度段单独拼：没有角度时整段消失，提示词与票 16 的原文逐字一致。
  // 保留这条「无角度」路径是因为单题生成（脚本、排障、测试）仍然走它。
  const angleBlock =
    angle === undefined
      ? ''
      : `
本次出题角度：${angle.label}
${angle.hint}
要求：这一道题只考上面这一个侧面，不要把它写成对「${material.microKpName}」的综述；
题干要与「换个说法的定义题」明显不同，不要重复最常见的那个问法。
`;

  return `微知识点：${material.microKpName}（id=${material.microKpId}）

可用教材片段（这是你唯一的信息来源，sourceRef 只能取这里的 chunkId）：
${excerpts}
${angleBlock}
请出一道针对「${material.microKpName}」的单项选择题，只输出 JSON 对象。

补充说明：
- 这道题会进入**练习池**（practice），用于学生自测与巩固，不是正式判定题。
- answer 是正确选项在 options 数组里的下标（0 开始）。
- hintLadder 给 1–2 层递进提示，第一层只指出方向，第二层才指向关键一步。`;
}

/** 组装成 LlmPort 需要的消息数组 */
export function buildQuestionMessages(
  material: QuestionMaterial,
  angle?: QuestionAngle,
): LlmMessage[] {
  return [
    { role: 'system', content: QUESTION_AUTHOR_SYSTEM_PROMPT },
    { role: 'user', content: buildQuestionPrompt(material, angle) },
  ];
}

/**
 * 逐字统计汉字比例，用于判断「语言是否合规」。
 *
 * 判据不是「不含英文字母」——一题干必然含 `A·B`、`TTL` 这类符号与缩写。
 * 真正要拦的是**整句话是英文**。所以判据是：汉字数量至少达到总字符数的
 * 一个下限比例，且至少有一定数量的汉字。
 *
 * 阈值取 0.2 与 8 个汉字：`A + A·B 化简后等于什么？` 是 20 字符 8 汉字
 * （比例 0.4），而 `Simplify A + A·B.` 是 17 字符 0 汉字。两者都能被这条
 * 判据正确区分，且都不依赖人工标注。
 */
export function chineseRatio(text: string): number {
  const chars = [...text];
  if (chars.length === 0) return 0;
  const han = chars.filter((c) => /\p{Script=Han}/u.test(c)).length;
  return han / chars.length;
}

export function hanCount(text: string): number {
  return [...text].filter((c) => /\p{Script=Han}/u.test(c)).length;
}

/**
 * 判断一段文字是否「语言合规」。
 *
 * 返回 `null` 表示合规；否则返回给用户看的具体原因（会进 failure_message）。
 * 返回原因而不是布尔值，是因为验收⑤要求「记录具体失败原因」——「语言不合规」
 * 三个字对着一份 JSON 无从下手，而「explainWrong 只有 0 个汉字」能直接定位。
 *
 * `minHan` 由调用方按字段给：题干可以很短（`A + A·B 化简后等于什么？` 只有
 * 7 个汉字，这是仓库里真实存在的题干），解析则应该成句。用一个统一阈值会
 * 要么放过英文解析、要么误杀合法短题干。
 */
export function checkLanguage(field: string, text: string, minHan: number): string | null {
  const han = hanCount(text);
  if (han < minHan) {
    return `${field} 只有 ${han} 个汉字（下限 ${minHan}），疑似不是中文（原文：${text.slice(0, 40)}）`;
  }
  // 汉字占比下限拦的是「中文夹在一大段英文里」——短题干会天然低（符号多），
  // 所以只在原文足够长时才用这条判据。
  if (text.length >= 30 && chineseRatio(text) < 0.15) {
    return `${field} 的汉字占比只有 ${(chineseRatio(text) * 100).toFixed(0)}%，低于 15% 下限（原文：${text.slice(0, 40)}）`;
  }
  return null;
}
