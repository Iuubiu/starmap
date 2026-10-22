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
  Caption1,
  Card,
  CardHeader,
  Divider,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type {
  AgentTurnResponseArtifact,
  AgentTurnResponseClarify,
} from '../api/generated/model';
import { InlineRich } from '../level/markdown';
import { masteryLabel } from '../mastery/labels';
import { openLevelFromCard, useAutoOpenLevel } from './auto-open';

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
  /**
   * 关卡卡「整卡是入口」的那一档样式（票 72）。
   *
   * 没有可见按钮：按钮会被读成「这一步是可选的」，而这张卡的整个意思就是
   * 「现在练这个」。所以可点性靠三件事表达 —— 手型指针、hover 时表面抬一档、
   * 键盘焦点时 2px 描边。描边颜色用 Fluent 的 `colorStrokeFocus2`（本仓主题把它
   * 映射到 `border-focus`），与卡面底色的对比度由 `auto-open.test.ts` 按两套
   * palette 的真实色值算过（都 ≥ 3:1）。
   */
  levelCardEntry: {
    cursor: 'pointer',
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      boxShadow: tokens.shadow16,
    },
    ':focus-visible': {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: '2px',
    },
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
  /* 票 81：问津的选项可以直接点。做成带边框的整行按钮而不是小 chip ——
     四个选项是整句话（「为了看懂论文或教材」），chip 会折成两行且点击面积小。 */
  choiceList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  choiceButton: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    width: '100%',
    padding: '8px 10px',
    textAlign: 'left',
    fontFamily: tokens.fontFamilyBase,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground2,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    cursor: 'pointer',
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground2Hover,
      /* 用 `border` 而不是 `borderColor`：Griffel 的类型把「已声明 border 简写
         之后的长手属性」收成 undefined，混用会直接编译失败（这里踩过）。 */
      border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1Hover}`,
    },
    ':focus-visible': {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: '2px',
    },
    ':disabled': {
      cursor: 'not-allowed',
      opacity: 0.55,
    },
  },
  choiceLetter: {
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightSemibold,
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

/**
 * 卡片外壳：标题 + 元信息 + 理由，四张卡共用。
 *
 * 给了 `entry` 时整张卡就是入口（票 72 的关卡卡）：`role="button"` + `tabIndex=0`
 * 让键盘 Tab 到得了，Enter / Space 都能开（`<a>` 语义在这里不合适 —— 它不导航，
 * 只是打开浮层）。没有 `entry` 的卡保持原样，不可点、不进 Tab 序列。
 */
function CardShell({
  kindLabel,
  title,
  rationale,
  children,
  entry,
}: {
  kindLabel: string;
  title: string;
  rationale: string;
  children: ReactNode;
  entry?: { readonly onActivate: () => void };
}) {
  const styles = useStyles();
  const activate = entry?.onActivate;
  return (
    <Card
      className={mergeClasses(styles.card, activate !== undefined && styles.levelCardEntry)}
      role={activate === undefined ? undefined : 'button'}
      tabIndex={activate === undefined ? undefined : 0}
      aria-label={activate === undefined ? undefined : `打开关卡：${title}`}
      onClick={activate}
      onKeyDown={
        activate === undefined
          ? undefined
          : (event) => {
              if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
                event.preventDefault();
                activate();
              }
            }
      }
    >
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
 * ## 为什么卡里**没有**「进入关卡」按钮（票 69）
 *
 * 早先这里有一个主按钮，点了跳整页 `/level/:levelId`。用户看过之后明确要求：
 * 关卡别再从对话里跳走，判定该练了就直接浮出来；对话里不要「打开」按钮。
 * 理由不只是审美 —— 一张卡产出了关卡却把「去做」退回给一个按钮，等于承认
 * 系统不知道他该不该现在练，而按钮还会在「正在打字」的时候和输入框抢注意力。
 *
 * 现在入口是自动的：卡挂载时 `useAutoOpenLevel` 把「该不该弹」交给
 * `auto-open.ts` 的纯函数判定（任何 level_card 都算该练了，同会话去重、
 * 3 秒撤销窗口、草稿挡弹），浮层由 t68 提供。这张卡自己只负责说清
 * 「练什么、多久、几题」，不再承担跳转。
 *
 * ## 没有按钮之后，这张卡还有用吗
 *
 * 有，而且它**就是**入口（票 72）。浮层关掉之后它仍留在学习日志里，
 * 整张卡可点、可 Tab、Enter / Space 就重开 —— 只是没有一颗写在明面上的按钮。
 * 为什么不做成按钮：卡的内容（多久、几题、第一步）本来就是给人做决定的依据，
 * 按钮会把它们降级成「按钮上方的说明文字」。要主动重进别的关卡，走地图节点、
 * 关卡市场、复验或深链 `/level/:id` —— 那四条是学习者自己找上门的，仍整页路由。
 *
 * 重开与自动弹是两件事：3 秒内关掉算「这次不练」，`dismissedLevelIds` 只挡自动弹，
 * `openLevelFromCard` 刻意不看它 —— 撤销的是「被推着练」，不是「能不能进」。
 *
 * 门控也不受影响：`/level/:levelId` 的入口锁与门控判定都在服务端
 * （`GatingService.evaluate`），绕过卡片也绕不过门控。
 */
function LevelCard({ artifact }: { artifact: Extract<AgentTurnResponseArtifact, { kind: 'level_card' }> }) {
  const styles = useStyles();
  useAutoOpenLevel(artifact);
  return (
    <CardShell
      kindLabel="关卡"
      title={artifact.title}
      rationale={artifact.rationale}
      entry={{ onActivate: () => openLevelFromCard(artifact.levelId) }}
    >
      <div className={styles.factGrid}>
        <Fact label="预计用时" value={`${artifact.estimatedMinutes} 分钟`} />
        <Fact label="题目数" value={`${artifact.itemCount} 题`} />
        <Fact label="第一步" value={STEP_KIND_LABEL[artifact.firstStepKind] ?? artifact.firstStepKind} />
        <Fact label="难度档" value={artifact.tier} />
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
/**
 * 问津卡的两组选项：**为什么学** + **自评熟练度**（票 84）。
 *
 * 为什么不各自立刻回调：两组答案要一起才成立。「为了考试」配上「完全没学过」
 * 与配上「很熟」会导向完全不同的首轮渲染（P1 完整样例 vs P3 直接出题），
 * 只拿到一半就发请求，等于让服务端猜另一半。
 *
 * 所以这里先在客户端选中，两组都选完才合成**一句可编辑的话**交回页面：
 * 学生仍能在输入框里改措辞再发，而不是被卡片替他把话说死。
 */
function ClarifyChoices({
  clarify,
  artifact,
  busy,
  onDone,
}: {
  clarify: AgentTurnResponseClarify;
  artifact: Extract<AgentTurnResponseArtifact, { kind: 'probe_form' }>;
  busy: boolean;
  onDone: (text: string) => void;
}) {
  const styles = useStyles();
  const [goal, setGoal] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const levels = clarify.selfLevelOptions ?? [];

  /* 没有自评组时退回 t79 的行为：点一下就提交，不多一步「继续」。 */
  if (levels.length === 0) {
    return (
      <div className={styles.choiceList} role="group" aria-label="问津选项">
        {artifact.choices.map((choice, index) => (
          <button
            key={index}
            type="button"
            className={styles.choiceButton}
            aria-label={`选择：${choice}`}
            disabled={busy}
            onClick={() => onDone(choice)}
          >
            <span className={styles.choiceLetter} aria-hidden="true">
              {`${String.fromCharCode(65 + index)}.`}
            </span>
            <span>{choice}</span>
          </button>
        ))}
      </div>
    );
  }

  const ready = goal !== null && level !== null;

  const group = (
    label: string,
    choices: string[],
    picked: string | null,
    pick: (v: string) => void,
    groupLabel: string,
  ) => (
    <div className={styles.choiceList} role="group" aria-label={groupLabel}>
      <Caption1>{label}</Caption1>
      {choices.map((choice, index) => (
        <button
          key={index}
          type="button"
          className={styles.choiceButton}
          aria-pressed={picked === choice}
          aria-label={`${groupLabel}：${choice}`}
          disabled={busy}
          onClick={() => pick(choice)}
        >
          <span className={styles.choiceLetter} aria-hidden="true">
            {picked === choice ? '✓' : String.fromCharCode(65 + index) + '.'}
          </span>
          <span>{choice}</span>
        </button>
      ))}
    </div>
  );

  return (
    <>
      {group('你想拿它来做什么', artifact.choices, goal, setGoal, '学习目标')}
      {group('这件事你现在的水平', levels, level, setLevel, '熟练度自评')}
      <button
        type="button"
        className={styles.choiceButton}
        disabled={busy || !ready}
        onClick={() => {
          if (goal === null || level === null) return;
          /* 合成一句人话交回页面填进输入框 —— 学生可改再发。 */
          onDone(`我${goal}，自评「${level}」。`);
        }}
      >
        <span className={styles.choiceLetter} aria-hidden="true">
          →
        </span>
        <span>{ready ? '就这样开始' : '先选完上面两组'}</span>
      </button>
    </>
  );
}

function ProbeFormCard({
  artifact,
  clarify,
  onClarifyChoice,
  clarifyChoiceBusy = false,
}: {
  artifact: Extract<AgentTurnResponseArtifact, { kind: 'probe_form' }>;
  clarify?: AgentTurnResponseClarify;
  /* 票 81：给了回调**且这是问津卡**才把选项渲染成按钮。没给（或不是问津卡）
     时保持纯文本行 ——
     追问卡的选项是**提示等级的可选答案**，学生要能自由组织措辞，不该被
     「点一下就提交」绑架；问津卡的四个选项是封闭答案，点一下才是最短路径。 */
  onClarifyChoice?: (text: string) => void;
  clarifyChoiceBusy?: boolean;
}) {
  const styles = useStyles();
  return (
    <CardShell
      /* 问津卡复用追问卡的外壳：区别只在标题与「为什么问」的位置少了提示
         等级的噪声 —— 确认意图不是解题，没有第几级提示可言。 */
      kindLabel={clarify ? '问津' : '追问'}
      title={artifact.title}
      rationale={artifact.rationale}
    >
      <Text className={styles.question}>{artifact.question}</Text>
      {clarify ? (
        <div className={styles.metaRow}>
          <Badge appearance="tint" color="brand">
            先确认一下
          </Badge>
          {/* 「为什么问」已经由 CardShell 的 rationale 渲染一次，这里不再重复。 */}
          <Caption1>答完立刻给关卡</Caption1>
        </div>
      ) : (
        <div className={styles.metaRow}>
          <Badge appearance="tint" color="warning">
            提示等级 {artifact.ladderLevel}/{artifact.ladderCap}
          </Badge>
          <Caption1>
            {artifact.inputKind === 'choice' ? '选择题' : '自由作答'}
          </Caption1>
        </div>
      )}
      {artifact.choices.length > 0 &&
        (clarify && onClarifyChoice ? (
          <ClarifyChoices
            clarify={clarify}
            artifact={artifact}
            busy={clarifyChoiceBusy}
            onDone={onClarifyChoice}
          />
        ) : (
          <div className={styles.neighborList}>
            {artifact.choices.map((choice, index) => (
              <Text key={index} className={styles.body}>
                {`${String.fromCharCode(65 + index)}. ${choice}`}
              </Text>
            ))}
          </div>
        ))}
    </CardShell>
  );
}

/**
 * 一张产物卡。
 *
 * `switch` 覆盖契约里全部四种 `kind`；`never` 分支让「契约新增了第五种卡
 * 但这里忘了渲染」变成编译错误而不是运行时的空白卡片。
 */
export function ArtifactCard({
  artifact,
  clarify,
  onClarifyChoice,
  clarifyChoiceBusy = false,
}: {
  artifact: AgentTurnResponseArtifact;
  clarify?: AgentTurnResponseClarify;
  /* 票 81：问津卡选项的一键作答。不传时选项仍是文本行（向后兼容）。 */
  onClarifyChoice?: (text: string) => void;
  clarifyChoiceBusy?: boolean;
}) {
  if (!artifact) return null;
  switch (artifact.kind) {
    case 'level_card':
      return <LevelCard artifact={artifact} />;
    case 'graph_focus':
      return <GraphFocusCard artifact={artifact} />;
    case 'progress_change':
      return <ProgressChangeCard artifact={artifact} />;
    case 'probe_form':
      return (
        <ProbeFormCard
          artifact={artifact}
          clarify={clarify}
          onClarifyChoice={onClarifyChoice}
          clarifyChoiceBusy={clarifyChoiceBusy}
        />
      );
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
