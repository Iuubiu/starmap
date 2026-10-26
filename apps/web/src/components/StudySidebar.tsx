/**
 * 学习页右侧栏：本知识点进度 + 实时建议（票 83）。
 *
 * ## 为什么进度只给「三门槛」而不是一个百分比
 *
 * 掌握度是概率，不是进度。`current = 0.62` 对学生没有可操作性：他既不知道
 * 还差多少才够，也不知道下一步做什么。三条门槛是可数、可核对、可行动的：
 *
 * - 作答次数：再答几题才够证据线；
 * - 变式数：只会一种问法不算会（同一道题换个数字不算新证据）；
 * - 连对：最近一次判定里尾部连续答对的题数。
 *
 * 三条的上限都来自 `packages/engine`（`MASTERY_MIN_ATTEMPTS = 8`、
 * `MASTERY_MIN_VARIANTS = 3`、`TIER_PARAMS[*].masteryRule.consecutiveCorrect = 2`）。
 * 前端不 import engine（避免把纯函数包打进浏览器包），所以这里是**镜像常量**，
 * `StudySidebar.test.ts` 有一条断言把它们钉在 8/3/2 上，谁改了引擎那边
 * 又忘了这里，测试会红。
 *
 * ## 「证据不足」不是 0
 *
 * 没有作答记录时，三条门槛的实测值一律是 `null` → 界面显示「证据不足」，
 * 不显示 `0 / 8`。`0 / 8` 是在说「你一题都没答对」，而真相是「我们还不知道」。
 * 这是全仓一贯的约定（`MasteryView.current` 在证据不足时也是 `null`）。
 *
 * ## 建议从哪来（推导规则）
 *
 * 不新增后端接口，全部从已有字段推导：
 *
 * 1. **前置未解锁**：`GET /nodes/:id/unlock` 的 `blockers[]` —— 前置名与关卡名
 *    都在里面，直接可渲染。
 * 2. **阈值差**：`GET /mastery/:id` 的 `attemptCount` / `variantCount` 与上面的
 *    门槛常量相减。
 * 3. **复验到期**：`mastery.state === 'mastered'` → 提醒去做一次复验。
 * 4. **上次追问**：调用方把「最近一条追问卡的问题」传进来（`lastProbe`）。
 *    逐题错因（`misconceptionTags`）目前只在关卡页的内存流程里，没有按知识点
 *    读出来的接口 —— 这一条是**已知缺口**，所以用「上一轮追问」代替，而不是
 *    编一个不存在的错因。
 *
 * 最多 3 条。每条都是按钮：**点一下只把话填进输入框，不发送** —— 建议是
 * 学生的方向，不该替他按下去。
 */
import { Button, Caption1, Card, Text } from '@fluentui/react-components';
import type { ReactNode } from 'react';
import type { GateHistoryResponse, MasteryView, UnlockState } from '../api/queries';
import type { KpProgressView } from '@starmap/api-contract';
import { TierCard } from './TierCard';

/** `packages/engine/src/mastery.ts` 的 `MASTERY_MIN_ATTEMPTS`。 */
export const ATTEMPT_TARGET = 8;
/** `packages/engine/src/mastery.ts` 的 `MASTERY_MIN_VARIANTS`。 */
export const VARIANT_TARGET = 3;
/** `packages/engine/src/tier.ts` 的 `TIER_PARAMS[*].masteryRule.consecutiveCorrect`。 */
export const STREAK_TARGET = 2;

export type SuggestionSource = 'prereq' | 'threshold' | 'review' | 'probe';

export interface Suggestion {
  /** 稳定 key：同一条建议重渲时不换 DOM 节点 */
  id: string;
  source: SuggestionSource;
  /** 点一下填进输入框的整句 */
  text: string;
}

export interface StudySidebarProps {
  /** 当前知识点名字；null = 还没选知识点 */
  microKpName: string | null;
  mastery?: MasteryView | undefined;
  unlock?: UnlockState | undefined;
  /** 这个知识点的关卡最近一次门控判定（用来算「连对」） */
  gateHistory?: GateHistoryResponse | undefined;
  /** 最近一条追问卡的问题。没有就不出这条建议 */
  lastProbe?: string | undefined;
  /**
   * 票 89：本关门槛进度（`GET /api/v1/mastery/kp/:id`）。给了它就用接口的
   * 值 / 阈值 / 比例，`mastery` 只作为旧路径的回退。
   */
  progress?: KpProgressView | undefined;
  /** 建议被点击：只填进输入框，不发送 */
  onAsk: (text: string) => void;
  /** 掌握度请求还在路上 */
  pending?: boolean;
}

/**
 * 最近一次门控判定里，尾部连续答对的题数。
 *
 * 判定记录只给「这次用了哪几题」（`itemIds`，按题干顺序）与「其中答错哪些」
 * （`wrongItemIds`），两者相减就是逐题对错序列 —— 不需要新接口。
 *
 * 没有判定记录时返回 `null`（证据不足），不是 0。
 */
export function trailingCorrect(history: GateHistoryResponse | undefined | null): number | null {
  const evaluations = history?.evaluations;
  if (!evaluations || evaluations.length === 0) return null;
  // 按判定时刻取最新的一条；同一时刻按数组顺序取最后一条。
  let latest = evaluations[0]!;
  for (const evaluation of evaluations) {
    if (evaluation.evaluatedAt >= latest.evaluatedAt) latest = evaluation;
  }
  if (latest.itemIds.length === 0) return null;
  const wrong = new Set(latest.wrongItemIds);
  let streak = 0;
  for (let index = latest.itemIds.length - 1; index >= 0; index -= 1) {
    if (wrong.has(latest.itemIds[index]!)) break;
    streak += 1;
  }
  return streak;
}

/**
 * 三条建议（按优先级取前 3）。
 *
 * 优先级：前置挡路 > 阈值差 > 复验到期 > 上一轮追问。理由很实际 ——
 * 前置没解开时，练这个知识点本身是白练；阈值差是「马上能做」的事；
 * 复验与追问是提醒。
 */
export function buildSuggestions(input: {
  mastery?: MasteryView | undefined;
  unlock?: UnlockState | undefined;
  lastProbe?: string | undefined;
}): Suggestion[] {
  const { mastery, unlock, lastProbe } = input;
  const suggestions: Suggestion[] = [];

  const blocker = unlock?.unlocked === false ? unlock.blockers[0] : undefined;
  if (blocker) {
    const level = blocker.levelTitle ? `《${blocker.levelTitle}》` : '它的关卡';
    suggestions.push({
      id: `prereq-${blocker.prerequisiteId}`,
      source: 'prereq',
      text: `先学「${blocker.prerequisiteName}」——${level}的出口测试还挡在这里，过了它我再来带这个知识点。`,
    });
  }

  if (mastery && !mastery.evidenceSufficient) {
    if (mastery.attemptCount < ATTEMPT_TARGET) {
      const shortfall = ATTEMPT_TARGET - mastery.attemptCount;
      suggestions.push({
        id: 'threshold-attempts',
        source: 'threshold',
        text: `这个知识点还差 ${shortfall} 道题到证据线（现在 ${mastery.attemptCount}/${ATTEMPT_TARGET}），先多做几题，我再判断你掌握到哪了。`,
      });
    } else if (mastery.variantCount < VARIANT_TARGET) {
      const shortfall = VARIANT_TARGET - mastery.variantCount;
      suggestions.push({
        id: 'threshold-variants',
        source: 'threshold',
        text: `同一类题你已经做得不错了，但还差 ${shortfall} 种变式（现在 ${mastery.variantCount}/${VARIANT_TARGET}）——换个问法再来一次，我才能确认不是记住了答案。`,
      });
    }
  }

  if (mastery?.state === 'mastered') {
    suggestions.push({
      id: 'review-due',
      source: 'review',
      text: '这个知识点已经到掌握线了，去「复验」里做一轮，把它往后推一档，别等衰减了再补。',
    });
  }

  if (lastProbe) {
    suggestions.push({
      id: 'probe-last',
      source: 'probe',
      text: `上一轮我追问的是「${lastProbe}」——先把这一问答掉，我们再往下走。`,
    });
  }

  return suggestions.slice(0, 3);
}

interface ProgressRow {
  label: string;
  /** `null` = 证据不足，显示「—」而不是 0 */
  value: number | null;
  target: number;
  /** 票 89：服务端算好的比例（0–1）。缺失时按 value/target 兜底 */
  ratio?: number;
  reached?: boolean;
  /** 本关真实累计（可能远大于 target），只用于悬浮说明 */
  cumulative?: number;
  unit?: string;
}

/** 三门槛的实测值。`mastery` 缺失 → 三条都是 `null`。 */
/**
 * 票 89：本知识点进度直接读服务端算好的数字。
 *
 * 三个数字（值 / 阈值 / 比例）全部来自 `GET /api/v1/mastery/kp/:id`：
 * 前端不再持有 8 / 3 / 2，也不再做除法 —— 阈值随档位变，硬编码在那天会静默错。
 */
export function progressRowsFromView(progress: KpProgressView | undefined): ProgressRow[] {
  if (!progress) return progressRows(undefined, null);
  return progress.gates.map((gate) => ({
    label: gate.label,
    value: gate.value,
    target: gate.target,
    ratio: gate.ratio,
    reached: gate.reached,
    cumulative: gate.cumulative,
    unit: gate.unit,
  }));
}

export function progressRows(
  mastery: MasteryView | undefined,
  streak: number | null,
): ProgressRow[] {
  const enough = mastery !== undefined && (mastery.evidenceSufficient || mastery.attemptCount > 0);
  return [
    { label: '作答', value: enough ? mastery.attemptCount : null, target: ATTEMPT_TARGET },
    { label: '变式', value: enough ? mastery.variantCount : null, target: VARIANT_TARGET },
    { label: '连对', value: enough ? streak : null, target: STREAK_TARGET },
  ];
}

function Row({ row, gatePassed = false }: { row: ProgressRow; gatePassed?: boolean }) {
  const ratio =
    row.value === null
      ? 0
      : (row.ratio ?? Math.max(0, Math.min(1, row.value / Math.max(1, row.target))));
  /*
   * 达标 = 这一条门槛真的到线了（`value >= target`）。
   *
   * 颜色只表达这一个事实：未到线是中性灰（`.sm-study-fill` 的默认色），
   * 到线才换成 `success`。**不用 accent** —— 本仓 accent 是红色，红色在这
   * 里的含义是告警/答错，拿来画进度会让学生以为自己在出错（见 glass.css）。
   */
  const reached = row.reached ?? (row.value !== null && row.value >= row.target);
  /*
   * 票 89：绿色只留给「本关判定已达标」。这条门槛自己的数字到线不算 ——
   * 数字是累计口径，判定是另一件事，混在一起会让人以为「做够了 8 题就过关了」。
   */
  const tone = gatePassed ? 'success' : 'neutral';
  return (
    <div
      className="sm-study-row"
      data-study-row={row.label}
      data-reached={reached ? 'true' : 'false'}
      data-tone={tone}
    >
      <span className="sm-study-row-label">{row.label}</span>
      <span className="sm-study-track" aria-hidden>
        <span className="sm-study-fill" style={{ width: `${ratio * 100}%` }} />
      </span>
      <span
        className="sm-study-row-value"
        title={
          row.value === null
            ? undefined
            : row.cumulative !== undefined && row.cumulative > row.target
              ? `本关累计 ${row.cumulative} ${row.unit ?? ''}，已到线（阈值 ${row.target}）`
              : `本关 ${row.value} ${row.unit ?? ''}，阈值 ${row.target}`
        }
      >
        {row.value === null ? '证据不足' : `${row.value} / ${row.target}`}
      </span>
    </div>
  );
}

export function StudySidebar({
  microKpName,
  mastery,
  unlock,
  gateHistory,
  lastProbe,
  progress,
  onAsk,
  pending = false,
}: StudySidebarProps) {
  const streak = trailingCorrect(gateHistory);
  // 票 89：有服务端的本关进度就用它（数字/阈值/比例都是接口算的），否则退回旧路径
  const rows = progress ? progressRowsFromView(progress) : progressRows(mastery, streak);
  const suggestions = buildSuggestions({ mastery, unlock, lastProbe });
  const evidenceEnough = mastery?.evidenceSufficient === true;

  return (
    <div className="sm-study-sidebar" data-study-sidebar>
      {/*
       * 票 02：档位卡自取数（useTierOverview），页面不用传参。放在进度卡之前，
       * 与 mockup（composer-b4.html 右栏）的「当前档位 → 门槛进度」顺序一致。
       */}
      <TierCard />
      <Card className="sm-glass sm-study-card" data-study-progress>
        <Text weight="semibold" as="h3">
          本知识点进度
        </Text>
        {/*
         * 知识点名字**不在这里再写一遍**：输入框上方那行上下文徽标已经写着它，
         * 同一句话在 300px 宽的栏里出现两次既挤又吵（也让「按文字查唯一元素」
         * 的既有测试变成多匹配）。这里只在没选知识点时给一句怎么办。
         */}
        {microKpName === null && (
          <Caption1 className="sm-study-kp">还没选知识点：先在下面说一句你想学什么</Caption1>
        )}

        {/*
         * 没选知识点时**不摆三条空行**：`null / 8` 会让一栏 300px 的侧栏看起来
         * 像「你已经 0 分」，而事实是还没有对象可算。只留一句怎么办。
         */}
        {microKpName !== null &&
          (pending ? (
            <Caption1>正在读掌握度…</Caption1>
          ) : (
            <>
              <div className="sm-study-rows">
                {rows.map((row) => (
                  <Row key={row.label} row={row} gatePassed={progress?.gatePassed ?? false} />
                ))}
              </div>
              <Caption1 className="sm-study-note">
                {mastery === undefined
                  ? '证据不足：这个知识点还没有作答记录，三条门槛都不显示数字。'
                  : evidenceEnough
                    ? '证据够了：这三条已经能支撑判定，再练就是在加固。'
                    : '证据还不够：三条门槛的结论都只是暂时的，别把它当成绩。'}
              </Caption1>
            </>
          ))}
      </Card>

      <Card className="sm-glass sm-study-card" data-study-suggestions>
        <Text weight="semibold" as="h3">
          实时建议
        </Text>
        {suggestions.length === 0 ? (
          <Caption1 className="sm-study-note">
            暂时没有更强的建议：按你现在的进度，继续往下学就行。
          </Caption1>
        ) : (
          <>
            <div className="sm-study-suggestions">
              {suggestions.map((suggestion) => (
                <button
                  type="button"
                  key={suggestion.id}
                  className="sm-study-suggestion"
                  data-suggestion-source={suggestion.source}
                  onClick={() => onAsk(suggestion.text)}
                >
                  {suggestion.text}
                </button>
              ))}
            </div>
            <Caption1 className="sm-study-note">点一条只会填进输入框，不会替你发出去。</Caption1>
          </>
        )}
      </Card>
    </div>
  );
}

/** 给页面用的轻量包装：没有知识点时也能占位，不闪。 */
export function StudySidebarPlaceholder({ children }: { children?: ReactNode }) {
  return (
    <Card className="sm-glass sm-study-card">
      <Text weight="semibold" as="h3">
        本知识点进度
      </Text>
      <Caption1 className="sm-study-note">{children ?? '正在读取…'}</Caption1>
    </Card>
  );
}

/** 供测试与探针复用的按钮名。 */
export const SUGGESTION_HINT = '点一条只会填进输入框';
