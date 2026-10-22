import { describe, expect, it } from 'vitest';
import {
  buildQuestionMessages,
  buildQuestionPrompt,
  checkLanguage,
  chineseRatio,
  hanCount,
  QUESTION_AUTHOR_SYSTEM_PROMPT,
  type QuestionMaterial,
} from './question-prompt.js';

/**
 * 提示词是纯函数，所以它的测试可以断言**内容**而不只是「没崩」。
 *
 * 这里的断言分两类：
 *   1. 结构性的（必须出现教材片段、必须要求 JSON）——防手滑删段落
 *   2. 语言判据的边界（真实题干能过、英文解析被拦）——防阈值调错
 */

const material: QuestionMaterial = {
  microKpId: 'kp-1-5',
  microKpName: '二值逻辑变量与基本逻辑运算',
  excerpts: [
    { chunkId: 'ck-a', text: '逻辑变量只有 0 和 1 两种取值。' },
    { chunkId: 'ck-b', text: '与运算记作 A·B，或运算记作 A+B。' },
  ],
};

describe('buildQuestionMessages', () => {
  it('产出 system + user 两条消息，且角色顺序正确', () => {
    const messages = buildQuestionMessages(material);
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(messages[0]!.content).toBe(QUESTION_AUTHOR_SYSTEM_PROMPT);
  });

  it('用户提示词里带着每一个教材片段的 chunkId 与原文', () => {
    const prompt = buildQuestionPrompt(material);
    for (const excerpt of material.excerpts) {
      expect(prompt).toContain(excerpt.chunkId);
      expect(prompt).toContain(excerpt.text);
    }
    expect(prompt).toContain(material.microKpName);
    expect(prompt).toContain(material.microKpId);
  });

  it('系统提示词明确要求只输出 JSON、只用中文、不得编造 sourceRef', () => {
    // 这三条是产出被校验器拦下的三大原因，删掉任何一条都会让失败率上升。
    expect(QUESTION_AUTHOR_SYSTEM_PROMPT).toContain('只输出一个 JSON 对象');
    expect(QUESTION_AUTHOR_SYSTEM_PROMPT).toContain('简体中文');
    expect(QUESTION_AUTHOR_SYSTEM_PROMPT).toContain('不得编造');
  });

  it('说明这道题进练习池', () => {
    // 让模型知道池的归属，能减少它产出「考试重点」语气的题干。
    expect(buildQuestionPrompt(material)).toContain('练习池');
  });
});

describe('chineseRatio / hanCount', () => {
  it('纯汉字比例为 1', () => {
    expect(chineseRatio('逻辑变量')).toBe(1);
    expect(hanCount('逻辑变量')).toBe(4);
  });

  it('纯英文比例为 0', () => {
    expect(chineseRatio('Simplify this expression')).toBe(0);
  });

  it('空字符串不除零', () => {
    expect(chineseRatio('')).toBe(0);
    expect(hanCount('')).toBe(0);
  });

  it('混合文本按字符数算，符号与数字计入分母', () => {
    // 'A+B等于C' → 2 汉字 / 6 字符
    expect(chineseRatio('A+B等于C')).toBeCloseTo(2 / 6, 5);
    // 'A·B+A·C=A(B+C)对吗' → 2 汉字 / 16 字符（中点算一个字符）
    expect(chineseRatio('A·B+A·C=A(B+C)对吗')).toBeCloseTo(2 / 16, 5);
  });
});

describe('checkLanguage', () => {
  it('真实的中文短题干能过（这是仓库里 lv-bool-laws 的真实题干长度）', () => {
    // 只有 7 个汉字，如果阈值定成 8 就会误杀合法题干。
    expect(checkLanguage('stem', 'A + A·B 化简后等于什么？', 5)).toBeNull();
  });

  it('英文题干被拦下，并点名是哪个字段', () => {
    const problem = checkLanguage('stem', 'Simplify the expression A + A·B', 5);
    expect(problem).toContain('stem');
    expect(problem).toContain('0 个汉字');
  });

  it('英文解析被拦下（解析要成句，阈值更高）', () => {
    const problem = checkLanguage('explainCorrect', 'Because absorption law applies.', 8);
    expect(problem).not.toBeNull();
    expect(problem).toContain('explainCorrect');
  });

  it('中文解析能过', () => {
    expect(
      checkLanguage('explainCorrect', '根据吸收律，A + A·B 中 A 吸收了 A·B 这一项。', 8),
    ).toBeNull();
  });

  it('长文本里汉字占比过低时也被拦（中文夹在一大段英文中）', () => {
    const text = '这是开头' + ' the quick brown fox jumps over the lazy dog again and again';
    expect(checkLanguage('explainWrong', text, 4)).toContain('汉字占比');
  });

  it('短文本不做占比判定（符号多的合法短句占比天然低）', () => {
    // 16 字符 2 汉字 = 0.125，长度 < 30 所以跳过占比判据。
    // 阈值用 2 —— 见 level-assembly.ts 里「为什么题干门槛是 2 不是 5」。
    const text = 'A·B + A·C = A(B+C) 对吗';
    expect(checkLanguage('stem', text, 2)).toBeNull();
  });

  it('把纯公式题干判成「不是中文」是误报，阈值 2 能区分', () => {
    // 这是这条判据最容易出错的边界：一个 2 汉字的合法题干 vs 一句英文。
    expect(checkLanguage('stem', 'A+B 等于什么', 2)).toBeNull();
    expect(checkLanguage('stem', 'What is A plus B', 2)).not.toBeNull();
  });

  it('报错信息里带原文片段，便于直接定位是哪条产出', () => {
    const problem = checkLanguage('stem', 'English only here', 5);
    expect(problem).toContain('English only here');
  });
});
