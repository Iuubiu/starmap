import { useMemo, useState } from 'react';
import {
  Badge,
  Body1,
  Button,
  Card,
  CardHeader,
  Caption1,
  Divider,
  MessageBar,
  MessageBarBody,
  Spinner,
  Subtitle1,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useContentStats, useNodeList, useNodeSources } from '../api/queries';

const useStyles = makeStyles({
  page: {
    padding: '32px',
    maxWidth: '1080px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  heading: { display: 'flex', flexDirection: 'column', gap: '8px' },
  title: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightHero700,
  },
  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: '12px',
  },
  statValue: {
    fontSize: tokens.fontSizeHero800,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightHero800,
  },
  twoCol: {
    display: 'grid',
    gridTemplateColumns: 'minmax(240px, 320px) 1fr',
    gap: '20px',
    alignItems: 'start',
  },
  nodeList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    maxHeight: '480px',
    overflowY: 'auto',
  },
  nodeButton: {
    justifyContent: 'flex-start',
    textAlign: 'left',
    whiteSpace: 'normal',
    // Fluent Button 默认是固定高度（medium = 32px）。知识点名一长就换行，
    // 文字溢出按钮外，与下一个按钮的字叠在一起（截图里实测到）。
    // 三个属性缺一不可：height auto 解掉固定高、lineHeight 让行距正常、
    // padding 给换行后的行留出呼吸空间。
    height: 'auto',
    minHeight: '32px',
    paddingTop: '6px',
    paddingBottom: '6px',
    lineHeight: tokens.lineHeightBase300,
  },
  chunk: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '8px 0',
  },
  chunkMeta: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
  excerpt: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
});

/**
 * 数据库展示页。
 *
 * 三块，各有各的用途，不做成一张大仪表盘：
 * 1. **统计**：库里有东西没有、数字对不对，一眼看完。
 * 2. **来源表**：每本书进了多少切片、页码范围 —— 覆盖缺口靠这个发现。
 * 3. **追溯**：任取一个知识点，看它出自第几页的哪几段，以及哪些被判为答案块。
 *    这一块是整个页面的重点：它让「内容可核验」从一句话变成一个能点的界面。
 *
 * 刻意不做 SQL 控制台（spec OQ4）：本地单用户跑任意 SQL 既无用又危险。
 */
export function DatabasePage() {
  const styles = useStyles();
  const stats = useContentStats();
  const nodes = useNodeList({ limit: 200 });
  const [selected, setSelected] = useState<string | undefined>();

  const nodeItems = nodes.payload?.items ?? [];

  // 默认选中第一个叶节点：空表格比空页面更难懂，先给个真实内容。
  // 注意 sources 用的是 activeId 而不是 selected —— 用 selected 会让
  // 「默认选中」只影响按钮高亮，数据永远不加载（实测踩过这一脚）。
  const activeId = selected ?? nodeItems[0]?.microKpId;
  const sources = useNodeSources(activeId);

  const byKindLabel = useMemo(() => {
    const map = stats.payload?.chunks.byKind ?? {};
    const label: Record<string, string> = {
      text: '正文',
      formula: '公式',
      table: '表格',
      figure: '图',
    };
    return Object.entries(map)
      .map(([k, v]) => `${label[k] ?? k} ${v}`)
      .join(' · ');
  }, [stats.payload]);

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <Text className={styles.title} as="h1">
          数据库
        </Text>
        <Body1>
          内容库的实际状态与来源追溯。这里显示的都是库里真实存在的行，没有任何示例数字。
        </Body1>
      </div>

      {stats.isPending && <Spinner label="读取内容统计…" />}
      {stats.isError && (
        <MessageBar intent="error">
          <MessageBarBody>
            无法读取内容统计：
            {stats.error instanceof Error ? stats.error.message : '未知错误'}
          </MessageBarBody>
        </MessageBar>
      )}

      {stats.payload && (
        <>
          <div className={styles.statGrid}>
            <Card>
              <Caption1>知识点</Caption1>
              <Text className={styles.statValue}>{stats.payload.knowledgePoints.total}</Text>
              <Caption1>其中叶节点 {stats.payload.knowledgePoints.leaves} 个</Caption1>
            </Card>
            <Card>
              <Caption1>内容切片</Caption1>
              <Text className={styles.statValue}>{stats.payload.chunks.total}</Text>
              <Caption1>{byKindLabel}</Caption1>
            </Card>
            <Card>
              <Caption1>答案块</Caption1>
              <Text className={styles.statValue}>{stats.payload.answers}</Text>
              <Caption1>检索门控据此过滤（ADR-0001）</Caption1>
            </Card>
            <Card>
              <Caption1>先修边</Caption1>
              <Text className={styles.statValue}>{stats.payload.edges.total}</Text>
              <Caption1>
                其中 {stats.payload.edges.withEvidence} 条带可核验证据
              </Caption1>
            </Card>
          </div>

          <Card>
            <CardHeader header={<Subtitle1>来源</Subtitle1>} />
            <Table size="small">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>来源</TableHeaderCell>
                  <TableHeaderCell>类型</TableHeaderCell>
                  <TableHeaderCell>切片</TableHeaderCell>
                  <TableHeaderCell>答案块</TableHeaderCell>
                  <TableHeaderCell>页码范围</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.payload.sources.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.title}</TableCell>
                    <TableCell>{s.kind === 'book' ? '教材' : s.kind}</TableCell>
                    <TableCell>{s.chunkCount}</TableCell>
                    <TableCell>{s.answerChunkCount}</TableCell>
                    <TableCell>
                      {s.pageFrom === null ? '—' : `${s.pageFrom}–${s.pageTo}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      <Divider />

      <div className={styles.heading}>
        <Subtitle1>来源追溯</Subtitle1>
        <Body1>选一个知识点，看它的内容出自哪几页，以及哪些切片被判定为答案块。</Body1>
      </div>

      {nodes.isPending && <Spinner label="读取知识点…" />}
      {nodes.isError && (
        <MessageBar intent="error">
          <MessageBarBody>
            无法读取知识点：{nodes.error instanceof Error ? nodes.error.message : '未知错误'}
          </MessageBarBody>
        </MessageBar>
      )}

      {nodes.payload && nodeItems.length === 0 && (
        <MessageBar>
          <MessageBarBody>
            库里还没有知识点。先跑内容抽取与导入：`python tools/ingest/run.py …` 然后
            `pnpm --filter @starmap/api content:import`。
          </MessageBarBody>
        </MessageBar>
      )}

      {nodeItems.length > 0 && (
        <div className={styles.twoCol}>
          <Card>
            <CardHeader header={<Subtitle1>知识点</Subtitle1>} />
            <div className={styles.nodeList}>
              {nodeItems.map((n) => (
                <Button
                  key={n.microKpId}
                  className={styles.nodeButton}
                  appearance={n.microKpId === activeId ? 'primary' : 'subtle'}
                  onClick={() => setSelected(n.microKpId)}
                >
                  {n.name}
                </Button>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader
              header={<Subtitle1>{sources.payload?.name ?? '来源'}</Subtitle1>}
              description={
                sources.payload ? (
                  <Caption1>
                    共 {sources.payload.chunks.length} 个切片，页码：
                    {sources.payload.pages.join('、') || '—'}
                  </Caption1>
                ) : undefined
              }
            />
            {sources.isPending && <Spinner label="读取来源…" />}
            {sources.isError && (
              <MessageBar intent="error">
                <MessageBarBody>
                  无法读取来源：
                  {sources.error instanceof Error ? sources.error.message : '未知错误'}
                </MessageBarBody>
              </MessageBar>
            )}
            {sources.payload?.chunks.length === 0 && (
              <MessageBar>
                <MessageBarBody>
                  这个知识点没有归属的切片。归属按页码区间判定，落在区间外就会是空的。
                </MessageBarBody>
              </MessageBar>
            )}
            {sources.payload?.chunks.map((c) => (
              <div key={c.chunkId} className={styles.chunk}>
                <div className={styles.chunkMeta}>
                  <Badge appearance="tint" size="small">
                    {KIND_LABEL[c.kind] ?? c.kind}
                  </Badge>
                  <Caption1>p.{c.page ?? '—'}</Caption1>
                  {c.isAnswer && (
                    <Badge appearance="filled" color="warning" size="small">
                      答案块
                    </Badge>
                  )}
                </div>
                <Text className={styles.excerpt}>{c.excerpt}</Text>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  text: '正文',
  formula: '公式',
  table: '表格',
  figure: '图',
};
