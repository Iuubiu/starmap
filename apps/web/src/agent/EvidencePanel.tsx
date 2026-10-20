/**
 * 「这一轮我看到了什么」——依据面板。
 *
 * ## 为什么要展示「被排除的」
 *
 * 票 09 的验收是调试器要展示「被排除的具体原因」，那条要求同样适用于学生
 * 点开「看依据」的时候：如果只列出被采用的三条切片，学生会以为教材里只讲了
 * 这些；真相是检索到了十条，其中七条因为**掌握度还不够**被门控挡掉了。
 * 「为什么不给我看」比「给你看了什么」更能建立信任 —— 而且它直接把「多做
 * 几题解锁更多材料」这条因果关系演示出来了。
 *
 * ## 为什么读的是历史快照
 *
 * 依据来自 `app.agent_turn_evidence`（当轮写下的判定），不是重新检索。
 * 重新检索会给出与当时不同的门控结论，学生会发现解释和记忆里的不一致。
 */
import {
  Badge,
  Caption1,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useTurnEvidence } from '../api/queries';
import { GATE_TIER_LABEL } from './gate';
import type { AgentTurnEvidenceResponseItemsItem } from '../api/generated/model';

const useStyles = makeStyles({
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  summary: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  item: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '10px 12px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  itemBlocked: {
    backgroundColor: tokens.colorNeutralBackground2,
    // 用完整 border 简写而不是 borderStyle：`item` 里已经写了 `border` 简写，
    // 同一条规则里再出现 borderStyle 长写会被 Griffel 判成混用简写与长写。
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
  },
  meta: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  snippet: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  reason: {
    color: tokens.colorPaletteDarkOrangeForeground2,
    fontWeight: tokens.fontWeightSemibold,
  },
});

const KIND_LABEL: Record<string, string> = {
  text: '正文',
  formula: '公式',
  table: '表格',
  figure: '图',
};

function EvidenceItem({ item }: { item: AgentTurnEvidenceResponseItemsItem }) {
  const styles = useStyles();
  return (
    <div className={`${styles.item} ${item.allowed ? '' : styles.itemBlocked}`}>
      <div className={styles.meta}>
        <Badge appearance={item.allowed ? 'tint' : 'outline'} size="small" color={item.allowed ? 'success' : 'subtle'}>
          {item.allowed ? '采用' : '排除'}
        </Badge>
        <Badge appearance="outline" size="small">
          {KIND_LABEL[item.kind] ?? item.kind}
        </Badge>
        {item.isAnswerChunk && (
          <Badge appearance="filled" size="small" color="warning">
            答案块
          </Badge>
        )}
        <Caption1>
          {item.sourceTitle}
          {item.page === null ? '' : ` · p.${item.page}`}
        </Caption1>
        <Caption1>BM25 {item.score.toFixed(2)}</Caption1>
      </div>
      <Text className={styles.snippet}>{item.snippet}</Text>
      {!item.allowed && item.exclusionReason && (
        <Text size={200} className={styles.reason}>
          排除原因：{item.exclusionReason}
        </Text>
      )}
    </div>
  );
}

export function EvidencePanel({ turnId }: { turnId: string }) {
  const styles = useStyles();
  const evidence = useTurnEvidence(turnId);

  if (evidence.isPending) return <Spinner size="tiny" label="读取依据…" />;

  if (evidence.isError) {
    return (
      <MessageBar intent="error">
        <MessageBarBody>
          无法读取依据：{evidence.error instanceof Error ? evidence.error.message : '未知错误'}
        </MessageBarBody>
      </MessageBar>
    );
  }

  const payload = evidence.payload;
  if (!payload) return null;

  const allowed = payload.items.filter((item) => item.allowed).length;
  const blocked = payload.items.length - allowed;

  return (
    <div className={styles.panel}>
      <div className={styles.summary}>
        <Badge appearance="tint" color="brand">
          {GATE_TIER_LABEL[payload.gateTier] ?? payload.gateTier}
        </Badge>
        <Text size={200}>
          本轮检索到 {payload.items.length} 条切片：采用 {allowed} 条，排除 {blocked} 条
        </Text>
      </div>

      {payload.items.length === 0 && (
        <MessageBar>
          <MessageBarBody>
            这一轮没有检索到任何切片 —— 可能是这句话与教材文本没有词面重合，
            也可能是当时没有选定知识点。
          </MessageBarBody>
        </MessageBar>
      )}

      {payload.items.map((item) => (
        <EvidenceItem key={item.chunkId} item={item} />
      ))}
    </div>
  );
}
