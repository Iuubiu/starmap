/**
 * 七段进度条。
 *
 * 进度条只做一件事：让学习者随时知道「我在第几段、还有几段」。因此每一段
 * 都显示名字而不是圆点 —— 圆点进度条在七段的长度上只能表达「快完了」，
 * 表达不了「下一步是什么」，而后者才是学习者需要的。
 *
 * 被跳过的段落（简单问题达标时跳过的深究与进一步讲解）显示成划线的灰色，
 * 而不是干脆不显示：**必须让学习者看见「你因为答对了，所以不用走这两段」**。
 * 若藏起来，他会以为这关本来就这么短，下次答错时突然多出两段会觉得系统在罚他。
 */
import { makeStyles, tokens, Tooltip } from '@fluentui/react-components';
import type { StepProgressEntry } from './flow';
import { STEP_KIND_LABEL } from './flow';

const useStyles = makeStyles({
  rail: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    alignItems: 'center',
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: tokens.borderRadiusCircular,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: 'nowrap',
  },
  /** 已完成：实心浅底 + 对勾，读起来是「这段过去了」。 */
  done: {
    background: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2,
  },
  /** 当前段：品牌色描边加粗，是整条进度条上唯一带强调的。 */
  current: {
    background: tokens.colorBrandBackground2,
    border: `1px solid ${tokens.colorBrandStroke1}`,
    color: tokens.colorBrandForeground2,
    fontWeight: tokens.fontWeightSemibold,
  },
  upcoming: {
    background: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground4,
  },
  /** 跳过：划线灰底。刻意与 upcoming 区分——一个是「走过了」一个是「跳过了」。 */
  skipped: {
    background: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForegroundDisabled,
    textDecoration: 'line-through',
  },
  index: {
    fontVariantNumeric: 'tabular-nums',
    opacity: 0.7,
  },
});

const STATUS_LABEL = {
  done: '已完成',
  current: '进行中',
  upcoming: '未开始',
  skipped: '已跳过',
} as const;

export function StepRail({ progress }: { progress: StepProgressEntry[] }) {
  const styles = useStyles();
  return (
    <div className={styles.rail} role="list" aria-label="关卡进度">
      {progress.map((entry) => (
        <Tooltip
          key={entry.step.id}
          content={`${STEP_KIND_LABEL[entry.step.kind]}：${STATUS_LABEL[entry.status]}`}
          relationship="label"
        >
          <span
            role="listitem"
            className={`${styles.chip} ${styles[entry.status]}`}
            aria-current={entry.status === 'current' ? 'step' : undefined}
            data-status={entry.status}
          >
            <span className={styles.index}>{entry.index + 1}</span>
            {STEP_KIND_LABEL[entry.step.kind]}
            {entry.status === 'done' && <span aria-hidden>✓</span>}
            {entry.status === 'skipped' && <span aria-hidden>⤼</span>}
          </span>
        </Tooltip>
      ))}
    </div>
  );
}
