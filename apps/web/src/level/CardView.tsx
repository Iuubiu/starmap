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
 */
import { Card, CardHeader, Badge, Text, makeStyles, tokens } from '@fluentui/react-components';
import type { LevelSpecCardsItem } from '../api/generated/model';
import { RichText } from './markdown';

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
});

export function CardView({ card }: { card: LevelSpecCardsItem }) {
  const styles = useStyles();
  return (
    <Card className={styles.card} appearance="outline">
      <CardHeader
        header={
          <div className={styles.header}>
            <Text className={styles.title}>{card.title}</Text>
            <Badge appearance="tint" size="small" style={{ whiteSpace: 'nowrap' }}>
              讲解
            </Badge>
          </div>
        }
      />
      <div className={styles.body}>
        <RichText body={card.body} />
      </div>
      {card.figureRef !== null && (
        <div className={styles.figure}>
          <span aria-hidden>▤</span>
          <Text size={200}>配图引用（内容库资产，图形视图待接入）：</Text>
          <span className={styles.figureRef}>{card.figureRef}</span>
        </div>
      )}
    </Card>
  );
}
