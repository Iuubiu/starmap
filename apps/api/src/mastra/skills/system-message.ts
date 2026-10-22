import type { ScannedSkill } from '../../skills/skill-scanner.js';

/**
 * system message 的**唯一组装点**（票 15 的「禁用必须真的影响 agent」）。
 *
 * ## 为什么「摘除」而不是「提示词里说别用」
 *
 * 在提示词里写一句「不要使用 socratic-tutor」是**建议**：模型完全可以在
 * 下一轮忽略它，而且禁用与否这件事会占据上下文、成为可以被推理绕过的东西。
 * 真正的禁用是**它不在体里**：禁用的 skill 的正文、名字、触发场景一个字符
 * 都不进 system message。模型看不到它，就无从选择它。
 *
 * 所以这个函数只接收**已启用的** skill 列表。调用方负责过滤，这里不做
 * `if (skill.enabled)` 之类的判断——那种分支会把「禁用」重新变成运行时
 * 决策，而它应该是一个更早的事实。
 *
 * ## 为什么把正文也放进去
 *
 * Mastra 原生 skills 走的是「先给目录，按需加载正文」的渐进披露。我们这里
 * 没有 tool 循环（回合是一次 LLM 调用），按需加载没有落点：只给名字和描述，
 * skill 的正文就永远进不了模型。所以启用即注入正文——代价是 token，收益是
 * 「启用/禁用」这个开关在真实行为上可观测。
 */

export interface ComposeInput {
  /** 与 skill 无关的基础人设与输出格式约束 */
  basePrompt: string;
  /** **已经过滤好的**（仅启用的）skill */
  enabled: readonly ScannedSkill[];
}

export interface ComposedSystemMessage {
  systemMessage: string;
  includedSkills: string[];
  /** 被摘除的 skill 名 —— 预览接口要显式列出，证明它们真的不在体里 */
  excludedSkills: string[];
}

/** 渲染单个 skill 的段落。 */
function renderSkill(skill: ScannedSkill): string {
  const lines: string[] = [];
  lines.push(`### ${skill.name}（v${skill.version}）`);
  lines.push(skill.description.trim());
  if (skill.triggerScenarios.length > 0) {
    lines.push('适用场景：');
    for (const scenario of skill.triggerScenarios) lines.push(`- ${scenario}`);
  }
  if (skill.references.length > 0) {
    lines.push(
      `可引用的参考文件：${skill.references.map((r) => `references/${r.name}`).join('、')}`,
    );
  }
  lines.push('');
  lines.push(skill.instructions.trim());
  return lines.join('\n');
}

/**
 * 组装 system message。
 *
 * `excluded` 参数只用于**报告**，不参与拼装——这一点是刻意的：如果它参与
 * 拼装（哪怕只是拼一个「以下 skill 不可用」的段落），禁用就又变回了提示词
 * 约束。它出现在返回值里，仅仅是为了让预览接口能证明「这些名字在
 * systemMessage 里搜不到」。
 */
export function composeSkillSystemMessage(
  input: ComposeInput,
  excluded: readonly string[] = [],
): ComposedSystemMessage {
  const parts: string[] = [input.basePrompt.trim()];

  if (input.enabled.length > 0) {
    parts.push('');
    parts.push('# 可用的技能');
    parts.push(
      '下面是本次对话已启用的技能。它们的指示与本节的基础约束同等优先；' +
        '与基础约束冲突时，以基础约束为准。',
    );
    for (const skill of input.enabled) {
      parts.push('');
      parts.push(renderSkill(skill));
    }
  }

  return {
    systemMessage: parts.join('\n').trimEnd(),
    includedSkills: input.enabled.map((s) => s.name),
    excludedSkills: [...excluded],
  };
}
