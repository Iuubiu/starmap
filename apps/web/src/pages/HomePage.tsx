/**
 * 首页：结构化回合（票 08）。
 *
 * ## 为什么不是聊天界面
 *
 * 票 08 的第一条验收就是「页面上不存在聊天式气泡列表」。这不是外观偏好：
 * 气泡界面的心理契约是「你问我答、我给你信息」，学生会一直问、一直得到
 * 看起来有用的回答，然后什么都没学会。这个页面的契约是**每轮产出一张卡**：
 * 一张关卡、一次图谱聚焦、一次进度变化、或一次追问。卡是要被**做**的，
 * 不是被读的。
 *
 * 所以布局是三段而不是两列：
 *   - 中间主工作区：**同一时刻只有一张卡**，新卡替换旧卡（不往下堆）；
 *   - 下方常驻输入框：随时可以说一句话触发下一轮；
 *   - 右侧学习日志：历史在这里，是「我走过的路」而不是消息流。
 *
 * ## 为什么刷新后还能回看
 *
 * 卡片和日志都在服务端（`app.agent_turns`），前端只有一个会话 id
 * （localStorage）。点日志里的某一行会 `GET /agent/turns/{id}` 把当时那张卡
 * 原样取回来 —— 不重新调模型，因为重放会漂移，历史会自己变形。
 *
 * ## 为什么输入框在底部而不是顶部
 *
 * 顶部输入框会让人以为这是搜索框（问一句、看一眼结果、关掉）；底部常驻
 * 输入框是「继续说」的位置，与卡片的对话关系一致。它不随内容滚动消失。
 */
import { useMemo, useRef, useState } from 'react';
import {
  Badge,
  Body1,
  Button,
  Caption1,
  Card,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useNavigate, useSearchParams } from 'react-router';
import {
  useAgentTurn,
  useAgentTurns,
  useNodeDetail,
  useNodeList,
  useSubmitTurn,
  useTierOverview,
} from '../api/queries';
import { ArtifactCard } from '../agent/ArtifactCard';
import { EvidencePanel } from '../agent/EvidencePanel';
import { ProbePanel } from '../agent/ProbePanel';
import { SessionPlanCard } from '../agent/SessionPlanCard';
import { TurnLog } from '../agent/TurnLog';
import { currentSessionId, resetSessionId } from '../agent/session';
import type { AgentTurnResponse } from '../api/generated/model';

/**
 * 首页的视觉层：液态玻璃。
 *
 * ## 为什么样式里几乎没有 tokens.* 了
 *
 * 造型语言（非对称大圆角、玻璃填充、内辉、液态沉积暗边）住在
 * `theme/glass.css` 的类上，颜色住在 `:root[data-sm-theme=...]` 的变量里。
 * Griffel 只保留**布局**（grid/flex/间距/溢出）。这样做的收益是具体的：
 * 换视觉不用改 TSX，且「深色/明亮」的差异只在 CSS 变量那一层存在，组件里
 * 不会出现 `isDark ? A : B`。
 */
const useStyles = makeStyles({
  page: {
    // 票 76：宽度由外壳的第 2 列（`min(760px, 100%)`）决定。
    // 页面自己再写一个 maxWidth + margin auto，就会与外壳的居中叠成两层算式 ——
    // 那正是「左右间隙不等」的来源之一。这里只负责列内布局。
    padding: '22px 0 0',
    display: 'grid',
    // 主工作区 + 学习日志。日志窄、固定，因为它是参照物不是主体。
    gridTemplateColumns: 'minmax(0, 1fr) minmax(240px, 300px)',
    gridTemplateRows: '1fr auto',
    gap: '18px',
    // 让输入框贴在可视区底部而不是页面底部。
    //
    // 这里曾经是 `calc(100vh - 48px)`（减掉 AppShell 的顶栏）。外壳改成
    // 左侧导航栏之后顶栏在宽屏上不存在、在窄屏上变成 48px 的顶部窄条，
    // 任何写死的减数都会在其中一档下错：宽屏少算 48px、窄屏正好。改成
    // `100%` 由父容器（`main`，高度已由外壳的 grid 行定死）决定，
    // 两档都对。
    minHeight: '100%',
    boxSizing: 'border-box',
  },
  stage: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    paddingBottom: '16px',
    minWidth: 0,
  },
  heading: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 600,
    lineHeight: '36px',
    letterSpacing: '-0.02em',
    color: 'var(--sm-text-primary)',
  },
  cardArea: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    alignItems: 'stretch',
  },
  visibleResponse: {
    fontSize: '14px',
    lineHeight: '22px',
    padding: '14px 16px',
    borderRadius: 'var(--sm-liquid-r-card)',
    backgroundColor: 'var(--sm-glass-fill-soft)',
    boxShadow: 'var(--sm-liquid-hi)',
    wordBreak: 'break-word',
  },
  actions: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  side: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '14px',
    paddingBottom: '16px',
    minWidth: 0,
    borderRadius: 'var(--sm-liquid-r-inset)',
    backgroundColor: 'var(--sm-glass-fill-soft)',
    boxShadow: 'var(--sm-liquid-hi)',
  },
  sideTitle: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '8px',
  },
  logScroll: {
    overflowY: 'auto',
    maxHeight: 'calc(100vh - 220px)',
  },
  /* 输入区是「沉在玻璃里」的一条，不是一条带边框的横杠。 */
  composer: {
    gridColumn: '1 / -1',
    position: 'sticky',
    bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    // 票 76：不再用负边距把输入区拉出列外（那会让它的左右间隙与正文不同，
    // 也把滚动宽度撑出列）。它现在与正文同宽，玻璃条铺满第 2 列。
    margin: 0,
    padding: '14px 0 18px',
    backgroundColor: 'var(--sm-glass-fill-strong)',
    WebkitBackdropFilter: 'blur(24px) saturate(170%)',
    backdropFilter: 'blur(24px) saturate(170%)',
    borderRadius: 'var(--sm-liquid-r-panel) var(--sm-liquid-r-panel) 0 0',
    boxShadow: 'var(--sm-liquid-hi)',
  },
  composerRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-end',
  },
  grow: { flex: 1, minWidth: 0 },
  /** 字数接近上限时才出现的剩余字数提示，右对齐在输入框下方。 */
  counter: {
    display: 'block',
    textAlign: 'right',
    color: 'var(--sm-text-tertiary)',
  },
  contextRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  errorCard: {
    borderLeft: '4px solid var(--sm-accent)',
    borderRadius: 'var(--sm-liquid-r-card)',
  },
  subtle: { color: 'var(--sm-text-tertiary)' },
});

/**
 * 「学习记录」页的空态输入框把话带到这里。
 *
 * 为什么走 `sessionStorage` 而不是 URL：这句话是**还没提交**的草稿，放进
 * 地址栏会被复制传播（会话内容不该出现在链接里），而且刷新后还会留着。
 * `sessionStorage` 的边界正好是「这个标签页的这一次导航」：取走就删，
 * 用户在首页刷新时不会突然看到上一页的半句话。
 *
 * 键名与票 76 的 `/learning` 页共用 `starmap.draft`。
 */
const DRAFT_KEY = 'starmap.draft';

function takeDraft(): string {
  try {
    const draft = window.sessionStorage.getItem(DRAFT_KEY);
    if (draft === null) return '';
    window.sessionStorage.removeItem(DRAFT_KEY);
    return draft;
  } catch {
    /* 隐私模式：读不到就当没有草稿，页面照常工作。 */
    return '';
  }
}

/** 一段可点选的上下文（知识点）。没选中任何点时显示提示。 */
const EMPTY_HINT =
  '还没有选定知识点。可以先在下面的地图上选一个，或者直接说你想学什么 —— 我会先给一张图谱卡。';

/** 日志里有记录、但那一轮还没取回来时说的话（刷新后的一瞬间会经过这里）。 */
const RESTORING_HINT = '正在把上一轮的卡片取回来…';

/**
 * 一句话的字数上限 —— 与服务端契约 `AgentTurnRequestSchema.utterance` 的
 * `.max(2000)` 保持一致。改契约时这里必须一起改，否则前端会放过后端要打回的长句。
 */
const UTTERANCE_MAX = 2000;

export function HomePage() {
  const styles = useStyles();
  const navigate = useNavigate();

  /**
   * 初始焦点：`/?kp=<microKpId>`。
   *
   * 首页的焦点原本**只能从上一张卡继承**（`currentKpId(shown)`），而冷启动时
   * 一张卡都没有 —— 于是第一轮只能拿到服务端自己挑的那个点。这使「选一个
   * 知识点 → 要一张关卡」在真实界面上没有入口：地图页的节点详情是终点，
   * 关卡卡片里的「进入关卡」也只能从一张已经产出过的卡上点。
   *
   * 所以焦点多一个来源：URL 参数。它只是**初始值**，不是优先级最高的来源 ——
   * 一旦首轮提交回来，卡片自带的 `microKpId` 就接管（否则学生换话题后焦点
   * 会死在 URL 上，而地址栏还挂着他第一次点进来的那个点）。
   */
  const [searchParams] = useSearchParams();
  const initialFocus = searchParams.get('kp');

  const [sessionId, setSessionId] = useState<string>(() => currentSessionId());
  const [utterance, setUtterance] = useState(takeDraft);
  /*
   * 最后一次**真正发出去**的那句话。
   *
   * 不能拿 `utterance` 当重试的素材：提交成功后输入框会被清空（这是对的，
   * 否则学生得手动删），于是「再试一次」在那一刻读到的是空串。早先的实现
   * 用 `text.trim() || '再试一次'` 兜底，结果真的把「再试一次」这四个字当成
   * 学习者的话发了出去 —— 学生得到一个基于不存在的问题的卡，而且日志里
   * 记着一句他从没说过的话。
   */
  const [lastSent, setLastSent] = useState('');
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);

  const nodes = useNodeList({ limit: 200 });
  const history = useAgentTurns(sessionId);
  const submit = useSubmitTurn(sessionId);
  /**
   * 当前档位（票 12）。
   *
   * 这里不再写死 `tier:'P1'`：服务端把 `tier` 写进提示词的「水平档」一行，
   * 它也是追问阶梯起始层的来源（engine 的 `TIER_LADDER`）。写死 P1 的后果是
   * ——一个已经被定到 P3 的学习者，关卡按 P3 渲染、智能体的追问却仍从 L1 开始，
   * 而且他自己开的那次追问会话会被当成零基础。
   *
   * 拿不到档位时回落 `'P1'`（与契约的 `default` 一致）：P1 是**最完整的示范**，
   * 宁可多给一步提示，也不要让一个刚打开页面的人被当成有工程经验。
   */
  const tierOverview = useTierOverview();
  const learnerTier = tierOverview.payload?.tier ?? 'P1';

  const logItems = history.payload?.items ?? [];

  /**
   * 当前展示的卡：优先「刚提交的那张」，否则「日志里点开的那张」，
   * 最后退回「日志里的最后一轮」。
   *
   * 第三个来源是**刷新后恢复**用的（票 20 的 S9）。前两个来源都活在内存里：
   * `submit.data` 是这一次提交的结果，`activeTurnId` 是这一次点击的结果。
   * 刷新页面（或关掉标签页重开）后两者都归零，而服务端的日志还在 —— 于是
   * 学生看到一张写着「还没有选定知识点」的空卡，下面却写着「共 1 轮记录」。
   * 那句话与事实矛盾：他不但有记录，地址栏里 `?kp=` 也还在。
   *
   * 所以恢复时把最后一轮当作「点开的那一轮」：日志按 `ordinal ASC` 取，
   * 最后一轮就是最近的一轮，与「刷新前屏幕上是哪张卡」一致。
   */
  const submitted: AgentTurnResponse | undefined = submit.data;
  // `.at(-1)` 而不是 `[length - 1]`：本项目开了 `noUncheckedIndexedAccess`，
  // 下标访问的结果是 `T | undefined`，直接取 `.turnId` 会报 TS2532。
  const latestTurnId = logItems.at(-1)?.turnId;
  const selectedTurnId = activeTurnId ?? submitted?.turnId ?? latestTurnId;
  const recalled = useAgentTurn(
    // 只有「从日志点开」且不是刚提交的那张时才需要回读服务端。
    selectedTurnId && selectedTurnId !== submitted?.turnId ? selectedTurnId : undefined,
  );

  const shown: AgentTurnResponse | undefined =
    submitted && selectedTurnId === submitted.turnId ? submitted : recalled.payload;

  const focusedKpId = focusKpId(
    // 只有「刚提交的那张」与「从日志里主动点开的那一轮」才算是学生的选择；
    // 刷新后自动恢复的卡不算（否则地址栏里的 `?kp=` 会被历史静默劫持）。
    activeTurnId || (submitted && selectedTurnId === submitted.turnId) ? shown : undefined,
    initialFocus,
  );
  const nodeItems = useMemo(() => nodes.payload?.items ?? [], [nodes.payload]);
  /**
   * 焦点知识点的名字。
   *
   * `?kp=` 带进来的点可能不在 `useNodeList` 取回的那一页里（节点列表按排序取
   * 前 N 条，`kp-bool` 这类 id 落在后面时取不到），徽标就只剩一串 id —— 对学习者
   * 是无意义的。所以焦点点不在列表里时，按 id 单独取一次名字。
   */
  const focusedNode = useNodeDetail(
    focusedKpId && !nodeItems.some((n) => n.microKpId === focusedKpId) ? focusedKpId : undefined,
  );

  const onSelectLog = (turnId: string) => {
    setActiveTurnId(turnId);
    setShowEvidence(false);
  };

  const onRetry = () => {
    // 「再试一次」重发的是**同一句话**：降级轮和一次不满意的卡都该能重来一次，
    // 而不是逼学生把话重新打一遍（重打往往会改措辞，那就不是同一轮了）。
    //
    // 三个来源按可信度排序：刚提交的那句（`lastSent`）→ 日志里那一轮的原话
    // → 输入框里现有的内容。绝不用占位文本兜底：发一句学生没说过的话，
    // 比让他重打一遍更糟。
    const recalled = lastUtterance(shown, history.payload);
    const target = (lastSent || recalled || utterance).trim();
    if (!target) return;
    setShowEvidence(false);
    submit.mutate({ utterance: target, microKpId: focusedKpId, tier: learnerTier });
  };

  const onSubmit = () => {
    const text = utterance.trim();
    if (!text || submit.isPending) return;
    setActiveTurnId(null);
    setShowEvidence(false);
    setLastSent(text);
    submit.mutate(
      { utterance: text, microKpId: focusedKpId, tier: learnerTier },
      { onSuccess: () => setUtterance('') },
    );
  };

  /**
   * 票 81：问津卡上点选一项 = 把那一项当成这一轮的话发出去。
   *
   * 用 `clarifyGuard` 而不是只看 `submit.isPending`：`mutate` 之后到 React 重渲
   * （按钮变 disabled）之间有一个窗口，连点两次会在同一个窗口里各发一次。这个
   * ref 在点击回调里**同步**置位，等这一轮结束（无论成功失败）再放开。
   *
   * 不走 `onSubmit`：它读的是输入框里的字。这里发的是选项原文，输入框不该被
   * 写入任何东西；成功后照旧清空（上一轮提交已经清过一次，这里再清一次是幂等的）。
   */
  const clarifyGuard = useRef(false);
  const onClarifyChoice = (text: string) => {
    const value = text.trim();
    if (!value || clarifyGuard.current || submit.isPending) return;
    clarifyGuard.current = true;
    setActiveTurnId(null);
    setShowEvidence(false);
    setLastSent(value);
    submit.mutate(
      { utterance: value, microKpId: focusedKpId, tier: learnerTier },
      {
        onSuccess: () => setUtterance(''),
        onSettled: () => {
          clarifyGuard.current = false;
        },
      },
    );
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 提交、Shift+Enter 换行 —— 这是输入框不是聊天窗，但底部的行为约定
    // 和聊天框一致，不一致才是意外。
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };

  const newSession = () => {
    setSessionId(resetSessionId());
    setActiveTurnId(null);
    setShowEvidence(false);
    submit.reset();
    setUtterance('');
    setLastSent('');
  };

  const activeId = shown?.turnId ?? null;

  return (
    <div className={styles.page}>
      <div className={styles.stage}>
        <div className={styles.heading}>
          <Text className={styles.title} as="h1">
            学习
          </Text>
          <Body1>
            说一句你想学什么，或者你卡在哪。每轮产出一张卡片——关卡、知识结构、进度变化，或一次追问。
          </Body1>
        </div>

        {nodes.isError && (
          <MessageBar intent="error">
            <MessageBarBody>
              无法读取知识点：{nodes.error instanceof Error ? nodes.error.message : '未知错误'}
            </MessageBarBody>
          </MessageBar>
        )}

        {submit.isPending && (
          <Card>
            <Spinner label="正在生成这一轮的卡片…" />
          </Card>
        )}

        {submit.isError && (
          <MessageBar intent="error">
            <MessageBarTitle>这一轮没能提交</MessageBarTitle>
            <MessageBarBody>
              {submit.error instanceof Error ? submit.error.message : '未知错误'}
              <br />
              你的话没有丢，可以直接重试。
            </MessageBarBody>
          </MessageBar>
        )}

        {!submit.isPending && shown && (
          <div className={styles.cardArea}>
            {shown.visibleResponse && (
              <Text className={styles.visibleResponse}>{shown.visibleResponse}</Text>
            )}

            {shown.artifact && (
              <ArtifactCard
                artifact={shown.artifact}
                clarify={shown.clarify}
                onClarifyChoice={onClarifyChoice}
                clarifyChoiceBusy={submit.isPending}
              />
            )}

            {shown.errorCard && (
              <Card className={styles.errorCard}>
                <Text weight="semibold" as="h3">
                  {shown.errorCard.title}
                </Text>
                <Body1>{shown.errorCard.detail}</Body1>
                <Caption1 className={styles.subtle}>问题编号 {shown.errorCard.debugId}</Caption1>
              </Card>
            )}

            {shown.languageCheck && !shown.languageCheck.ok && (
              <MessageBar intent="warning">
                <MessageBarBody>
                  这段回复里混入了未加注的英文：
                  {shown.languageCheck.offenders.slice(0, 5).join('、')}
                  {shown.languageCheck.offenders.length > 5 ? ' 等' : ''}
                </MessageBarBody>
              </MessageBar>
            )}

            {/* 问津卡不走 ProbePanel：回答它不需要「提交一次追问答复」这个仪式，
                选项已经在卡片里点一下就发下一轮。而 `probeId` 是 `clarify-<turnId>`
                这种伪 id，服务端没有对应记录，把它交给 ProbePanel 只会在学生
                面前摆出第二组一模一样的选项、点下去还 404。 */}
            {shown.artifact?.kind === 'probe_form' && !shown.clarify && (
              <ProbePanel
                key={shown.artifact.probeId}
                probeId={shown.artifact.probeId}
                microKpId={shown.artifact.microKpId}
                initialQuestion={shown.artifact.question}
                initialLevel={shown.artifact.ladderLevel}
                initialCap={shown.artifact.ladderCap}
                inputKind={shown.artifact.inputKind}
                choices={shown.artifact.choices}
              />
            )}

            <div className={styles.actions}>
              {shown.actions.map((action) => (
                <Button
                  key={action.kind}
                  appearance={action.kind === 'retry' ? 'primary' : 'secondary'}
                  disabled={!action.enabled || (action.kind === 'retry' && submit.isPending)}
                  onClick={() => {
                    if (action.kind === 'retry') onRetry();
                    else setShowEvidence((previous) => !previous);
                  }}
                >
                  {action.label}
                </Button>
              ))}
              {shown.retryCount > 0 && (
                <Caption1 className={styles.subtle}>已自动重试过一次</Caption1>
              )}
            </div>

            {showEvidence && (
              <>
                <Divider />
                <EvidencePanel turnId={shown.turnId} />
              </>
            )}
          </div>
        )}

        {!submit.isPending && !shown && (
          <Card>
            {/*
             * 空态文案要按「日志里有没有东西」分岔。
             *
             * 日志非空时再说「还没有选定知识点」是**误导**：学生有记录、有焦点，
             * 只是那一轮正在从服务端取回来。这时候该说的是「正在取回上一轮」，
             * 而不是让他以为记录丢了。
             */}
            <Body1>{logItems.length > 0 ? RESTORING_HINT : EMPTY_HINT}</Body1>
            <Caption1 className={styles.subtle}>
              当前会话 {sessionId.slice(0, 12)}… · 共 {logItems.length} 轮记录
            </Caption1>
          </Card>
        )}
      </div>

      <div className={styles.side}>
        <div className={styles.sideTitle}>
          <Text weight="semibold">学习日志</Text>
          <Button appearance="subtle" size="small" onClick={newSession}>
            开新会话
          </Button>
        </div>
        <SessionPlanCard />
        <DispensableHint />
        <div className={styles.logScroll}>
          <TurnLog
            items={logItems}
            isPending={history.isPending}
            activeTurnId={activeId}
            onSelect={onSelectLog}
          />
        </div>
      </div>

      <div className={styles.composer}>
        <div className={styles.contextRow}>
          <Caption1 className={styles.subtle}>当前知识点</Caption1>
          {focusedKpId ? (
            <Badge appearance="tint" color="brand">
              {nodeItems.find((n) => n.microKpId === focusedKpId)?.name ??
                focusedNode.payload?.node.name ??
                focusedKpId}
            </Badge>
          ) : (
            <Badge appearance="outline">未选定</Badge>
          )}
          <Button appearance="subtle" size="small" onClick={() => navigate('/map')}>
            去地图选
          </Button>
        </div>
        <div className={styles.composerRow}>
          <Textarea
            className={styles.grow}
            value={utterance}
            onChange={(_, data) => setUtterance(data.value)}
            onKeyDown={onKeyDown}
            placeholder="说说你想学什么，或者你卡在哪一步。（Enter 提交，Shift+Enter 换行）"
            resize="vertical"
            rows={2}
            aria-label="这一轮想说的话"
            // 契约里 utterance 上限 2000 字（packages/api-contract/src/domains/agent.ts）。
            // 不设 maxLength 时超长的话能敲进去，提交后才被后端 400 打回，
            // 而错误条只说「请求体不合法」—— 学生既不知道为什么，也不知道该删到多少。
            // 在这里挡住，并给出剩余字数，让人当场看得见边界。
            maxLength={UTTERANCE_MAX}
            disabled={submit.isPending}
          />
          <Button
            appearance="primary"
            onClick={onSubmit}
            disabled={submit.isPending || utterance.trim() === ''}
          >
            {submit.isPending ? '生成中…' : '提交这一轮'}
          </Button>
        </div>
        {utterance.length > UTTERANCE_MAX * 0.8 && (
          <Text size={200} className={styles.counter}>
            还可以写 {UTTERANCE_MAX - utterance.length} 字
          </Text>
        )}
      </div>
    </div>
  );
}

/**
 * 显示用的一行提示。
 *
 * 刻意做成独立小组件而不是内联：它的措辞要随状态变（有记录 / 没记录），
 * 内联三段三元表达式比一个组件更难读。
 */
function DispensableHint() {
  const styles = useStyles();
  return (
    <Caption1 className={styles.subtle}>
      每一条是一次真实提交，点开可以回看当时那张卡。
    </Caption1>
  );
}

/**
 * 当前聚焦的知识点。
 *
 * 两个来源，按可信度排序：
 *
 * 1. **学生自己选的那个点** —— 刚提交的那张卡带的，或他从日志里主动点开的
 *    那一轮带的。这是「我刚才在说这个」的直接证据。
 * 2. **地址栏的 `?kp=`** —— 从知识点详情页「问助手」跳过来时带的那个点。
 *
 * 刷新后**自动恢复**的那张卡不参与：它只是屏幕上显示的东西，不是学生的选择。
 * 让它参与的话，一个带着 `?kp=触发器` 进来的人，会因为历史里最后一轮恰好是
 * 布尔代数而被静默拽回旧话题 —— 而地址栏还写着触发器。
 *
 * `artifact.microKpId` 可能是空串（服务端也没得推荐时给的那张陈述卡），
 * 空串要当「没有」而不是当一个知识点 id 发回服务端。
 */
function focusKpId(
  explicitTurn: AgentTurnResponse | undefined,
  initialFocus: string | null,
): string | null {
  const fromCard = currentKpId(explicitTurn);
  if (fromCard) return fromCard;
  return initialFocus !== null && initialFocus !== '' ? initialFocus : null;
}

/** 当前聚焦的知识点：卡里带的那个。 */
function currentKpId(turn: AgentTurnResponse | undefined): string | null {
  const artifact = turn?.artifact;
  if (!artifact) return null;
  return artifact.microKpId === '' ? null : artifact.microKpId;
}

/**
 * 重试时要重发的那句话。
 *
 * 优先用服务端日志里的 `utterance`（点开旧卡时前端已经没有那个输入框里
 * 原本的内容了）；拿不到就退回一个明确的占位，绝不静默发一句空话。
 */
function lastUtterance(
  turn: AgentTurnResponse | undefined,
  history: { items: { turnId: string; utterance: string }[] } | undefined,
): string {
  if (turn && history) {
    const match = history.items.find((item) => item.turnId === turn.turnId);
    if (match) return match.utterance;
  }
  return '';
}
