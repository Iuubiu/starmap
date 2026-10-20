/**
 * 看板页：今天该学什么、今天学到哪、常用指令在哪。
 *
 * ## 这一页为什么不再是知识点网格
 *
 * 票 01 时 `/board` 是「全部叶节点」的陈列。那个职责已经搬到 `/map`（那里有
 * 状态着色、两跳邻域、键盘清单），继续在板上放一份网格有两个具体害处：
 * 一是同一个数据两处渲染，状态一改就要改两处；二是学生打开「看板」想知道的
 * 是**今天干什么**，给他 167 个可点的点只是把选择难题推回去。
 *
 * 现在这一页只回答三件事（与 spec 第 360 行一致）：今日推荐、今日学习摘要、
 * 常用指令入口。
 *
 * ## 推荐为什么必须带理由
 *
 * 票 13 验收第 2 条：理由要是具体事实（「你在 A 卡住，A 依赖 B，B 你只有
 * 32%」），不是「根据你的学习情况」。所以这里不渲染任何兜底话术 ——
 * `renderReason()` 对六种 kind 各写一段，缺事实时降级成「能说的那部分」，
 * 但绝不退化成空话。
 *
 * 拼中文的地方只有 `board/reason.ts` 一处：服务端给结构化事实（数字存原值
 * 0.32），页面负责把数字加粗、把先修节点做成链接。改措辞不用动后端。
 *
 * ## 「不学这个」为什么要求再选一个节点
 *
 * 票 13 验收第 3 条是「拒绝当前推荐**并选择别的节点**」。只做「删掉这一条」
 * 是个假动作：列表会立刻补一条上来，学生并没有做决定，只是把推荐机重摇一次。
 * 让他明确挑一个想去的节点，那个选择才是学习决策，也才值得被记住。
 *
 * 选择被记住的机制不在前端：服务端把「谁在什么时候拒绝了谁」写进
 * `learning_log`，之后不再推同一个，直到那个节点有了新证据（状态变了理由
 * 才过期）。前端只负责把意图说清楚。
 *
 * ## 为什么不新增一个 `/board/alternatives` 端点
 *
 * 候选节点就是整张图谱的叶节点，`/api/v1/graph` 已经一次返回（并带
 * `recommendedIds`，正好用来把这批推荐标在地图上 —— 验收第 5 条）。为一个
 * 下拉框再开一条只返回 id 与名字的路径，等于把同一份数据维护两遍。
 */
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
  MessageBarTitle,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { GraphNode, RecommendationListResponse } from '../api/generated/model';
import {
  useGraph,
  useRecommendations,
  useRedirectRecommendation,
} from '../api/queries';
import { reasonKindLabel, renderReason, type Reason } from '../board/reason';
import { orderMainline } from '../graph/topology';

type RecommendationItem = RecommendationListResponse['recommendations'][number];

const useStyles = makeStyles({
  page: {
    padding: '24px 32px 40px',
    maxWidth: '1080px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  heading: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  title: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightHero700,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  sectionHead: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    flexWrap: 'wrap',
  },
  sectionTitle: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
  },
  cards: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  card: {
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  cardHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  name: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
  },
  meta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  reason: {
    margin: 0,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    color: tokens.colorNeutralForeground1,
  },
  /** 数字比周围重一级 —— 与颜色无关的第二编码，色觉障碍与黑白打印都看得出。 */
  reasonNumber: {
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorNeutralForeground1,
  },
  reasonNode: {
    color: tokens.colorBrandForegroundLink,
    textDecorationLine: 'underline',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  redirectRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  select: {
    maxWidth: '320px',
    padding: '5px 8px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    fontFamily: 'inherit',
    fontSize: tokens.fontSizeBase300,
  },
  summary: {
    display: 'flex',
    gap: '24px',
    flexWrap: 'wrap',
    padding: '14px 16px',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: '96px',
  },
  statValue: {
    fontSize: tokens.fontSizeBase600,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightBase600,
  },
  commands: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: '10px',
  },
  command: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '4px',
    padding: '12px 14px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: 'pointer',
    font: 'inherit',
    color: 'inherit',
    textAlign: 'left',
    ':hover': { border: `1px solid ${tokens.colorBrandStroke1}` },
  },
  commandSay: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
  },
  subtle: { color: tokens.colorNeutralForeground3 },
});

/** 常用指令入口。`say` 是学生对智能体说的原话，`to` 是这句话该在哪儿说。 */
const COMMANDS: ReadonlyArray<{ say: string; where: string; to: string }> = [
  { say: '我要练题', where: '关卡市场里挑一张关卡', to: '/market' },
  { say: '看看我学到哪了', where: '知识地图上按主线看一遍', to: '/map?view=mainline' },
  { say: '我卡住了，帮我理一理', where: '回主页，把这句话发给智能体', to: '/' },
];

export function DashboardPage() {
  const styles = useStyles();
  const navigate = useNavigate();
  const recommendations = useRecommendations();
  const graph = useGraph();
  const redirect = useRedirectRecommendation();

  /** 正在改道的那条推荐（点「不学这个」之后展开选择器）。 */
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [choice, setChoice] = useState('');

  const payload = recommendations.payload;
  const items = payload?.recommendations ?? [];
  const summary = payload?.summary;

  /**
   * 改道可选的节点：整张图谱的叶节点，按线性主线排序。
   *
   * 排除已经在推荐里的那几个：把它们放进下拉框，等于允许学生「改道去一个
   * 系统已经让他学的地方」，那次改道什么也没改变。
   */
  const alternatives = useMemo<GraphNode[]>(() => {
    const nodes = graph.payload?.nodes ?? [];
    const recommended = new Set(items.map((item) => item.microKpId));
    return orderMainline(nodes.filter((node) => !recommended.has(node.microKpId)));
  }, [graph.payload, items]);

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <Text className={styles.title} as="h1">
          看板
        </Text>
        <Body1>
          核电子学学习工作站 · 今天该学什么、走到哪了、常说的话从哪儿说。
        </Body1>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* 今日推荐                                                          */}
      {/* ---------------------------------------------------------------- */}
      <section className={styles.section} aria-labelledby="board-recommend">
        <div className={styles.sectionHead}>
          <Text id="board-recommend" className={styles.sectionTitle} as="h2">
            今日推荐
          </Text>
          <Caption1 className={styles.subtle}>
            每条都说清为什么 —— 理由里的数字来自你的作答记录，不是估计
          </Caption1>
        </div>

        {recommendations.isPending && <Spinner label="正在读你的作答记录…" />}

        {recommendations.isError && (
          <MessageBar intent="error">
            <MessageBarTitle>推荐没能算出来</MessageBarTitle>
            <MessageBarBody>
              {recommendations.error instanceof Error
                ? recommendations.error.message
                : '未知错误'}
              <br />
              这一页不给你猜一个「大概该学什么」—— 具体理由比好看的列表重要。
            </MessageBarBody>
          </MessageBar>
        )}

        {redirect.isError && (
          <MessageBar intent="error">
            <MessageBarBody>
              改道没有记下来：
              {redirect.error instanceof Error ? redirect.error.message : '未知错误'}
              <br />
              这次选择没有生效，推荐列表仍是原来的那批。
            </MessageBarBody>
          </MessageBar>
        )}

        {payload && items.length === 0 && (
          <MessageBar>
            <MessageBarBody>
              此刻没有要推给你的：要么都已经练到熟悉线以上，要么还没有可用的题目。
              去知识地图上自己挑一个也行。
            </MessageBarBody>
          </MessageBar>
        )}

        {items.length > 0 && (
          <div className={styles.cards}>
            {items.map((item) => (
              <Card key={item.microKpId} className={styles.card} data-recommended="true">
                <div className={styles.cardHead}>
                  <Text className={styles.name}>{item.name}</Text>
                  {/* 第二编码：除了颜色/位置，还有文字标签本身 */}
                  <Badge appearance="tint" color="brand">
                    {reasonKindLabel(item.reason.kind)}
                  </Badge>
                  {item.moduleName !== '' && (
                    <Caption1 className={styles.meta}>{item.moduleName}</Caption1>
                  )}
                </div>

                <p className={styles.reason}>
                  <ReasonLine reason={item.reason} />
                </p>

                <div className={styles.actions}>
                  {rejecting === item.microKpId ? (
                    <div className={styles.redirectRow}>
                      <label className={styles.redirectRow}>
                        <Caption1 className={styles.meta}>改去</Caption1>
                        <select
                          className={styles.select}
                          aria-label={`把「${item.name}」换成哪个知识点`}
                          value={choice}
                          onChange={(event) => setChoice(event.target.value)}
                        >
                          <option value="">选一个想学的知识点</option>
                          {alternatives.map((node) => (
                            <option key={node.microKpId} value={node.microKpId}>
                              {node.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button
                        appearance="primary"
                        disabled={choice === '' || redirect.isPending}
                        onClick={() => {
                          redirect.mutate(
                            { recommended: item.microKpId, chosen: choice },
                            {
                              onSuccess: () => {
                                setRejecting(null);
                                setChoice('');
                              },
                            },
                          );
                        }}
                      >
                        {redirect.isPending ? '记下来…' : '就学这个'}
                      </Button>
                      <Button
                        appearance="subtle"
                        onClick={() => {
                          setRejecting(null);
                          setChoice('');
                        }}
                      >
                        取消
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Button appearance="secondary" onClick={() => navigate(`/map/${item.microKpId}`)}>
                        开始学
                      </Button>
                      <Button
                        appearance="subtle"
                        onClick={() => {
                          setRejecting(item.microKpId);
                          setChoice('');
                        }}
                      >
                        不学这个，换一个
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

        {items.length > 0 && (
          <Caption1 className={styles.subtle}>
            同一批推荐已经在地图上标出来（
            <Link to="/map">打开知识地图</Link>
            ），两处不会各说各的。
            {payload && ` 生成于 ${formatMoment(payload.generatedAt)}。`}
          </Caption1>
        )}
      </section>

      <Divider />

      {/* ---------------------------------------------------------------- */}
      {/* 今日学习摘要                                                      */}
      {/* ---------------------------------------------------------------- */}
      <section className={styles.section} aria-labelledby="board-summary">
        <div className={styles.sectionHead}>
          <Text id="board-summary" className={styles.sectionTitle} as="h2">
            今日学习摘要
          </Text>
        </div>

        {recommendations.isPending && <Spinner label="正在统计今天的作答…" />}

        {recommendations.isError && (
          <Caption1 className={styles.subtle}>作答记录读不到，这一节先空着。</Caption1>
        )}

        {/*
         * `available` 是唯一的判据，不是「数字是不是 0」。
         * 票 13 的教训：「今天答了 0 题」是结论，「作答记录还没接通」是未知，
         * 两者必须说成不同的话。数据源没接通时把 0 显示出来，是最典型的那种
         * 「看起来一切正常」的谎。
         */}
        {summary && summary.available === false && (
          <MessageBar>
            <MessageBarBody>
              作答记录尚未接通，今天的题数与新掌握数都还读不到 —— 这里空着不是因为
              你今天没做题。
            </MessageBarBody>
          </MessageBar>
        )}

        {summary && summary.available === true && (
          <Card className={styles.summary}>
            <div className={styles.stat}>
              <Caption1 className={styles.meta}>今天答了</Caption1>
              <Text className={styles.statValue}>{summary.answered}</Text>
              <Caption1 className={styles.meta}>题</Caption1>
            </div>
            <div className={styles.stat}>
              <Caption1 className={styles.meta}>碰到</Caption1>
              <Text className={styles.statValue}>{summary.knowledgePoints}</Text>
              <Caption1 className={styles.meta}>个知识点</Caption1>
            </div>
            <div className={styles.stat}>
              <Caption1 className={styles.meta}>新达到「已掌握」</Caption1>
              <Text className={styles.statValue}>{summary.newlyMastered}</Text>
              <Caption1 className={styles.meta}>个</Caption1>
            </div>
          </Card>
        )}
      </section>

      <Divider />

      {/* ---------------------------------------------------------------- */}
      {/* 常用指令                                                          */}
      {/* ---------------------------------------------------------------- */}
      <section className={styles.section} aria-labelledby="board-commands">
        <div className={styles.sectionHead}>
          <Text id="board-commands" className={styles.sectionTitle} as="h2">
            常用指令
          </Text>
          <Caption1 className={styles.subtle}>
            一句话就能开始；点进去，那句话在那页的输入框里说
          </Caption1>
        </div>

        <div className={styles.commands}>
          {COMMANDS.map((command) => (
            <button
              key={command.say}
              type="button"
              className={styles.command}
              onClick={() => navigate(command.to)}
            >
              <span className={styles.commandSay}>「{command.say}」</span>
              <Caption1 className={styles.meta}>{command.where}</Caption1>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * 一条理由的分段渲染：文字 / 数字 / 节点链接。
 *
 * 数字用 `<strong>`（字重）而不是只换颜色：票 13 与票 03 都要求信息不能只靠
 * 颜色编码，色觉障碍、黑白打印、高对比度模式下颜色都可能失效，字重不会。
 */
function ReasonLine({ reason }: { reason: RecommendationItem['reason'] }) {
  const styles = useStyles();
  const segments = renderReason(reason as Reason);
  return (
    <>
      {segments.map((segment, index) => {
        const key = `${segment.kind}-${index}`;
        if (segment.kind === 'number') {
          return (
            <strong key={key} className={styles.reasonNumber}>
              {segment.text}
            </strong>
          );
        }
        if (segment.kind === 'node') {
          return (
            <Link key={key} className={styles.reasonNode} to={`/map/${segment.microKpId}`}>
              {segment.text}
            </Link>
          );
        }
        return <span key={key}>{segment.text}</span>;
      })}
    </>
  );
}

/** 时间戳显示到分钟：秒没有意义，时区用浏览器本地。 */
function formatMoment(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}
