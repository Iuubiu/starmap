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
import { useMemo, useState } from 'react';
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
import { useNavigate } from 'react-router';
import { useAgentTurn, useAgentTurns, useNodeList, useSubmitTurn } from '../api/queries';
import { ArtifactCard } from '../agent/ArtifactCard';
import { EvidencePanel } from '../agent/EvidencePanel';
import { ProbePanel } from '../agent/ProbePanel';
import { TurnLog } from '../agent/TurnLog';
import { currentSessionId, resetSessionId } from '../agent/session';
import type { AgentTurnResponse } from '../api/generated/model';

const useStyles = makeStyles({
  page: {
    padding: '24px 32px 0',
    maxWidth: '1180px',
    margin: '0 auto',
    display: 'grid',
    // 主工作区 + 学习日志。日志窄、固定，因为它是参照物不是主体。
    gridTemplateColumns: 'minmax(0, 1fr) minmax(240px, 300px)',
    gridTemplateRows: '1fr auto',
    gap: '20px',
    // 减去 AppShell 顶栏高度，让输入框贴在可视区底部而不是页面底部。
    minHeight: 'calc(100vh - 48px)',
    boxSizing: 'border-box',
  },
  stage: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    paddingBottom: '16px',
    minWidth: 0,
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
  cardArea: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    alignItems: 'stretch',
  },
  visibleResponse: {
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
    padding: '12px 14px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
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
    paddingBottom: '16px',
    minWidth: 0,
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
  composer: {
    gridColumn: '1 / -1',
    position: 'sticky',
    bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px 0 16px',
    backgroundColor: tokens.colorNeutralBackground1,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  composerRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-end',
  },
  grow: { flex: 1, minWidth: 0 },
  contextRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  errorCard: {
    borderLeft: `4px solid ${tokens.colorPaletteRedBorderActive}`,
  },
  subtle: { color: tokens.colorNeutralForeground3 },
});

/** 一段可点选的上下文（知识点）。没选中任何点时显示提示。 */
const EMPTY_HINT =
  '还没有选定知识点。可以先在下面的地图上选一个，或者直接说你想学什么 —— 我会先给一张图谱卡。';

export function HomePage() {
  const styles = useStyles();
  const navigate = useNavigate();

  const [sessionId, setSessionId] = useState<string>(() => currentSessionId());
  const [utterance, setUtterance] = useState('');
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

  // 当前展示的卡：优先「刚提交的那张」，否则「日志里点开的那张」。
  const submitted: AgentTurnResponse | undefined = submit.data;
  const selectedTurnId = activeTurnId ?? submitted?.turnId ?? undefined;
  const recalled = useAgentTurn(
    // 只有「从日志点开」且不是刚提交的那张时才需要回读服务端。
    selectedTurnId && selectedTurnId !== submitted?.turnId ? selectedTurnId : undefined,
  );

  const shown: AgentTurnResponse | undefined =
    submitted && selectedTurnId === submitted.turnId ? submitted : recalled.payload;

  const nodeItems = useMemo(() => nodes.payload?.items ?? [], [nodes.payload]);

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
    submit.mutate({ utterance: target, microKpId: currentKpId(shown), tier: 'P1' });
  };

  const onSubmit = () => {
    const text = utterance.trim();
    if (!text || submit.isPending) return;
    setActiveTurnId(null);
    setShowEvidence(false);
    setLastSent(text);
    submit.mutate(
      { utterance: text, microKpId: currentKpId(shown), tier: 'P1' },
      { onSuccess: () => setUtterance('') },
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

  const logItems = history.payload?.items ?? [];
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

            {shown.artifact && <ArtifactCard artifact={shown.artifact} />}

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

            {shown.artifact?.kind === 'probe_form' && (
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
            <Body1>{EMPTY_HINT}</Body1>
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
          {currentKpId(shown) ? (
            <Badge appearance="tint" color="brand">
              {nodeItems.find((n) => n.microKpId === currentKpId(shown))?.name ??
                currentKpId(shown)}
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
