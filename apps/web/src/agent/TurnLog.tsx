/**
 * 学习日志（票 08 的「历史是学习日志不是消息流」）。
 *
 * ## 为什么不是消息列表
 *
 * 消息流的结构是「我一句、你一句」，读者会下意识在里面找对话。学习日志的
 * 结构是「什么时候、我提了什么、拿到了什么」，读者找的是**自己走过的路**：
 * 哪一轮被降级了、哪一轮问的是哪一级提示。所以这里每行是「轮次 + 我说的话 +
 * 卡片种类 + 标题」，不是两列气泡。
 *
 * ## 为什么降级的轮次要留在日志里
 *
 * 失败的那轮如果消失，学生会以为自己没提交过，于是再提交一次 —— 而模型的
 * 失败往往与输入无关，重提交只会再失败一次。留着并标注「降级」，是让人看懂
 * 「这次是系统的问题，不是你的问题」。
 */
import {
  Badge,
  Caption1,
  Card,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import type { AgentTurnHistoryResponseItemsItem } from '../api/generated/model';

const useStyles = makeStyles({
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '28px 1fr',
    gap: '10px',
    padding: '10px 12px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  index: {
    color: tokens.colorNeutralForeground4,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    paddingTop: '2px',
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap',
  },
  utterance: {
    color: tokens.colorNeutralForeground1,
    lineHeight: tokens.lineHeightBase300,
    wordBreak: 'break-word',
  },
  empty: {
    color: tokens.colorNeutralForeground3,
    padding: '12px 2px',
  },
});

/** 卡片种类 → 中文标签。降级轮单独一种，不和四张卡混在一起。 */
export const ARTIFACT_KIND_LABEL: Record<string, string> = {
  level_card: '关卡卡',
  graph_focus: '图谱聚焦',
  progress_change: '进度变化',
  probe_form: '追问表单',
  error_card: '降级卡',
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function TurnLog({
  items,
  isPending,
  activeTurnId,
  onSelect,
}: {
  items: readonly AgentTurnHistoryResponseItemsItem[];
  isPending: boolean;
  activeTurnId: string | null;
  /** 点一行回看那一轮的卡（卡快照在服务端，回看不重调模型）。 */
  onSelect: (turnId: string) => void;
}) {
  const styles = useStyles();

  if (isPending) return <Spinner size="tiny" label="读取学习日志…" />;

  if (items.length === 0) {
    return (
      <Text className={styles.empty}>
        还没有记录。在下方输入框里说一句你想学什么，第一张卡会出现在中间。
      </Text>
    );
  }

  return (
    <div className={styles.panel}>
      {items.map((item, index) => (
        <Card
          key={item.turnId}
          className={styles.row}
          role="button"
          tabIndex={0}
          aria-label={`第 ${index + 1} 轮，${ARTIFACT_KIND_LABEL[item.artifactKind] ?? item.artifactKind}：${item.cardTitle}`}
          style={
            item.turnId === activeTurnId
              ? { outline: `2px solid ${tokens.colorBrandStroke1}` }
              : undefined
          }
          onClick={() => onSelect(item.turnId)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect(item.turnId);
            }
          }}
        >
          <Text className={styles.index}>{String(index + 1).padStart(2, '0')}</Text>
          <div className={styles.content}>
            <div className={styles.meta}>
              <Badge appearance="tint" size="small" color="brand">
                {ARTIFACT_KIND_LABEL[item.artifactKind] ?? item.artifactKind}
              </Badge>
              <Text size={200} weight="semibold">
                {item.cardTitle}
              </Text>
              {item.degraded && (
                <Badge appearance="filled" size="small" color="danger">
                  降级
                </Badge>
              )}
              <Caption1>{formatTime(item.createdAt)}</Caption1>
            </div>
            <Text className={styles.utterance}>{item.utterance}</Text>
          </div>
        </Card>
      ))}
    </div>
  );
}
