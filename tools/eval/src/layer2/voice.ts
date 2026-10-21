/**
 * person 的「说话方式」：把 persona JSON 的静态描述转成每一轮的具体台词。
 *
 * ## 为什么不是让 LLM 自由生成
 *
 * 这一版需要**可复现**：同一份代码、同一套内容，跑两次要得到同样的话。
 * 台词由 persona 的 `language.examples`、`behaviorParams` 与
 * `distinctiveness` 三项决定，是确定性的。LLM 扮演学生会引入第二层方差，
 * 而票 20 当前要回答的是「界面有没有点不动的地方」——那不需要模型随机性。
 *
 * 三档之间的差异必须**肉眼可见**：P1 短句无术语、P2 带术语问机制、P3 直接
 * 提工程场景。这与 `checkDistinctiveness` 的三项指标一致。
 */

import type { Persona } from '../personas/schema.ts';
import type { PersonaVoice } from './stages.ts';

/**
 * 把 persona 配置转成台词。
 *
 * 台词不用 persona 里 `language.examples` 的原句 —— 那些是「说话风格」的
 * 示例，直接拿来当输入会让三档看起来像在背同一份稿子。这里按 tier 分派
 * 具体台词，同时**保留 persona 的语域**（P1 口语短句、P2 学术、P3 工程）。
 */
export function voiceOf(persona: Persona): PersonaVoice {
  const tier = persona.tier;
  const base = {
    id: persona.id,
    tier,
    displayName: persona.displayName,
  };

  if (tier === 'P1') {
    return {
      ...base,
      // 15 字以内、照抄一个术语、句末常不加标点 —— 与 p1-novice.json 的
      // `language.inputLengthChars.typical = 12` 一致。
      firstUtterance: '这个能量分辨率是啥意思',
      wrongAnswerRemark: '我以为数字大就是好',
      demandAnswer: '我真不会 你直接告诉我吧',
      probeReply: '没懂，能不能说人话',
    };
  }

  if (tier === 'P2') {
    return {
      ...base,
      // 更长、带术语、问的是机制而不是定义 —— 与 p2-grad.json 的
      // `terminologyDensity = 0.35` 一致。
      firstUtterance: '能量分辨率和 FWHM 是什么关系？为什么用百分比表示而不是绝对值？',
      wrongAnswerRemark: '我按半高宽取整算了，是不是应该用峰位做归一化？',
      demandAnswer: '我还是推不出来，能不能把完整推导给我看一下',
      probeReply: '这个推导的前提我不太确定，能不能再解释一下',
    };
  }

  return {
    ...base,
    // 现场工程师：直接给应用场景与约束，不问题目本身。
    firstUtterance: '现场用 NaI 探测器做能谱分析，分辨率不够时应该先调哪一级？',
    wrongAnswerRemark: '我记得现场老师傅说数字越大越好，是不是我记错了',
    demandAnswer: '别讲原理了，直接说参数怎么设',
    probeReply: '具体到我这台设备上该调什么',
  };
}
