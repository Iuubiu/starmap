import {
  Text,
  Body1,
  Spinner,
  makeStyles,
  tokens,
  MessageBar,
  MessageBarBody,
  Card,
  CardHeader,
  Badge,
  Button,
  Divider,
} from '@fluentui/react-components';
import { useNavigate, useParams } from 'react-router';
import { useNodeDetail } from '../api/queries';

const useStyles = makeStyles({
  page: {
    padding: '32px',
    maxWidth: '860px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
  },
  heading: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  title: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightHero700,
  },
  masteryRow: {
    display: 'flex',
    gap: '32px',
    alignItems: 'baseline',
  },
  meterBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  meterLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  meterValue: {
    fontSize: tokens.fontSizeHero800,
    fontWeight: tokens.fontWeightSemibold,
    fontVariantNumeric: 'tabular-nums',
  },
  reasons: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  levelList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  /**
   * Fluent 的 Badge 会按容器宽度折行，中文在窄容器里会变成一列竖排字。
   * 关卡类型是短标签，不该换行 —— 这个 bug 是截图才看出来的，单测抓不到。
   */
  kindBadge: {
    whiteSpace: 'nowrap',
  },
});

const STATE_LABEL: Record<string, string> = {
  unseen: '未学习',
  unfamiliar: '刚接触',
  familiar: '已熟悉',
  proficient: '已熟练',
  mastered: '已掌握',
};

const KIND_LABEL: Record<string, string> = {
  teach: '教学关卡',
  quiz: '题目关卡',
  review: '复验关卡',
};

/**
 * 知识点详情页。
 *
 * 掌握度显示**两个**数字而不是一个（D2）：`achieved` 不衰减、用于解锁，
 * `current` 会衰减、用于推荐。用户看到的是 `current`，因为它更接近
 * 「现在还能不能做对」；但门控判定用 `achieved`，所以两个都要能看见。
 *
 * 证据不足时显示「证据不足」而不是 0% —— 0% 是「做了且全错」，
 * 两者对学习者的含义完全不同。
 */
export function NodeDetailPage() {
  const styles = useStyles();
  const { microKpId } = useParams<{ microKpId: string }>();
  const navigate = useNavigate();
  const node = useNodeDetail(microKpId);

  if (node.isPending) return <div className={styles.page}><Spinner label="加载知识点…" /></div>;

  if (node.isError || !node.payload) {
    return (
      <div className={styles.page}>
        <MessageBar intent="error">
          <MessageBarBody>
            无法读取该知识点：{node.error instanceof Error ? node.error.message : '未知错误'}
          </MessageBarBody>
        </MessageBar>
        <div>
          <Button onClick={() => navigate('/map')}>返回地图</Button>
        </div>
      </div>
    );
  }

  const { node: kp, levels, reasons } = node.payload;

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <Text className={styles.title} as="h1">
          {kp.name}
        </Text>
        <Body1>
          层级深度 {kp.depth} · 当前状态 {STATE_LABEL[kp.state] ?? kp.state}
        </Body1>
      </div>

      <Card>
        <CardHeader header={<Text weight="semibold">掌握度</Text>} />
        <div className={styles.masteryRow}>
          <div className={styles.meterBlock}>
            <span className={styles.meterLabel}>当前熟练度（会随时间回落，用于推荐）</span>
            <span className={styles.meterValue}>
              {kp.percent === null ? '证据不足' : `${Math.round(kp.percent * 100)}%`}
            </span>
          </div>
        </div>
      </Card>

      {reasons.length > 0 && (
        <Card>
          <CardHeader header={<Text weight="semibold">为什么推荐这个知识点</Text>} />
          <div className={styles.reasons}>
            {reasons.map((reason, i) => (
              <Body1 key={i}>· {reason}</Body1>
            ))}
          </div>
        </Card>
      )}

      <Divider />
      <Text weight="semibold">可用关卡</Text>

      {levels.length === 0 ? (
        <MessageBar>
          <MessageBarBody>这个知识点还没有关卡。运行内容入库（票 02）后会生成。</MessageBarBody>
        </MessageBar>
      ) : (
        <div className={styles.levelList}>
          {levels.map((level) => (
            <Card key={level.levelId}>
              <CardHeader
                header={<Text weight="semibold">{level.title}</Text>}
                description={
                  <Body1>
                    {KIND_LABEL[level.kind] ?? level.kind} · {level.itemCount} 道题
                  </Body1>
                }
                action={
                  <Badge appearance="outline" className={styles.kindBadge}>
                    {KIND_LABEL[level.kind] ?? level.kind}
                  </Badge>
                }
              />
            </Card>
          ))}
        </div>
      )}

      <div>
        <Button onClick={() => navigate('/map')}>返回地图</Button>
      </div>
    </div>
  );
}
