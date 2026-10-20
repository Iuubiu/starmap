import {
  Text,
  Body1,
  Spinner,
  makeStyles,
  tokens,
  MessageBar,
  MessageBarBody,
  Badge,
  Divider,
} from '@fluentui/react-components';
import { useNavigate } from 'react-router';
import { useNodeList } from '../api/queries';

const useStyles = makeStyles({
  page: {
    padding: '32px',
    maxWidth: '1100px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
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
  /**
   * 深色画布 + 浅色工作台的对比是 spec 定的视觉语言：知识图谱是「深色画布」，
   * 学习内容是「浅色学术工作台」。这里先用 DOM 网格占位，票 03 换成
   * graphology + sigma 的 WebGL 渲染。
   */
  canvas: {
    backgroundColor: '#12161C',
    borderRadius: tokens.borderRadiusLarge,
    padding: '24px',
    minHeight: '420px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '16px',
    alignContent: 'start',
  },
  node: {
    backgroundColor: '#1E242D',
    border: '1px solid #2E3644',
    borderRadius: tokens.borderRadiusMedium,
    padding: '14px 16px',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    ':hover': {
      border: '1px solid #4C8DFF',
    },
  },
  nodeName: {
    color: '#E8ECF2',
    fontWeight: tokens.fontWeightSemibold,
  },
  stateRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  stateText: {
    color: '#8FA0B8',
    fontSize: tokens.fontSizeBase200,
  },
});

const STATE_LABEL: Record<string, string> = {
  unseen: '未学习',
  unfamiliar: '刚接触',
  familiar: '已熟悉',
  proficient: '已熟练',
  mastered: '已掌握',
};

const STATE_COLOR: Record<string, 'subtle' | 'informative' | 'brand' | 'success'> = {
  unseen: 'subtle',
  unfamiliar: 'subtle',
  familiar: 'informative',
  proficient: 'brand',
  mastered: 'success',
};

/**
 * 知识地图页。
 *
 * 当前是**可用的简化版**：列出叶节点并按掌握状态着色。它已经把三件事做实
 * —— 点击进入、状态可见、证据不足与 0% 区分。票 03 会换成真正的图谱画布
 * （两跳邻域、逐层展开、物理布局放 Web Worker），但页面契约不变。
 */
export function MapPage() {
  const styles = useStyles();
  const navigate = useNavigate();
  const nodes = useNodeList({ limit: 200 });

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <Text className={styles.title} as="h1">
          知识地图
        </Text>
        <Body1>
          深色画布上的每个格子是一个知识点，颜色区分掌握状态。点击进入该知识点的关卡。
        </Body1>
      </div>
      <Divider />

      {nodes.isPending && <Spinner label="加载地图…" />}
      {nodes.isError && (
        <MessageBar intent="error">
          <MessageBarBody>地图加载失败，请检查后端是否运行。</MessageBarBody>
        </MessageBar>
      )}

      {nodes.payload && nodes.payload.items.length === 0 && (
        <MessageBar>
          <MessageBarBody>
            这片图谱还是空的。先运行内容入库流程（票 02），知识点才会出现在这里。
          </MessageBarBody>
        </MessageBar>
      )}

      {nodes.payload && nodes.payload.items.length > 0 && (
        <div className={styles.canvas}>
          {nodes.payload.items.map((node) => {
            const label = `${node.name}，${STATE_LABEL[node.state] ?? node.state}，${
              node.percent === null ? '证据不足' : `${Math.round(node.percent * 100)}%`
            }`;
            const open = () => navigate(`/map/${node.microKpId}`);
            return (
              <div
                key={node.microKpId}
                className={styles.node}
                role="button"
                tabIndex={0}
                aria-label={label}
                onClick={open}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    // 不 preventDefault 的话，空格会同时滚动页面
                    e.preventDefault();
                    open();
                  }
                }}
              >
                <span className={styles.nodeName}>{node.name}</span>
                <div className={styles.stateRow}>
                  <Badge appearance="tint" color={STATE_COLOR[node.state] ?? 'subtle'} size="small">
                    {STATE_LABEL[node.state] ?? node.state}
                  </Badge>
                  <span className={styles.stateText}>
                    {node.percent === null ? '证据不足' : `${Math.round(node.percent * 100)}%`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
