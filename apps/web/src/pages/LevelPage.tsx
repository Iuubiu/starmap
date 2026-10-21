/**
 * 关卡播放页 `/level/:levelId` —— 票 04 / 05 的落点。
 *
 * 页面只做四件事：取 spec、把当前段渲染出来、把作答与推进交给 `./level/flow`
 * 这个纯状态机、把每次作答发给后端记账。所有业务规则（什么时候跳过深究、
 * 哪些段不计分、反馈从哪来）都在状态机里且被单测覆盖，组件里不写第二份。
 *
 * ## 为什么判对错在前端，记掌握度在后端
 *
 * 反馈必须**立即**出现（票 04 验收 3），所以对错由 `flow.judgeAnswer` 就地算，
 * 反馈取自 spec 里作者预写的 `explainCorrect`/`explainWrong` —— 零网络、零模型。
 *
 * 但掌握度不能由浏览器算（票 05）：真源是后端拿 `level_items.answer` 重判一次
 * 再写 `app.attempts`。前端这份 `correct` 只用于渲染，**不随请求上传** ——
 * 上传了就等于把证据交给客户端，而那正是掌握度唯一不能让的一环。
 *
 * 两条路径互不阻塞：后端挂了，学习者照样能答题、照样看反馈，只是那条证据没记上，
 * 页面会明说。反过来若为了等后端而卡住反馈，就是把票 04 的验收换成了票 05 的容错。
 *
 * ## 为什么失败后不自动重试
 *
 * `POST /attempts` 没有幂等键，每次成功都会插一行。若一次请求其实已经落库、
 * 只是响应在路上丢了，自动重试会把它记成第二次作答 —— `attempt_no` 与 `current`
 * 都会假性走高，而这种脏数据没有任何后台任务会发现。宁可丢一条证据并如实告知，
 * 也不留一条查不出来的假证据。
 *
 * ## 进度真源仍然不是 localStorage
 *
 * 这一版只在**本次会话内**保留 `flow` 状态；刷新页面仍会重来。把 `attempts` 回放成
 * 「上次停在第几段」是票 07 复验与票 12 定级要一起定的事，现在先不做，也就不必
 * 处理「两份进度谁覆盖谁」这种永远比想象中难的合并规则。
 */
import { useMemo, useState } from 'react';
import {
  Badge,
  Body1,
  Button,
  Card,
  CardHeader,
  Divider,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useNavigate, useParams } from 'react-router';
import {
  useEvaluateGate,
  useGateHistory,
  useLevel,
  useMastery,
  useSubmitAttempt,
  useTierLevelPlan,
} from '../api/queries';
import type {
  GateEvaluation,
  LevelSpec,
  TierLevelPlanResponse,
  UnlockState,
} from '../api/queries';
import { ApiClientError } from '../api/fetcher';
import {
  STEP_KIND_LABEL,
  advance,
  correctCountInStep,
  countedRecordCount,
  currentStep,
  feedbackFor,
  inRemediation,
  isStepComplete,
  stepProgress,
  submitAnswer,
} from '../level/flow';
import type { FlowState, AnswerValue } from '../level/flow';
import {
  createSubmissionLog,
  failedCount,
  markFailed,
  markPending,
  markRecorded,
  recordedCount,
  statusOf,
} from '../level/attempts';
import type { SubmissionLog } from '../level/attempts';
import { CardView } from '../level/CardView';
import { QuestionView } from '../level/QuestionView';
import type { AnswerMeta } from '../level/QuestionView';
import { StepRail } from '../level/StepRail';
import { MasteryMeter } from '../level/MasteryMeter';
import { GatePanel, LockedNotice } from '../level/GatePanel';
import { VideoPanel } from '../level/VideoPanel';
import { RichText, plainText } from '../level/markdown';
import {
  attemptsLeft,
  attemptsPerItem,
  cardPresentation,
  createTierFlow,
  deferredFeedbackFor,
  defersFeedback,
  masteryProgressText,
  masteryRuleText,
  skipsIntro,
  startStepIndex,
  tierSummaryLines,
  type TierRenderPlan,
} from '../level/tier-render';

/**
 * 一个选项的文字。与 `QuestionView` 里 `RadioGroup` 的 label 用同一个函数，
 * 保证「你选了」列表与你刚才点的那一项逐字相同（否则 `$A + A·B$` 与
 * `A + A·B` 会被当成两个不同的选项）。
 */
function choiceText(item: LevelSpec['items'][number], choice: number | string): string {
  if (typeof choice === 'number') {
    const option = item.options[choice];
    return option === undefined ? `第 ${choice + 1} 项` : plainText(option);
  }
  return choice;
}

const useStyles = makeStyles({
  page: {
    padding: '32px',
    maxWidth: '880px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
  },
  heading: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '12px',
    flexWrap: 'wrap',
  },
  title: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightHero700,
  },
  subtitle: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  sectionTitle: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
  },
  footer: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    flexWrap: 'wrap',
    position: 'sticky',
    bottom: 0,
    padding: '14px 0',
    background: tokens.colorNeutralBackground1,
  },
  summaryCard: {
    padding: '20px 22px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  statRow: {
    display: 'flex',
    gap: '32px',
    flexWrap: 'wrap',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  statLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  statValue: {
    fontSize: tokens.fontSizeHero800,
    fontWeight: tokens.fontWeightSemibold,
    fontVariantNumeric: 'tabular-nums',
  },
  centered: {
    display: 'flex',
    justifyContent: 'center',
    padding: '64px',
  },
  message: {
    maxWidth: '560px',
    margin: '64px auto',
  },
  warn: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorPaletteDarkOrangeForeground1,
    lineHeight: tokens.lineHeightBase300,
  },
});

export function LevelPage() {
  const styles = useStyles();
  const { levelId } = useParams<{ levelId: string }>();
  const navigate = useNavigate();
  const { payload, isLoading, error, refetch: refetchLevel } = useLevel(levelId);
  /**
   * 这一关在当前档位下的渲染参数（票 12）。
   *
   * 只读、失败不降级页面：`payload` 为空（接口挂了/还没回来）时，
   * `tier-render` 里的每个函数都会回落到票 04 的行为（全展开、一次提交即锁、
   * 即时反馈）。档位参数是**优化**，不是能做题的前提。
   */
  const tier = useTierLevelPlan(levelId);
  const tierPlan = (tier.payload ?? null) as TierRenderPlan | null;
  /**
   * 本档的首轮起始段（P3 = 第一段带题的段，P1/P2 = 0）。
   *
   * 它进的是下面 `LevelSession` 的 `key`：`flow` 是 `useState` 的惰性初值，
   * 只求值一次，而 `tier.payload` 是异步到的 —— 换了起始段就必须重挂载
   * 持有这份 state 的组件，否则 key 换掉的只是子组件、`flow.stepIndex` 还是 0，
   * P3 学习者会看到第 1 段。（上一版把 key 挂在只读 props 的 `LevelPlayer` 上，
   * 就是这个 bug：state 在父层，换 key 动不了它。）
   */
  const firstStep = startStepIndex(tierPlan);

  const spec = payload?.spec;

  if (isLoading) {
    return (
      <div className={styles.centered}>
        <Spinner label="正在载入关卡…" />
      </div>
    );
  }

  /**
   * 409 不是「出错」，是「这一关还没解锁」。
   *
   * 后端把 `UnlockState` 放在 `details` 里（见 `GatingService#lockedException`），
   * 所以这里能画出「被哪几道门挡着、各差几题」。若当成普通错误显示，学习者
   * 看到的会是一句红字「关卡载入失败」—— 明明内容存在，只是前面的门还没开。
   *
   * 注意判定条件是 `error.status === 409` 而不是 `details` 有值：两者同时成立
   * 才是锁；只看 details 会把别的 409（未来的冲突类错误）也当成锁。
   */
  const locked: UnlockState | undefined =
    error instanceof ApiClientError && error.status === 409
      ? (error.details as UnlockState | undefined)
      : undefined;
  const lockedNodeId = locked?.microKpId ?? payload?.level.microKpId ?? spec?.meta.microKpId;

  if (locked) {
    return (
      <div className={styles.message}>
        <LockedNotice
          state={locked}
          onBack={() => navigate(lockedNodeId ? `/map/${lockedNodeId}` : '/map')}
          onRetry={() => void refetchLevel()}
        />
      </div>
    );
  }

  if (error || !payload || !spec) {
    return (
      <div className={styles.message}>
        <MessageBar intent="error">
          <MessageBarBody>
            关卡载入失败：{error instanceof Error ? error.message : '关卡不存在或规范不合法'}
          </MessageBarBody>
        </MessageBar>
      </div>
    );
  }

  return (
    <LevelSession
      key={`${spec.meta.id}#${firstStep}`}
      spec={spec}
      levelKind={payload.level.kind}
      levelId={levelId ?? ''}
      tierPlan={tierPlan}
      onExit={() => navigate(`/map/${payload.level.microKpId}`)}
    />
  );
}

/**
 * 一关的**播放会话**：持有 `flow`（学习者做了什么）与 `log`（后端收到了什么）。
 *
 * 为什么要单独一层：票 12 的 P3 从「第一段带题的段」开始，而档位参数是异步到的。
 * 初值只算一次，所以必须让**持有 state 的组件**随起始段重挂载 —— `key` 挂在
 * 只读 props 的子组件上没有用，那只换掉渲染树、换不掉父层 state。
 *
 * 两条状态分开是刻意的：`flow` 是纯前端可回放的答题记录，`log` 是异步的记账回执。
 * 合成一个就得处理「提交成功但本地没更新」这类不可能一致的时刻。
 */
function LevelSession({
  spec,
  levelKind,
  levelId,
  tierPlan,
  onExit,
}: {
  spec: LevelSpec;
  levelKind: string;
  levelId: string;
  tierPlan: TierRenderPlan | null;
  onExit: () => void;
}) {
  /**
   * 初始流程从本档的首轮段开始。
   *
   * 不用 `useEffect` 去 `setFlow`：那会在首帧先渲染票 04 的首屏、下一帧再跳到
   * 首轮段，学习者会看到闪一下的错页；而且 `flow` 一旦已经开始答题，就**不能**
   * 被异步到达的参数覆盖（会抹掉他刚答的题）。
   */
  const [flow, setFlow] = useState<FlowState>(() => createTierFlow(tierPlan));
  const [log, setLog] = useState<SubmissionLog>(() => createSubmissionLog());
  const submitAttempt = useSubmitAttempt();

  /**
   * 提交一次作答：**先**更新本地流程（反馈立即出现），**再**异步记账。
   *
   * 顺序不能反。反过来（先 await 后端再显示反馈）会让票 04 的「立即显示」变成
   * 「取决于网络」，而这条反馈是作者预写好的固定文本，没有任何理由等一次往返。
   *
   * `void` 是刻意的：这个 Promise 的结果只走 `onSuccess`/`onError` 回调，没有人 await 它。
   */
  const recordAttempt = (
    itemId: string,
    stepId: string | undefined,
    value: AnswerValue,
    meta: AnswerMeta,
  ) => {
    setLog((current) => markPending(current, itemId));
    submitAttempt.mutate(
      {
        itemId,
        answer: value,
        // 后端据此判断「这一段是否计分」。传的是**当前段的 id**，不是题目反查 ——
        // 同一道题若被深究段与判定段共用，只有段 id 能分清这次是哪一次。
        ...(stepId === undefined ? {} : { stepId }),
        latencyMs: meta.latencyMs,
        hintsUsed: meta.hintsUsed,
      },
      {
        onSuccess: (data) => setLog((current) => markRecorded(current, data.attempt)),
        onError: (cause) =>
          setLog((current) =>
            markFailed(
              current,
              itemId,
              cause instanceof Error ? cause.message : '这条作答没能记上',
            ),
          ),
      },
    );
  };

  return (
    <LevelPlayer
      spec={spec}
      levelKind={levelKind}
      levelId={levelId}
      tierPlan={tierPlan}
      flow={flow}
      setFlow={setFlow}
      log={log}
      onRecordAttempt={recordAttempt}
      onRestart={() => {
        // 重走整关：本地流程与记账日志都清空。**后端证据不清** —— 已记进档案的
        // 作答是不可撤销的历史，重做只会产生新证据。这也正是门控要读后端而不是
        // 读本地 `flow` 的原因：刷新一次页面就能把本地计数归零。
        //
        // 用 `createTierFlow` 而不是 `createFlow`：重走要从**本档的首轮段**开始，
        // 否则 P3 点一下「重走」就退回到讲解段，档位形同没生效。
        setFlow(createTierFlow(tierPlan));
        setLog(createSubmissionLog());
      }}
      onExit={onExit}
    />
  );
}

interface LevelPlayerProps {
  spec: LevelSpec;
  levelKind: string;
  /** 关卡 id：转给「看讲解」面板（票 19）。 */
  levelId: string;
  /** 本档的渲染参数（票 12）；`null` 表示还没拿到，回落到票 04 的行为。 */
  tierPlan: TierRenderPlan | null;
  flow: FlowState;
  setFlow: (next: FlowState) => void;
  /** 记账日志：哪条作答真的落库了。 */
  log: SubmissionLog;
  /** 提交一次作答：更新本地流程 + 发给后端记账。 */
  onRecordAttempt: (
    itemId: string,
    stepId: string | undefined,
    value: AnswerValue,
    meta: AnswerMeta,
  ) => void;
  /** 把这一关从第一段重新走一遍（后端证据保留）。 */
  onRestart: () => void;
  onExit: () => void;
}


const KIND_LABEL: Record<string, string> = {
  teach: '教学关卡',
  quiz: '题目关卡',
  mixed: '混合关卡',
};

function LevelPlayer({
  spec,
  levelKind,
  levelId,
  tierPlan,
  flow,
  setFlow,
  log,
  onRecordAttempt,
  onRestart,
  onExit,
}: LevelPlayerProps) {
  const styles = useStyles();
  const progress = useMemo(() => stepProgress(spec, flow), [spec, flow]);
  const step = currentStep(spec, flow);

  const cards = step ? step.cardIds.map((cardId) => spec.cards.find((c) => c.id === cardId)) : [];
  const items = step ? step.itemIds.map((itemId) => spec.items.find((i) => i.id === itemId)) : [];
  const complete = step ? isStepComplete(flow, step) : false;
  const correct = step ? correctCountInStep(flow, step) : 0;
  const remediating = inRemediation(step);
  const missed = failedCount(log);
  /** 本档的摘要行（验收 2：参数改变必须能被观察到）。 */
  const tierLines = tierSummaryLines(tierPlan);
  /**
   * P3 的整段延迟反馈。
   *
   * 只在**本段所有题都答完**时出现：提前给就等于逐题反馈，那正是这一档
   * 要避免的东西。`SummaryPanel` 里另有一份关末总结，两者不重复 ——
   * 这里说「这一段」，那里说「这一关」。
   */
  const deferred = deferredFeedbackFor(tierPlan, items.filter((i): i is NonNullable<typeof i> => i !== undefined), flow.records);
  const showDeferred = defersFeedback(tierPlan) && complete && deferred.length > 0;

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div className={styles.titleRow}>
          <Text className={styles.title} as="h1">{spec.meta.title}</Text>
          <Badge appearance="tint" color="brand" style={{ whiteSpace: 'nowrap' }}>
            {KIND_LABEL[levelKind] ?? levelKind}
          </Badge>
          <Badge appearance="outline" style={{ whiteSpace: 'nowrap' }}>
            {spec.meta.tier} · 约 {spec.meta.estimatedMinutes} 分钟
          </Badge>
          {tierPlan !== null && (
            <Badge appearance="tint" color="informative" style={{ whiteSpace: 'nowrap' }}>
              按 {tierPlan.params.tier} 档渲染
            </Badge>
          )}
        </div>
        <Text className={styles.subtitle}>
          知识点 {spec.meta.microKpId} · 共 {spec.steps.length} 段
          {skipsIntro(tierPlan) ? ` · 这一档直接从第 ${startStepIndex(tierPlan) + 1} 段开始` : ''}
        </Text>
        {/**
          档位摘要（票 12 验收 2）。放在标题下而不是折叠面板里：验收要求
          「同一知识点切到不同档位，首屏渲染结果不同」，而一句话摘要正是
          最直接的可见差异。三行都从参数算出来（`tierSummaryLines`），
          不查标签表。
        */}
        {tierLines.length > 0 && (
          <ul aria-label="本档渲染参数" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {tierLines.map((line) => (
              <li key={line}>
                <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>{line}</Text>
              </li>
            ))}
          </ul>
        )}
        {/**
          掌握判定进度。读的是服务端回的 `masteryProgress`（attempts 回放），
          不是本地 `flow.records` —— 后者刷新一次页面就归零。
        */}
        {tierPlan !== null && (
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {masteryRuleText(tierPlan)}；{masteryProgressText(tierPlan)}
          </Text>
        )}
      </header>

      <StepRail progress={progress} />

      {remediating && (
        <MessageBar intent="warning">
          <MessageBarBody>
            这一段是<strong>深究</strong>：它只想把你脑子里的错误规则挖出来，所以
            <strong>全程不扣掌握度</strong>，答错也没有代价。放开答。
          </MessageBarBody>
        </MessageBar>
      )}

      {/**
       * 记账失败时的提示条。**不做静默降级**：学习者有权知道「这道题算了，但没记进档案」，
       * 否则下次看到掌握度没动会以为是系统漏算 —— 而实际原因是这一次提交没到后端。
       *
       * 这条提示不阻塞继续答题：丢一条证据比卡住整堂课轻得多。
       */}
      {missed > 0 && (
        <MessageBar intent="warning">
          <MessageBarBody>
            有 {missed} 条作答<strong>没能记进档案</strong>
            ：这条证据不会进掌握度计算。答案本身仍按预写反馈判定，你可以继续往下走。
          </MessageBarBody>
        </MessageBar>
      )}

      <Divider />

      {/**
       * 小结段直接渲染结算面板，不再单列一次「小结卡 + 下一段按钮」。
       *
       * 原来小结段先显示卡片与「完成本关」按钮，点完再叠一层总结；同一张
       * 小结卡会出现两次，学习者看到的是「又说了一遍」。流程上小结就是终点，
       * 让 `summary` 段本身承载结算界面，路径最短。
       */}
      {flow.finished || step?.kind === 'summary' ? (
        <SummaryPanel
          spec={spec}
          flow={flow}
          log={log}
          levelId={levelId}
          tierPlan={tierPlan}
          onRestart={onRestart}
          onExit={onExit}
        />
      ) : (
        step && (
          <>
            <div className={styles.sectionHeader}>
              <Text className={styles.sectionTitle}>
                第 {flow.stepIndex + 1} 段 · {STEP_KIND_LABEL[step.kind]}
              </Text>
              <Badge appearance="outline" style={{ whiteSpace: 'nowrap' }}>
                {step.title}
              </Badge>
            </div>

            <div className={styles.section}>
              {cards.map((card) =>
                card ? (
                  <CardView
                    key={card.id}
                    card={card}
                    // P1 全展开；P2 只把服务端点名的那张卡折叠（forward fading）；
                    // P3 全部默认收起但可展开。映射全在 `tier-render`，这里不写第二份。
                    presentation={cardPresentation(card.id, tierPlan)}
                  />
                ) : null,
              )}
            </div>

            {items.length > 0 && (
              <div className={styles.section}>
                {items.map((item) => {
                  if (!item) return null;
                  const choice = flow.choices[item.id];
                  /**
                   * 还剩几次机会（票 12）。
                   *
                   * 这里传给组件的是**剩余次数**，而「还能不能再提交」由
                   * `submitAnswer` 自己按同一个数判断 —— 页面不自己拍板
                   * 「锁定还是不锁定」，否则两份判断会漂移。
                   *
                   * 答对后为 0；答错且用完为 0 —— 两种都锁题，与票 04 一致。
                   */
                  const left = attemptsLeft(tierPlan, flow.records, item.id);
                  // 有选择值 = 已提交。反馈从状态机的记录重建，刷新重渲染也拿到同一条。
                  const submitted =
                    choice === undefined
                      ? undefined
                      : { choice, feedback: feedbackFor(spec, flow, item.id) };
                  return (
                    <QuestionView
                      key={item.id}
                      item={item}
                      submitted={submitted}
                      recording={statusOf(log, item.id)}
                      // 还能再试时不锁题（P1/P2 的第二次机会）。
                      attemptsLeft={submitted !== undefined && left > 0 ? left : undefined}
                      // P3 档：知道对错但不当场说，收到本段末尾统一给。
                      deferredFeedback={defersFeedback(tierPlan)}
                      onSubmit={(value, meta) => {
                        // 先落本地（反馈这一帧就出现），再记账。两步都在这里，
                        // 因为「提交了」这件事只能发生一次（`submitAnswer` 对重复提交幂等）。
                        setFlow(
                          submitAnswer(spec, flow, item.id, value, {
                            attemptsPerItem: attemptsPerItem(tierPlan),
                          }).state,
                        );
                        onRecordAttempt(item.id, step.id, value, meta);
                      }}
                      nonScoring={remediating}
                    />
                  );
                })}
              </div>
            )}

            {/**
              P3 的整段反馈：本段题全部答完才出现。

              这是「整题提交后延迟 + 关末总结」里的**前半句**（spec §5 第四行）。
              没有它，P3 学习者只有在走完七段之后才知道前面那些题错在哪里，
              而那时已经无法补救了。
            */}
            {showDeferred && (
              <Card className={styles.summaryCard} appearance="filled">
                <CardHeader
                  header={<Text className={styles.sectionTitle}>本段反馈（这一档不逐题打断）</Text>}
                />
                <div className={styles.section}>
                  {deferred.map((entry) => (
                    <div key={entry.itemId} className={styles.section}>
                      <Text className={styles.sectionTitle}>{plainText(entry.item.stem)}</Text>
                      <Text size={200}>
                        {entry.correct ? '✓ 答对了' : '△ 这条没答对'} · 你选了「{choiceText(entry.item, entry.choice)}」
                      </Text>
                      <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                        {entry.correct ? entry.item.explainCorrect : entry.item.explainWrong}
                      </Text>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <div className={styles.footer}>
              <Button
                appearance="primary"
                onClick={() => setFlow(advance(spec, flow))}
                disabled={!complete}
              >
                进入下一段
              </Button>
              {!complete && step.itemIds.length > 0 && (
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                  本段还有题没答（已答对 {correct} 道），答完才能继续
                </Text>
              )}
              {complete && step.itemIds.length === 0 && (
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                  看完这段就可以继续
                </Text>
              )}
            </div>
          </>
        )
      )}
    </div>
  );
}

/** 小结段：把这一关的证据摊开，评一次出口门控，并给出「下一关 / 回知识点」的出口。 */
function SummaryPanel({
  spec,
  flow,
  log,
  levelId,
  tierPlan,
  onRestart,
  onExit,
}: {
  spec: LevelSpec;
  flow: FlowState;
  log: SubmissionLog;
  /**
   * 关卡 id：只给「看讲解」面板用（票 19）。
   *
   * 从 props 传而不是在组件里 `useParams`：这个面板已经有 `spec` 作为它的
   * 全部输入来源，再引入一个隐式的路由依赖会让它更难在测试里单独渲染。
   */
  levelId: string;
  /** 本档的渲染参数（票 12）：小结页也展示本档判定规则与还差什么。 */
  tierPlan: TierRenderPlan | null;
  onRestart: () => void;
  onExit: () => void;
}) {
  const styles = useStyles();
  const navigate = useNavigate();
  const total = flow.records.length;
  const correct = flow.records.filter((record) => record.correct).length;
  const counted = countedRecordCount(flow);
  const recorded = recordedCount(log);
  const missed = failedCount(log);
  /**
   * 这一关的掌握度，**从后端读**而不是从本地 `flow` 算。
   *
   * `flow` 里的 `masteryCredit` 是 ±1 的本地占位（票 04 用它证明深究分支恒为 0），
   * 它不是概率、不能相加成一个百分比。真正该给学习者看的是后端按 BKT 重算的
   * `achieved`/`current`，所以这里挂 `MasteryMeter`，与知识点页同一份组件、
   * 同一个接口 —— 两个页面显示同一个数，才不会出现「关卡页 80%、详情页 60%」。
   */
  const mastery = useMastery(spec.meta.microKpId);

  /**
   * 门控判定与历史（票 06）。判定是**显式动作**：进小结不自动 POST，
   * 否则「翻到最后一段」就等于「被考一次」，而学习者可能只是想看看小结。
   */
  const gate = useEvaluateGate();
  const history = useGateHistory(spec.meta.id);
  const [evaluation, setEvaluation] = useState<GateEvaluation | undefined>(undefined);
  const [unlockedNodeIds, setUnlockedNodeIds] = useState<string[]>([]);
  /**
   * 判定失败留在本地状态里，而不是只读 `gate.error`。
   *
   * 理由：`gate.error` 会一直挂着直到下一次 mutate —— 而学习者点「重走这一关」
   * 或换一关之后，那条错误已经与眼前的内容无关了。带着旧错误进新流程，
   * 等于把「上一次判定失败」读成「这一关也完了」。
   */
  const [gateError, setGateError] = useState<unknown>(undefined);

  const reteachCards = spec.steps
    .filter((entry) => entry.kind === 'summary')
    .flatMap((entry) => entry.cardIds)
    .map((cardId) => spec.cards.find((card) => card.id === cardId))
    .filter((card): card is NonNullable<typeof card> => card !== undefined);

  const runGate = () => {
    setGateError(undefined);
    gate.mutate(spec.meta.id, {
      onSuccess: (data) => {
        setEvaluation(data.evaluation);
        setUnlockedNodeIds(data.unlockedNodeIds);
      },
      onError: (cause) => setGateError(cause),
    });
  };

  return (
    <>
      <div className={styles.sectionHeader}>
        <Text className={styles.sectionTitle}>本关小结</Text>
        <Badge
          appearance="tint"
          color={flow.tookRemediation ? 'informative' : 'success'}
          style={{ whiteSpace: 'nowrap' }}
        >
          {flow.tookRemediation ? '走了深究路径' : '一次通过'}
        </Badge>
      </div>

      <div className={styles.section}>
        {reteachCards.map((card) => (
          <CardView key={card.id} card={card} />
        ))}

        <Card className={styles.summaryCard} appearance="filled">
          <CardHeader header={<Text className={styles.sectionTitle}>本关证据</Text>} />
          <div className={styles.statRow}>
            <div className={styles.stat}>
              <span className={styles.statLabel}>作答</span>
              <span className={styles.statValue}>{total}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>答对</span>
              <span className={styles.statValue}>{correct}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>已记入档案</span>
              <span className={styles.statValue}>{recorded}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>计入掌握度</span>
              <span className={styles.statValue}>{counted}</span>
            </div>
          </div>
          <Body1>
            {flow.tookRemediation
              ? `这一趟走了深究路径。深究与进一步讲解里的作答不计入掌握度，所以真正进 BKT 证据序列的是 ${counted} 道。`
              : `一次通过，${counted} 道作答全部计入掌握度。`}
          </Body1>
          {missed > 0 && (
            <Text className={styles.warn}>
              有 {missed} 条作答没能记进档案，它们不会进掌握度计算（原因见对应题目下方）。
            </Text>
          )}
          <Divider />
          <MasteryMeter view={mastery.payload} />
        </Card>
      </div>

      <GatePanel
        spec={spec}
        evaluation={evaluation}
        unlockedNodeIds={unlockedNodeIds}
        history={history.payload}
        isEvaluating={gate.isPending}
        error={gateError}
        onEvaluate={runGate}
        onRestart={onRestart}
      />

      {/*
        票 19：讲解视频放在门控面板之后 —— 学习者最需要讲解的时刻是「卡住之后」，
        而不是进关卡之前（那样会变成「先看 30 分钟视频再做题」）。
        它只读、失败不阻断做题，所以放在主流程之外。
      */}
      <VideoPanel levelId={levelId} />

      <div className={styles.footer}>
        {spec.meta.nextLevelId !== null ? (
          <Button appearance="primary" onClick={() => navigate(`/level/${spec.meta.nextLevelId}`)}>
            进入下一关
          </Button>
        ) : (
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            这是当前知识点最后一关
          </Text>
        )}
        <Button appearance="secondary" onClick={onExit}>
          回到知识点
        </Button>
      </div>
    </>
  );
}
