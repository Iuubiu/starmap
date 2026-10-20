/**
 * 门控档位的唯一措辞来源。
 *
 * ## 为什么单独一个文件
 *
 * 三个页面（首页的依据面板、数据库页的检索调试器、未来的关卡播放器）都要
 * 说清「`background`/`scaffold`/`full` 是什么意思」。各处自己写一遍，早晚会
 * 出现「背景档」和「背景层」两种叫法 —— 而学生要在两处对照同一个数字。
 *
 * ## 为什么文案里带阈值
 *
 * 光写「脚手架档」没人知道为什么自己被划到那一档。把 `0.4 / 0.7` 写在
 * 标签里，学生看到 `current = 0.66` 时能自己推出档位，不需要去翻文档。
 */

/** 档位 → 中文标签（含触发阈值）。 */
export const GATE_TIER_LABEL: Record<string, string> = {
  background: '背景档（掌握度 < 0.4）',
  scaffold: '脚手架档（0.4 – 0.7）',
  full: '全量档（> 0.7）',
};

/** 简短版，用于徽章等窄空间。 */
export const GATE_TIER_SHORT: Record<string, string> = {
  background: '背景档',
  scaffold: '脚手架档',
  full: '全量档',
};

/**
 * 按 current 推档位 —— **只用于界面上「你现在的掌握度落在哪一档」的提示**。
 *
 * 真正的门控判定在服务端（`packages/engine/src/retrieval-gate.ts`）。这里
 * 重算一遍是为了在调试器里画那条「0.4 / 0.7 分界线」上的游标；若哪天阈值
 * 改了而这里没改，界面会显示矛盾 —— 所以调试器里**显示用服务端返回的
 * `gateTier`，这个函数只用来摆放刻度**。
 */
export function tierForDisplay(current: number | null): 'background' | 'scaffold' | 'full' {
  if (current === null) return 'background';
  if (current < 0.4) return 'background';
  if (current < 0.7) return 'scaffold';
  return 'full';
}
