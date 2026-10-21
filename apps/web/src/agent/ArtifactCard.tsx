/**
 * 四张产物卡的渲染。
 *
 * ## 为什么不是聊天气泡
 *
 * 票 08 的硬约束：页面上不存在聊天式气泡列表，产物渲染在屏幕中央主工作区，
 * 一次只有一张卡，新卡替换旧卡而不是往下堆。气泡之所以被排除，是因为它把
 * 「说」当成主要输出，而学习工作站的主要输出是**可操作的东西**：一张可以去
 * 做的关卡、一张能看懂的图、一个分数为什么变了的解释、一道要你回答的问题。
 * 气泡能承载文字，承载不了这些。
 *
 * ## 为什么每张卡都有 `rationale`
 *
 * 四张卡都要回答「我为什么看到这个」。模型给出意图和措辞，但卡片里的事实
 * （关卡名、分数、邻居）全部由服务端查库填入 —— 模型会编数字，而这些数字
 * 学生要当真。
 *
 * ## 为什么卡里不出现推理字段
 *
 * 契约 schema 上根本没有这些字段（`artifact.ts` 的 `INTERNAL_KEYS` 又在
 * 校验前递归剥离了一遍）。所以这里不需要「过滤」逻辑：渲染函数只读它认识
 * 的字段，模型多塞的键到不了 DOM。票 08 的验收是「不得出现在 DOM 里」，
 * 两道防线比一道提示词可靠。
 */
import {
  Badge,
  Body1,
  Button,
  Caption1,
  Card,
  CardHeader,
  Divider,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { AgentTurnResponseArtifact } from '../api/generated/model';
import { InlineRich } from '../level/markdown';
import { masteryLabel } from '../mastery/labels';

const useStyles = makeStyles({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '20px 22px',
    // 卡片是屏幕中央的主工作区，宽度受控：一行超过 80 个中文字符读者会串行。
    width: '100%',
    maxWidth: '720px',
    margin: '0 auto',
    boxShadow: tokens.shadow8,
  },
  headerRow: {
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
  metaRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  rationale: {
    color: tokens.colorNeutralForeground2,
    lineHeight: tokens.lineHeightBase300,
  },
  factGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '10px',
  },
  fact: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '8px 10px',
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  factValue: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
  },
  neighborList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  neighborRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  body: {
    whiteSpace: 'pre-wrap',
    lineHeight: tokens.lineHeightBase400,
  },
  question: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightMedium,
    lineHeight: tokens.lineHeightBase400,
    padding: '12px 14px',
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
  },
});

/**
 * 掌握度状态词表已移到 `../mastery/labels`（前端唯一一份，类型 `Record<MasteryState,
 * string>`）。
 *
 * 原来这里导出一份 `MASTERY_STATE_LABEL`，注释写着「放在这里而不是各处复制，
 * 避免页面上两种叫法」—— 但事实上别处又各自复制了四份，而且这一份把 `attempted`
 * 写成了「试过」，与其余几份的「刚接触」不一致；还多写了一个契约里不存在的
 * `unfamiliar` 死键。想靠「大家都来 import 我这里」阻止分叉，不如让它就在一个
 * 明确叫 `mastery/` 的地方，并靠 `Record<MasteryState, string>` 让漏写变成编译错误。
 */
const STEP_KIND_LABEL: Record<string, string> = {
  guide: '引导',
  detail: '详解',
  probe: '追问',
  deepen: '深化',
  reteach: '重讲',
  quiz: '测验',
  summary: '小结',
};

const RELATION_LABEL: Record<string, string> = {
  prereq: '先修',
  related: '相关',
  part_of: '包含',
};

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function Fact({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <div className={styles.fact}>
      <Caption1>{label}</Caption1>
      <Text className={styles.factValue}>{value}</Text>
    </div>
  );
}

/** 卡片外壳：标题 + 元信息 + 理由，四张卡共用。 */
function CardShell({
  kindLabel,
  title,
  rationale,
  children,
}: {
  kindLabel: string;
  title: string;
  rationale: string;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <Card className={styles.card}>
      <div className={styles.headerRow}>
        <Badge appearance="tint" color="brand">
          {kindLabel}
        </Badge>
        <Text className={styles.title} as="h2">
          {title}
        </Text>
      </div>
      <Divider />
      {children}
      <Body1 className={styles.rationale}>{rationale}</Body1>
    </Card>
  );
}

/**
 * 关卡卡：这张卡要能让人「决定去不去做」，所以给时长、题量、第一步是什么。
 *
 * ## 为什么卡里必须有一个「进入关卡」按钮
 *
 * 这张卡的全部意义是「让人去做题」。在此之前它只陈列四个数字，学生看完
 * 只能自己去顶栏点「知识地图」、找到同一个知识点、滚到关卡列表、再点一次
 * —— 那条路要求他自己记得刚才那张卡说的是哪个点。卡片产出了关卡却没给
 * 入口，等于把「去做」这一步退回给记忆。
 *
 * 门控不受影响：`/level/:levelId` 是 `LevelPage`，它的入口锁与门控判定都在
 * 服务端（`GatingService.evaluate`），绕过卡片也绕不过门控。
 */
function LevelCard({ artifact }: { artifact: Extract<AgentTurnResponseArtifact, { kind: 'level_card' }> }) {
  const styles = useStyles();
  const navigate = useNavigate();
  return (
    <CardShell kindLabel="关卡" title={artifact.title} rationale={artifact.rationale}>
      <div className={styles.factGrid}>
        <Fact label="预计用时" value={`${artifact.estimatedMinutes} 分钟`} />
        <Fact label="题目数" value={`${artifact.itemCount} 题`} />
        <Fact label="第一步" value={STEP_KIND_LABEL[artifact.firstStepKind] ?? artifact.firstStepKind} />
        <Fact label="难度档" value={artifact.tier} />
      </div>
      <div>
        <Button appearance="primary" onClick={() => navigate(`/level/${artifact.levelId}`)}>
          进入关卡
        </Button>
      </div>
    </CardShell>
  );
}

/** 图谱聚焦：围绕一个点，它的上游下游都是什么状态。 */
function GraphFocusCard({
  artifact,
}: {
  artifact: Extract<AgentTurnResponseArtifact, { kind: 'graph_focus' }>;
}) {
  const styles = useStyles();
  return (
    <CardShell kindLabel="图谱" title={artifact.title} rationale={artifact.rationale}>
      {artifact.neighbors.length === 0 ? (
        <Text className={styles.rationale}>这个知识点还没有登记关联的邻居。</Text>
      ) : (
        <div className={styles.neighborList}>
          {artifact.neighbors.map((neighbor, index) => (
            <div key={`${neighbor.microKpId}-${index}`} className={styles.neighborRow}>
              <Badge appearance="outline" size="small">
                {neighbor.direction === 'in' ? '↑ 上游' : '↓ 下游'}
              </Badge>
              <Badge appearance="tint" size="small" color="informative">
                {RELATION_LABEL[neighbor.relation] ?? neighbor.relation}
              </Badge>
              <Text>{neighbor.name}</Text>
              <Caption1>
                {masteryLabel(neighbor.state)}
              </Caption1>
            </div>
          ))}
        </div>
      )}
    </CardShell>
  );
}

/** 进度变化：两个分数的对照。用前后并列而不是只给当前值 —— 变化才是信息。 */
function ProgressChangeCard({
  artifact,
}: {
  artifact: Extract<AgentTurnResponseArtifact, { kind: 'progress_change' }>;
}) {
  const styles = useStyles();
  const { before, after } = artifact;
  return (
    <CardShell kindLabel="进度" title={artifact.title} rationale={artifact.reason}>
      <div className={styles.factGrid}>
        <Fact label="之前掌握度" value={percent(before.achieved)} />
        <Fact label="当前掌握度" value={percent(after.achieved)} />
        <Fact label="当前状态" value={masteryLabel(after.state)} />
        <Fact label="作答证据" value={`${artifact.evidenceCount} 条`} />
      </div>
    </CardShell>
  );
}

/**
 * 追问表单：每轮**只能问一个问题**。
 *
 * 这里不渲染作答控件 —— 作答走 `ProbePanel`（它要发 `POST /agent/probes/:id/replies`
 * 并拿回下一轮状态）。这张卡负责说清「问你什么、这是第几级提示、上限几级」。
 */
function ProbeFormCard({
  artifact,
}: {
  artifact: Extract<AgentTurnResponseArtifact, { kind: 'probe_form' }>;
}) {
  const styles = useStyles();
  return (
    <CardShell kindLabel="追问" title={artifact.title} rationale={artifact.rationale}>
      <Text className={styles.question}>{artifact.question}</Text>
      <div className={styles.metaRow}>
        <Badge appearance="tint" color="warning">
          提示等级 {artifact.ladderLevel}/{artifact.ladderCap}
        </Badge>
        <Caption1>
          {artifact.inputKind === 'choice' ? '选择题' : '自由作答'}
        </Caption1>
      </div>
      {artifact.choices.length > 0 && (
        <div className={styles.neighborList}>
          {artifact.choices.map((choice, index) => (
            <Text key={index} className={styles.body}>
              {`${String.fromCharCode(65 + index)}. ${choice}`}
            </Text>
          ))}
        </div>
      )}
    </CardShell>
  );
}

/**
 * 一张产物卡。
 *
 * `switch` 覆盖契约里全部四种 `kind`；`never` 分支让「契约新增了第五种卡
 * 但这里忘了渲染」变成编译错误而不是运行时的空白卡片。
 */
export function ArtifactCard({ artifact }: { artifact: AgentTurnResponseArtifact }) {
  if (!artifact) return null;
  switch (artifact.kind) {
    case 'level_card':
      return <LevelCard artifact={artifact} />;
    case 'graph_focus':
      return <GraphFocusCard artifact={artifact} />;
    case 'progress_change':
      return <ProgressChangeCard artifact={artifact} />;
    case 'probe_form':
      return <ProbeFormCard artifact={artifact} />;
    default: {
      const exhaustive: never = artifact;
      return exhaustive;
    }
  }
}

/** 供「看依据」弹层等处复用的行内富文本包装。 */
export function RichLine({ text }: { text: string }) {
  const styles = useStyles();
  return (
    <Text className={styles.body}>
      <InlineRich text={text} />
    </Text>
  );
}
