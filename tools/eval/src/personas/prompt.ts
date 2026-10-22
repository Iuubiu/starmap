/**
 * 把 persona 配置渲染成模拟学习者的 system prompt。
 *
 * 分工：JSON 里放"这个人是谁"（事实），prompt 里放"怎么演"（规则）。两者
 * 不能混——prompt 里的规则要能被三档共用，JSON 里的差异要能被报告直接引用。
 *
 * 三条硬规则（来自 .scratch/lit/ux-eval-methods.md 第三节），写在 prompt 末尾，
 * 且**每次都在**：
 *  ① 只扮演学习者，不评价产品、不提"测试""评估""按钮设计"；
 *  ② 不假装看懂（这是最容易被 LLM 违反的一条：它倾向于表现"我懂了谢谢"）；
 *  ③ 只输出 JSON，不输出任何其它文本。
 *
 * 另外显式告诉模型"不要复述屏幕文字"——否则模拟用户会把界面文案抄回来，
 * 报告里看起来像用户在说话，实际是产品的回声，会把语言密度等指标污染掉。
 */

import type { Persona } from './schema.ts';

/** 三档共用、与具体人格无关的输出协议说明。 */
function renderOutputProtocolContract(persona: Persona): string {
  const { actionEnum, feltScales, noteMaxChars } = persona.outputProtocol;
  const felt = (key: 'effort' | 'confusion' | 'frustration'): string => {
    const scale = feltScales[key];
    return `${key} ${scale.min}–${scale.max}（你通常 ${scale.typical[0]}–${scale.typical[1]}）`;
  };

  return [
    '## 输出协议（硬性）',
    '',
    '每次只输出一个 JSON 对象，不要有任何额外文字、不要用代码块包裹：',
    '',
    '```json',
    '{"action":"type|click|scroll|submit_form|skip|give_up","target_hint":"要点哪里/往哪输入的自然语言描述","text":"要输入的文字（action=type 时必填）","felt":{"effort":1,"confusion":0,"frustration":0},"note":"一句话内心独白"}',
    '```',
    '',
    `- action 只能是：${actionEnum.join(' / ')}`,
    `- felt：${felt('effort')}；${felt('confusion')}；${felt('frustration')}`,
    `- note：不超过 ${noteMaxChars} 字，写你此刻真实的困惑或判断，不要复述屏幕上的文字`,
    '- target_hint 用你自己的说法描述位置（"上面那排第二个""中间那张卡片"），不要编造 DOM 选择器',
    '',
    '## 三条硬规则',
    '',
    '1. 你只是学习者。不要评价产品、不要提"测试""评估""界面设计""这个按钮"。',
    '2. 不要假装看懂。没看懂就说不懂，不要写"我明白了""原来如此"来结束对话。',
    '3. 只输出 JSON。',
  ].join('\n');
}

/** 渲染单个 persona 的 system prompt。 */
export function renderSystemPrompt(persona: Persona): string {
  const bp = persona.behaviorParams;
  const lang = persona.language;

  const lines: string[] = [
    `你现在扮演一位学习者，名叫${persona.displayName}。你正在使用一个核电子学学习网站。`,
    '你要完全按下面这份设定行动，不要跳出角色，也不要表现出"我在扮演"的痕迹。',
    '',
    '## 你是谁',
    '',
    persona.identity.summary,
    '',
    `- 你想达成：${persona.identity.goal}`,
    `- 为什么：${persona.identity.motivation}`,
    `- 时间情况：${persona.identity.timePressure}`,
    '',
    '## 你已经会的',
    '',
    ...persona.knownKnowledge.map((item) => `- ${item}`),
    '',
    '## 你不会的（不要假装会）',
    '',
    ...persona.unknownKnowledge.map((item) => `- ${item}`),
    '',
    '## 你的典型误解',
    '',
    /* 这句"不要主动纠正自己"很重要：如果模型提前就把误解改对了，
       这条误解在评估里就永远不会触发，等于白设。 */
    '下面这些是你真心相信的错误理解。除非对方给出让你信服的解释，否则不要主动纠正自己：',
    '',
    ...persona.misconceptions.map(
      (m, i) => `${i + 1}. 你相信：${m.belief}\n   （这对你来说很自然，因为${m.whyPlausible}）`,
    ),
    '',
    '## 你的行为方式（这些是规则，不是形容词）',
    '',
    `- 耐心：${bp.patience.rule}`,
    `- 求助：${bp.helpSeeking.rule}`,
    `- 被反问：${bp.probeTolerance.rule}（最多能忍 ${bp.probeTolerance.rounds} 轮）`,
    `- 答错被纠正时：${bp.wrongAnswerHandling.rule}`,
    `- 卡住时：${bp.stuckHandling.rule}`,
    `- 放弃条件：${bp.abandonCondition.rule}`,
    '',
    '## 你怎么说话',
    '',
    `- 语体：${lang.register}`,
    `- 输入长度：通常 ${lang.inputLengthChars.min}–${lang.inputLengthChars.max} 字（典型 ${lang.inputLengthChars.typical} 字）；第一轮${lang.inputLengthChars.noteOnFirstTurn}`,
    `- 术语：${lang.terminologyStyle}（术语密度约 ${Math.round(lang.terminologyDensity * 100)}%）`,
    `- 错别字与标点：${lang.typos}`,
    '',
    '你会说的话大概是这样的（不要照抄，只学语感）：',
    '',
    ...lang.examples.map((example) => `- 「${example}」`),
    '',
    '## 你想要的产物',
    '',
    `你希望得到：${persona.outputProtocol.expectedArtifact}。对方给不出这个，你就不会满意。`,
    '',
    renderOutputProtocolContract(persona),
  ];

  return lines.join('\n');
}

/**
 * 渲染「用户看到系统回复之后」的 user 消息。
 *
 * 为什么把系统回复作为 user 而不是 assistant 传进去：模拟用户的每一步都是
 * 一次独立的单轮补全，它没有"自己上一句说了什么"的记忆义务；把界面内容
 * 放进 user 侧，可以避免模型把界面文字误当成自己说过的话而复述。
 */
export function renderObservation(params: {
  persona: Persona;
  screen: string;
  turn: number;
  progressNote?: string;
}): string {
  const { persona, screen, turn, progressNote } = params;
  const parts = [
    `## 第 ${turn} 轮`,
    '',
    '你眼前的界面上写着：',
    '',
    '<<<界面开始',
    screen.trim(),
    '界面结束>>>',
    '',
  ];

  if (progressNote) {
    parts.push(`（上一轮之后发生的变化：${progressNote}）`, '');
  }

  parts.push(
    `如果连续 ${persona.behaviorParams.abandonCondition.maxTurnsWithoutProgress} 轮都没有看到任何新东西，你会放弃。`,
    '',
    '现在决定你的下一步动作，只输出 JSON。',
  );

  return parts.join('\n');
}
