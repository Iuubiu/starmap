/**
 * 内容库：一个导航入口，四个次级页（教材 / 期刊 / 题库 / 技能）。
 *
 * ## 为什么做成一个页面的四个标签，而不是四个独立路由
 *
 * 用户的原话是「走一个导航入口、其下四个次级页」。四个独立路由会让左侧导航
 * 多出四个条目，而它们回答的是同一个问题——「我这个学习工作站里到底有多少
 * 东西可用」。同屏可切换才看得出比例：教材 14 本 vs 期刊 101 篇 vs 题库…
 *
 * ## 为什么每个数字都写「来自哪张表」
 *
 * 这一页是**展示页**，最容易变成「看起来很有货」的假数字。所以每块都标注
 * 数据出处（`app.sources` / `app.chunks` / `/agent/skills`），并且**空态必须
 * 写原因**——「没有」和「没加载」在界面上必须能分辨。
 *
 * ## 停用的英文书为什么也列出来
 *
 * 13 本英文教材的导入结果留在库里（`enabled = false`），它们是真实发生过的
 * 工作，也让「为什么检索只覆盖中文」这个问题有答案可指。删掉它们等于把一段
 * 失败从历史里抹掉。
 */
import { useMemo, useState } from 'react';
import {
  Badge,
  Body1,
  Caption1,
  Divider,
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
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { useContentStats, useSkills } from '../api/queries';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', gap: '20px', padding: '28px 0' },
  head: { display: 'flex', flexDirection: 'column', gap: '8px' },
  tabs: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  tab: {
    appearance: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '8px 14px',
    borderRadius: '10px',
    backgroundColor: 'transparent',
    color: tokens.colorNeutralForeground2,
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  tabOn: {
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground2,
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    padding: '20px',
    borderRadius: '16px',
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow4,
  },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '12px' },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '14px 16px',
    borderRadius: '12px',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  num: { fontSize: tokens.fontSizeBase400, lineHeight: tokens.lineHeightBase400, fontWeight: tokens.fontWeightSemibold },
  muted: { color: tokens.colorNeutralForeground3 },
  note: {
    padding: '10px 14px',
    borderRadius: '10px',
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2,
  },
});

type TabKey = 'books' | 'papers' | 'items' | 'skills';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'books', label: '教材' },
  { key: 'papers', label: '期刊' },
  { key: 'items', label: '题库' },
  { key: 'skills', label: '技能' },
];

/**
 * 技能库的规划条目（来自 `docs/design/skill-library-plan.md`）。
 *
 * 为什么硬编码在页面里而不是查库：这些技能**还不存在**，没有表可查。
 * 写死一份并注明出处，好过让「规划中」成为一张空表——空表会让人以为
 * 加载失败。
 */
const PLANNED_SKILLS: { name: string; zh: string; why: string; tier: 'P0' | 'P1' | 'P2' }[] = [
  { name: 'level-architect', zh: '关卡生成', why: '按知识点与档位生成整关，现在是查表', tier: 'P0' },
  { name: 'placement-assessor', zh: '定级评测', why: '从作答反推档位，现在是固定题库', tier: 'P0' },
  { name: 'misconception-diagnostician', zh: '错因诊断', why: '答错后判断错在哪一步', tier: 'P1' },
  { name: 'explanation-writer', zh: '讲解撰写', why: '按档位写不同的讲解密度', tier: 'P1' },
  { name: 'remediation-designer', zh: '补救设计', why: '错后给一条针对性的重练路径', tier: 'P1' },
  { name: 'review-scheduler', zh: '复验排期', why: '现在就只按固定间隔表', tier: 'P2' },
  { name: 'source-router', zh: '内容路由', why: '按问题选教材/期刊/题库', tier: 'P2' },
  { name: 'progress-narrator', zh: '进度叙述', why: '把数据讲成人话', tier: 'P2' },
];

export function LibraryPage() {
  const styles = useStyles();
  const [tab, setTab] = useState<TabKey>('books');
  const stats = useContentStats();
  const skills = useSkills();

  const sources = stats.payload?.sources ?? [];
  const books = useMemo(() => sources.filter((s) => s.kind === 'book'), [sources]);
  const papers = useMemo(() => sources.filter((s) => s.kind === 'paper'), [sources]);
  const answerChunks = stats.payload?.answers ?? 0;

  const loading = stats.isLoading || skills.isLoading;
  const failed = stats.isError || skills.isError;

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <Subtitle1>内容库</Subtitle1>
        <Body1 className={styles.muted}>
          这台工作站里到底有多少东西可用。每个数字都标了出处，空态写原因 —— 「没有」和「没加载」必须能分辨。
        </Body1>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="内容库分区">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={mergeClasses(styles.tab, tab === item.key && styles.tabOn)}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading && <Spinner label="正在读内容库…" />}
      {failed && (
        <div className={styles.note}>
          内容库没读出来：{stats.error?.message ?? skills.error?.message ?? '未知原因'}。这不是「库是空的」。
        </div>
      )}

      {!loading && !failed && tab === 'books' && (
        <div className={styles.panel}>
          <Body1>
            教材 <strong>{books.length}</strong> 本 · 切片{' '}
            <strong>{books.reduce((sum, b) => sum + b.chunkCount, 0)}</strong> · 来源表{' '}
            <code>app.sources</code>
          </Body1>
          <Divider />
          {books.length === 0 ? (
            <Caption1 className={styles.muted}>没有启用的教材。去「数据库」页看导入记录。</Caption1>
          ) : (
            <Table aria-label="教材列表">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>书名</TableHeaderCell>
                  <TableHeaderCell>切片</TableHeaderCell>
                  <TableHeaderCell>答案块</TableHeaderCell>
                  <TableHeaderCell>页码范围</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {books.map((book) => (
                  <TableRow key={book.id}>
                    <TableCell>{book.title}</TableCell>
                    <TableCell>{book.chunkCount}</TableCell>
                    <TableCell>{book.answerChunkCount}</TableCell>
                    <TableCell>
                      {book.pageFrom ?? '—'}–{book.pageTo ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className={styles.note}>
            另有 13 本英文教材已停用（<code>sources.enabled = false</code>）：翻译与答案块质量问题延到下一版，
            节点已从图谱移除，但导入记录保留 —— 删掉它们等于把一段失败从历史里抹掉。
          </div>
        </div>
      )}

      {!loading && !failed && tab === 'papers' && (
        <div className={styles.panel}>
          <Body1>
            期刊论文 <strong>{papers.length}</strong> 篇 · 切片{' '}
            <strong>{papers.reduce((sum, p) => sum + p.chunkCount, 0)}</strong> · 来源表{' '}
            <code>app.sources</code>
          </Body1>
          <Divider />
          {papers.length === 0 ? (
            <Caption1 className={styles.muted}>还没有论文入库。</Caption1>
          ) : (
            <Table aria-label="论文列表">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>标题</TableHeaderCell>
                  <TableHeaderCell>切片</TableHeaderCell>
                  <TableHeaderCell>页码范围</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {papers.slice(0, 40).map((paper) => (
                  <TableRow key={paper.id}>
                    <TableCell>{paper.title}</TableCell>
                    <TableCell>{paper.chunkCount}</TableCell>
                    <TableCell>
                      {paper.pageFrom ?? '—'}–{paper.pageTo ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {papers.length > 40 && (
            <Caption1 className={styles.muted}>只列前 40 篇，共 {papers.length} 篇。</Caption1>
          )}
        </div>
      )}

      {!loading && !failed && tab === 'items' && (
        <div className={styles.panel}>
          <Body1>
            题库有两个来源，性质不同，**不能混为一谈**：
          </Body1>
          <div className={styles.cards}>
            <div className={styles.card}>
              <Caption1 className={styles.muted}>教材课后题</Caption1>
              <Text className={styles.num}>{answerChunks}</Text>
              <Caption1 className={styles.muted}>
                来自 <code>app.chunks</code> 里被判为「答案块」的切片
              </Caption1>
              <Badge appearance="tint" color="warning">
                未经结构化
              </Badge>
            </div>
            <div className={styles.card}>
              <Caption1 className={styles.muted}>AI 生成题</Caption1>
              <Text className={styles.num}>见关卡市场</Text>
              <Caption1 className={styles.muted}>
                每关 5 题 5 变式，走 <code>pool.practice</code>，不参与判定
              </Caption1>
              <Badge appearance="tint" color="brand">
                可判定
              </Badge>
            </div>
          </div>
          <div className={styles.note}>
            课后题只有原文切片，没有被解析成「题干 / 选项 / 答案」结构 —— 直接当题用会判错。
            要变成可判定的题，得走结构化抽取，那是下一版的事。
          </div>
        </div>
      )}

      {!loading && !failed && tab === 'skills' && (
        <div className={styles.panel}>
          <Body1>
            已启用 <strong>{(skills.payload?.items ?? []).length}</strong> 个 · 规划中{' '}
            <strong>{PLANNED_SKILLS.length}</strong> 个 · 来源{' '}
            <code>GET /api/v1/agent/skills</code> + <code>docs/design/skill-library-plan.md</code>
          </Body1>
          <Divider />
          <div className={styles.cards}>
            {(skills.payload?.items ?? []).map((skill) => (
              <div key={skill.name} className={styles.card}>
                <Text className={styles.num}>{skill.name}</Text>
                <Caption1 className={styles.muted}>{skill.description}</Caption1>
                <Badge appearance="tint" color="success">
                  已启用
                </Badge>
              </div>
            ))}
            {PLANNED_SKILLS.map((skill) => (
              <div key={skill.name} className={styles.card}>
                <Text className={styles.num}>
                  {skill.zh} <Caption1 className={styles.muted}>{skill.name}</Caption1>
                </Text>
                <Caption1 className={styles.muted}>{skill.why}</Caption1>
                <Badge appearance="tint" color="informative">
                  规划中 · {skill.tier}
                </Badge>
              </div>
            ))}
          </div>
          <div className={styles.note}>
            「规划中」的不在 <code>apps/api/src/mastra/skills/</code> 里，启用它们需要先有实现 ——
            列在这里是为了让缺口可见，而不是假装已经有。
          </div>
        </div>
      )}
    </div>
  );
}
