import {
  Card,
  CardHeader,
  Text,
  Body1,
  Button,
  Spinner,
  makeStyles,
  tokens,
  MessageBar,
  MessageBarBody,
} from '@fluentui/react-components';
import { useNavigate } from 'react-router';
import { useNodeList } from '../api/queries';

const useStyles = makeStyles({
  page: {
    padding: '32px',
    maxWidth: '960px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
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
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: '12px',
  },
  nodeCard: {
    cursor: 'pointer',
  },
});

const STATE_LABEL: Record<string, string> = {
  unseen: '未学习',
  unfamiliar: '刚接触',
  familiar: '已熟悉',
  proficient: '已熟练',
  mastered: '已掌握',
};

/**
 * 看板页。
 *
 * 只做三件事：说清这是什么、给出下一步做什么、列出可进入的知识点。
 * 刻意不堆统计图表 —— spec 里明确「不要为了展示能力而堆仪表盘」。
 */
export function DashboardPage() {
  const styles = useStyles();
  const navigate = useNavigate();
  const nodes = useNodeList();

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <Text className={styles.title} as="h1">
          核电子学学习工作站
        </Text>
        <Body1>
          知识以关卡组织，掌握度由作答证据推断。先从下方任一知识点进入，或打开知识地图看全局。
        </Body1>
      </div>

      {nodes.isPending && <Spinner label="加载知识点…" />}

      {nodes.isError && (
        <MessageBar intent="error">
          <MessageBarBody>
            无法读取知识点：{nodes.error instanceof Error ? nodes.error.message : '未知错误'}
          </MessageBarBody>
        </MessageBar>
      )}

      {nodes.payload && nodes.payload.items.length === 0 && (
        <MessageBar>
          <MessageBarBody>还没有知识点。先运行内容入库流程（票 02）。</MessageBarBody>
        </MessageBar>
      )}

      {nodes.payload && nodes.payload.items.length > 0 && (
        <div className={styles.grid}>
          {nodes.payload.items.map((node) => (
            <Card
              key={node.microKpId}
              className={styles.nodeCard}
              onClick={() => navigate(`/map/${node.microKpId}`)}
            >
              <CardHeader
                header={<Text weight="semibold">{node.name}</Text>}
                description={
                  <Text size={200}>
                    {STATE_LABEL[node.state] ?? node.state}
                    {node.percent === null ? ' · 证据不足' : ` · ${Math.round(node.percent * 100)}%`}
                  </Text>
                }
              />
            </Card>
          ))}
        </div>
      )}

      <div>
        <Button appearance="primary" onClick={() => navigate('/map')}>
          打开知识地图
        </Button>
      </div>
    </div>
  );
}
