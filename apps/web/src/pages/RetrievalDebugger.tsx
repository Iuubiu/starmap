/**
 * 检索调试器（票 09 的界面对应物）。
 *
 * ## 它要回答的问题
 *
 * 不是「检索到了什么」（那是搜索框），而是**「为什么这一条在/不在智能体的
 * 上下文里」**。每一个命中都要能说出三件事：
 *
 *   1. 它是不是当前知识点的答案块；
 *   2. 按当前掌握度落在哪一档（background / scaffold / full）；
 *   3. 如果被排除，具体原因是哪一条。
 *
 * 第 3 条是票 09 明确要求「展示被排除的具体原因」的落点。只给「排除」两个字，
 * 等于让开发者自己去猜门控逻辑 —— 而这个页面存在的意义就是不用猜。
 *
 * ## 为什么同时给「三档对比」
 *
 * 单档视图看得出来「这一条被排除了」，看不出来「它是因为档位被排除的，还是
 * 因为它是答案块」。三档并排以后，同一批候选在 0.2 / 0.55 / 0.85 下的去留
 * 一目了然：**随档位变化的**是结构门控（背景档排公式和表格），**在所有档位
 * 都被排除的**是答案块。这正好是两种机制的分界线。
 *
 * ## 为什么显示服务端的 gateTier 而不是自己算
 *
 * 前端也能按 0.4 / 0.7 算一遍，但那样一旦两边阈值不同步，界面会「自证正确」
 * 而服务端在做另一件事。这里显示服务端返回的档位，前端算的那个只用来摆刻度。
 */
import { useMemo, useState } from 'react';
import {
  Badge,
  Body1,
  Button,
  Caption1,
  Card,
  CardHeader,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  Subtitle1,
  Switch,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useRetrievalBands, useRetrievalDebug } from '../api/queries';
import { GATE_TIER_LABEL, GATE_TIER_SHORT } from '../agent/gate';
import type {
  RetrievalBandsResponse,
  RetrievalDebugResponse,
  RetrievalDebugResponseHitsItem,
} from '../api/generated/model';

const useStyles = makeStyles({
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  heading: { display: 'flex', flexDirection: 'column', gap: '8px' },
  controls: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 280px)',
    gap: '12px',
    alignItems: 'end',
  },
  buttonRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  summary: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  hitList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  expansions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '10px 12px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
  },
  expansionList: {
    margin: 0,
    paddingLeft: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },  expansionRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  hit: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '10px 12px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  hitExcluded: {
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
  },
  hitMeta: {
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
    fontSize: tokens.fontSizeBase200,
  },
  bandGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '10px',
  },
  band: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '10px 12px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  bandIds: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground2,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    maxHeight: '120px',
    overflowY: 'auto',
  },
  subtle: { color: tokens.colorNeutralForeground3 },
});

const KIND_LABEL: Record<string, string> = {
  text: '正文',
  formula: '公式',
  table: '表格',
  figure: '图',
};

export function RetrievalDebugger({ microKpId }: { microKpId: string | undefined }) {
  const styles = useStyles();
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [compareBands, setCompareBands] = useState(false);

  const params = useMemo(
    () =>
      query && microKpId ? { query, microKpId, limit: compareBands ? 20 : 10 } : undefined,
    [query, microKpId, compareBands],
  );

  const debug = useRetrievalDebug(params);
  const bands = useRetrievalBands(compareBands ? params : undefined);

  const run = () => {
    const trimmed = draft.trim();
    if (trimmed) setQuery(trimmed);
  };

  return (
    <div className={styles.section}>
      <div className={styles.heading}>
        <Subtitle1>检索调试器</Subtitle1>
        <Body1>
          用给定掌握度跑一次 BM25 检索，看哪些切片进了上下文、哪些被门控排除，以及排除了什么理由。
          门控是物理过滤——被排除的切片不会出现在提示词里，不是「告诉模型别用」。
        </Body1>
      </div>

      <Card>
        <div className={styles.controls}>
          <Field label="检索词" required>
            <Input
              value={draft}
              onChange={(_, data) => setDraft(data.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') run();
              }}
              placeholder="例如：布尔代数 吸收律"
              aria-label="检索词"
            />
          </Field>
          <div className={styles.buttonRow}>
            <Button appearance="primary" onClick={run} disabled={!draft.trim() || !microKpId}>
              检索
            </Button>
            <Switch
              checked={compareBands}
              onChange={(_, data) => setCompareBands(data.checked)}
              label="对比三档"
            />
          </div>
        </div>
        <Caption1 className={styles.subtle}>
          当前知识点：{microKpId ?? '未选定（先在上面的列表里点一个）'}
        </Caption1>
      </Card>

      {debug.isFetching && <Spinner label="检索中…" />}

      {debug.isError && (
        <MessageBar intent="error">
          <MessageBarTitle>检索失败</MessageBarTitle>
          <MessageBarBody>
            {debug.error instanceof Error ? debug.error.message : '未知错误'}
          </MessageBarBody>
        </MessageBar>
      )}

      {debug.payload && <DebugResult payload={debug.payload} />}

      {compareBands && bands.isFetching && <Spinner label="并行跑三个掌握度…" />}

      {compareBands && bands.isError && (
        <MessageBar intent="error">
          <MessageBarBody>
            无法对比三档：{bands.error instanceof Error ? bands.error.message : '未知错误'}
          </MessageBarBody>
        </MessageBar>
      )}

      {compareBands && bands.payload && <BandComparison payload={bands.payload} />}
    </div>
  );
}

function DebugResult({ payload }: { payload: RetrievalDebugResponse }) {
  const styles = useStyles();
  const excluded = payload.hits.filter((hit) => !hit.allowed).length;

  return (
    <>
      <div className={styles.summary}>
        <Badge appearance="tint" color="brand">
          {GATE_TIER_LABEL[payload.gateTier] ?? payload.gateTier}
        </Badge>
        <Caption1 className={styles.subtle}>
          掌握度 current = {payload.current === null ? '无记录' : payload.current.toFixed(2)}
        </Caption1>
        <Caption1 className={styles.subtle}>
          候选 {payload.totalMatched} 条 · 展示 {payload.hits.length} 条 · 其中排除 {excluded} 条
        </Caption1>
        <Caption1 className={styles.subtle}>
          该知识点的答案块共 {payload.answerChunkCount} 个
        </Caption1>
      </div>

      {payload.hits.length === 0 && (
        <MessageBar>
          <MessageBarBody>
            这个检索词没有命中任何切片。BM25 是词面匹配，换个更贴近原文的说法试试。
          </MessageBarBody>
        </MessageBar>
      )}

      {payload.expansions.length > 0 && (
        <div className={styles.expansions}>
          <Caption1 className={styles.subtle}>
            这句中文里认出了 {new Set(payload.expansions.map((e) => e.zh)).size}{' '}
            个术语，已按术语表扩展到英文（英文书占全库六成叶知识点，没有这一步中文提问对它们零命中）：
          </Caption1>
          <ul className={styles.expansionList} aria-label="中文术语到英文的展开">
            {payload.expansions.map((expansion) => (
              <li key={`${expansion.zh}→${expansion.en}`} className={styles.expansionRow}>
                <code>{expansion.zh}</code>
                <span aria-hidden="true">→</span>
                <code>{expansion.en}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.hitList}>
        {payload.hits.map((hit) => (
          <HitRow key={hit.chunkId} hit={hit} />
        ))}
      </div>

      {excluded > 0 && (
        <Caption1 className={styles.subtle}>
          被排除的条目仍然列出：调试器要能看出「它存在但没被采用」，否则空结果和
          「全被门控挡了」看起来一模一样。
        </Caption1>
      )}
    </>
  );
}

function HitRow({ hit }: { hit: RetrievalDebugResponseHitsItem }) {
  const styles = useStyles();
  const className = [styles.hit, hit.allowed ? undefined : styles.hitExcluded]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className}>
      <div className={styles.hitMeta}>
        <Badge
          appearance="tint"
          size="small"
          color={hit.allowed ? 'success' : 'subtle'}
        >
          {hit.allowed ? '采用' : '排除'}
        </Badge>
        <Badge appearance="outline" size="small">
          {KIND_LABEL[hit.kind] ?? hit.kind}
        </Badge>
        {hit.isAnswerChunk && (
          <Badge appearance="filled" size="small" color="warning">
            答案块
          </Badge>
        )}
        <Caption1 className={styles.subtle}>p.{hit.page ?? '—'}</Caption1>
        <Caption1 className={styles.subtle}>{hit.sourceTitle}</Caption1>
        <Caption1 className={styles.subtle}>BM25 {hit.score.toFixed(3)}</Caption1>
        <Caption1 className={styles.subtle}>
          {GATE_TIER_SHORT[hit.tier] ?? hit.tier}
        </Caption1>
      </div>
      <Text className={styles.snippet}>{hit.snippet}</Text>
      {!hit.allowed && hit.exclusionReason && (
        <Text className={styles.reason}>排除原因：{hit.exclusionReason}</Text>
      )}
    </div>
  );
}

function BandComparison({ payload }: { payload: RetrievalBandsResponse }) {
  const styles = useStyles();
  // 答案块集合在三个档位下不变（它是知识点属性，不是掌握度属性）。
  // 用它做基线：所有档位都被排除的 id，就是答案块。
  const alwaysExcluded = payload.bands.reduce<string[] | null>((acc, band) => {
    if (acc === null) return [...band.excludedIds];
    const set = new Set(band.excludedIds);
    return acc.filter((id) => set.has(id));
  }, null);

  return (
    <>
      <CardHeader header={<Subtitle1>三档对比</Subtitle1>} />
      <Caption1 className={styles.subtle}>
        同一次检索在三个掌握度下的去留。<strong>随档位变化的</strong>是结构门控（背景档只留正文与图）；
        <strong>在所有档位都被排除的</strong>是答案块——它是不是答案不随你学得多好而改变。
      </Caption1>

      <div className={styles.bandGrid}>
        {payload.bands.map((band) => (
          <div key={band.current} className={styles.band}>
            <div className={styles.hitMeta}>
              <Badge appearance="tint" color="brand">
                {GATE_TIER_SHORT[band.gateTier] ?? band.gateTier}
              </Badge>
              <Caption1 className={styles.subtle}>current = {band.current.toFixed(2)}</Caption1>
            </div>
            <Caption1>采用 {band.allowedIds.length} 条</Caption1>
            <div className={styles.bandIds}>
              {band.allowedIds.join(', ') || '（空）'}
            </div>
            <Caption1>排除 {band.excludedIds.length} 条</Caption1>
            <div className={styles.bandIds}>
              {band.excludedIds.join(', ') || '（空）'}
            </div>
          </div>
        ))}
      </div>

      <Caption1 className={styles.subtle}>
        该知识点的答案块（{payload.answerChunkIds.length} 个）：
        {payload.answerChunkIds.join(', ') || '（无）'}
      </Caption1>

      {alwaysExcluded && alwaysExcluded.length > 0 && (
        <MessageBar>
          <MessageBarBody>
            所有档位都被排除的切片：{alwaysExcluded.join(', ')} —— 这些在
            `app.chunk_kp_answer` 里是当前知识点的答案块，门控在任何掌握度下都不会放行。
          </MessageBarBody>
        </MessageBar>
      )}
    </>
  );
}
