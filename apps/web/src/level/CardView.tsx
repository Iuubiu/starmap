/**
 * 内容卡 —— 关卡的讲解单元。
 *
 * 票 04 验收 5 说「卡片内容量不低于规格，不是一句话卡片」。这件事在数据侧
 * 由校验器把关（`packages/shared/src/domain/level.ts` 的 40 字符下限），
 * 在展示侧由这里把关：**正文按段落完整排出来、公式单独成行、图引用给出可读
 * 的出处**，而不是把整段塞进一个 `<Text>` 里让它自己折行。
 *
 * 图引用（`figureRef`）这里**不渲染真实图片**：图片资产由内容侧（票 03）
 * 落在 `content/`，前端还没有取图接口。现在显示的是可点击跳转到内容库的
 * 引用标识，并明确写出「图待接入」——比放一个永远转圈的占位图诚实。
 *
 * ## 三种呈现方式（票 12）
 *
 * `full`（默认）：完整展开，票 04 原来就这一种。
 * `faded`：forward fading —— 正文收起、只留标题，可展开。语义是「最后一步
 * 留给你补」，所以是**默认折叠而不是不渲染**：学习者需要时能自己打开，
 * 否则一道只在正文里定义过的式子会让 P2 卡死。
 * `collapsed`：P3 的「讲解默认收起」同理，两者视觉相同但语义不同（一个是
 * 「你该自己推最后一步」，一个是「你不需要先看」），所以文案分开写。
 *
 * 折叠用 `<details>` 而不是条件渲染：正文仍挂在 DOM 里，于是「页面上能不能
 * 找到这段讲解」与「默认看不看见」是两件可以分别断言的事（测试里靠 `open`）。
 */
import { Card, CardHeader, Badge, Text, makeStyles, tokens } from '@fluentui/react-components';
import type { LevelSpecCardsItem } from '../api/generated/model';
import { RichText } from './markdown';
import type { CardPresentation } from './tier-render';

const useStyles = makeStyles({
  card: {
    padding: '20px 22px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  header: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    flexWrap: 'wrap',
  },
  title: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightBase500,
  },
  body: {
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase400,
    color: tokens.colorNeutralForeground1,
  },
  figure: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    borderLeft: `3px solid ${tokens.colorBrandStroke2}`,
    background: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusSmall,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  figureRef: {
    fontFamily: tokens.fontFamilyMonospace,
    wordBreak: 'break-all',
  },
  /** 折叠态的展开入口。做成链接样式而不是按钮：它不是主操作，不应抢视觉重量。 */
  toggle: {
    cursor: 'pointer',
    color: tokens.colorBrandForegroundLink,
    fontSize: tokens.fontSizeBase200,
    listStyle: 'none',
    width: 'fit-content',
  },
  toggleHint: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
});

export function CardView({
  card,
  presentation = 'full',
}: {
  card: LevelSpecCardsItem;
  /** 呈现方式（票 12）。默认 `full`，与票 04 逐字一致。 */
  presentation?: CardPresentation;
}) {
  const styles = useStyles();
  const folded = presentation !== 'full';
  const foldLabel =
    presentation === 'faded' ? '这一步留给你补：点开看讲解' : '点开看这一段讲解';

  return (
    <Card className={styles.card} appearance="outline">
      <CardHeader
        header={
          <div className={styles.header}>
            <Text className={styles.title}>{card.title}</Text>
            <Badge appearance="tint" size="small" style={{ whiteSpace: 'nowrap' }}>
              讲解
            </Badge>
            {presentation === 'faded' && (
              <Badge appearance="outline" size="small" style={{ whiteSpace: 'nowrap' }}>
                正文已收起
              </Badge>
            )}
          </div>
        }
      />
      {folded ? (
        /**
         * `details` 默认关着，但正文仍在 DOM 里。两个理由：
         * ① 学习者需要时能自己展开（faded 的语义是「先自己想」不是「不给你看」）。
         * ② 测试能分别断言「这段讲解存在」与「它默认不展开」，而不是把「不存在」
         *    与「被藏起来」当成同一件事。
         */
        <details>
          <summary className={styles.toggle}>{foldLabel}</summary>
          <div className={styles.body} style={{ marginTop: 10 }}>
            <RichText body={card.body} />
          </div>
        </details>
      ) : (
        <div className={styles.body}>
          <RichText body={card.body} />
        </div>
      )}
      {!folded && card.figureRef !== null && (
        <div className={styles.figure}>
          <span aria-hidden>▤</span>
          <Text size={200}>配图引用（内容库资产，图形视图待接入）：</Text>
          <span className={styles.figureRef}>{card.figureRef}</span>
        </div>
      )}
      {folded && (
        <Text className={styles.toggleHint}>
          {presentation === 'faded'
            ? '先自己把这一步推完，再点开对一下。'
            : '这一档直接从题目开始；需要时再展开讲解。'}
        </Text>
      )}
    </Card>
  );
}
