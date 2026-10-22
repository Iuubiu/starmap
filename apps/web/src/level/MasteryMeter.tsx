/**
 * 双字段掌握度显示（票 05 验收 5）。
 *
 * 两个数字各管一件事，不是同一个数的两种说法：
 *
 * - `achieved`：历次作答里 BKT 后验达到过的**最高值**，永不衰减，管解锁与成长记录。
 * - `current`：同一个后验按半衰期（事实 14 天／概念 30 天／综合 45 天）衰减后的值，
 *   管推荐与检索门控。
 *
 * 所以只显示一个数一定会在某处骗人：只显示 `current`，「上个月学会了、这周还没复习」
 * 看起来像没学过；只显示 `achieved`，「曾经会」会被当成「现在会」，推荐的难度就会跳空。
 *
 * ## 证据不足时为什么不显示 0%
 *
 * `0%` 的含义是「做了题而且全错」。两次作答换来的数字跟它是两回事，学习者看到 0%
 * 会得出「我完全不会」的结论 —— 那是一句系统没资格说的话。接口层已经把
 * `achieved`/`current` 都发成 `null`（不是 0），这里再把「还差多少」讲清楚，
 * 让人知道下一步该做什么，而不是盯着一个假的零。
 */
import { Badge, Text, makeStyles, tokens } from '@fluentui/react-components';
import type { MasteryView } from '../api/queries';
import { masteryLabel } from '../mastery/labels';

/**
 * 与 `packages/engine/src/mastery.ts` 的 `MASTERY_MIN_ATTEMPTS` / `MASTERY_MIN_VARIANTS`
 * 同一个门槛。
 *
 * 前端不 import engine（那是纯领域内核，浏览器侧只该拿到契约生成的类型），
 * 所以这两个数在这里重述一遍；`MasteryMeter.test.tsx` 有一条用例锁住它们，
 * 改动时两边会同时红。
 */
export const MIN_ATTEMPTS = 8;
export const MIN_VARIANTS = 3;

const useStyles = makeStyles({
  block: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  meters: {
    display: 'flex',
    gap: '32px',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },
  meter: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  meterLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: 'nowrap',
  },
  value: {
    fontSize: tokens.fontSizeHero800,
    fontWeight: tokens.fontWeightSemibold,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: tokens.lineHeightHero800,
  },
  stage: {
    fontSize: tokens.fontSizeHero800,
    lineHeight: tokens.lineHeightHero800,
    fontWeight: tokens.fontWeightSemibold,
  },
  hint: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase300,
  },
  pending: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

/**
 * 状态词表已移到 `../mastery/labels`（前端唯一一份，类型是
 * `Record<MasteryState, string>`）。这里原来那份多写了一个 `unfamiliar` 死键 ——
 * 契约五态里没有它，后端从不发这个值，留着只会让下一个人以为它是有效的第六态。
 */

function percent(value: number | null): string {
  return value === null ? '证据不足' : `${Math.round(value * 100)}%`;
}

export interface MasteryMeterProps {
  /** `undefined` = 还没取到（接口未回）；`null` 也按「还没有」处理。 */
  view: MasteryView | null | undefined;
}

export function MasteryMeter({ view }: MasteryMeterProps) {
  const styles = useStyles();

  if (!view) {
    return <Text className={styles.pending}>掌握度还没算出来：正在读这个知识点的作答证据…</Text>;
  }

  if (!view.evidenceSufficient) {
    const missingAttempts = Math.max(0, MIN_ATTEMPTS - view.attemptCount);
    const missingVariants = Math.max(0, MIN_VARIANTS - view.variantCount);
    const shortfall = [
      missingAttempts > 0 ? `再 ${missingAttempts} 次作答` : '',
      missingVariants > 0 ? `再 ${missingVariants} 个不同变式` : '',
    ]
      .filter((part) => part !== '')
      .join('、');

    return (
      <div className={styles.block}>
        <div className={styles.meters}>
          <div className={styles.meter}>
            <span className={styles.meterLabel}>掌握度</span>
            <span className={styles.value}>证据不足</span>
          </div>
          <div className={styles.meter}>
            <span className={styles.meterLabel}>当前状态</span>
            <Badge appearance="outline" style={{ whiteSpace: 'nowrap' }}>
              {masteryLabel(view.state)}
            </Badge>
          </div>
        </div>
        <Text className={styles.hint}>
          已作答 {view.attemptCount} 次、覆盖 {view.variantCount} 个不同变式。
          {shortfall === '' ? '' : `还差${shortfall}。`}
          样本这么少时算出的百分比只会误导你，所以这里先不给数字 —— 它不是 0%，是还不知道。
        </Text>
      </div>
    );
  }

  return (
    <div className={styles.block}>
      <div className={styles.meters}>
        <div className={styles.meter}>
          <span className={styles.meterLabel}>历史最高（不回落，用于解锁）</span>
          <span className={styles.value}>{percent(view.achieved)}</span>
        </div>
        <div className={styles.meter}>
          <span className={styles.meterLabel}>当前熟练度（会随时间回落，用于推荐）</span>
          <span className={styles.value}>{percent(view.current)}</span>
        </div>
        <div className={styles.meter}>
          <span className={styles.meterLabel}>状态</span>
          <span className={styles.stage}>{masteryLabel(view.state)}</span>
        </div>
      </div>
      <Text className={styles.hint}>
        {view.attemptCount} 次作答 · {view.variantCount} 个不同变式（平行题同组只算一个） · 半衰期{' '}
        {view.halfLifeDays} 天
        {view.isLeaf
          ? ''
          : ` · 这是 ${view.aggregatedLeafCount} 个叶子知识点按证据量加权聚合出来的只读值，库里不存它`}
      </Text>
    </div>
  );
}
