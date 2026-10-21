/**
 * 定级向导（票 11）：行为自评 → 8–18 道定级题 → 临时档位。
 *
 * ## 为什么是一段一段的向导，不是一页表单
 *
 * 定级不是考试。一页表单会让人以为「填完就完了」，而这里每一段都在回答
 * 学生心里的一句话：
 *
 *   1. 自评段：「为什么问我这些？」——页面说明这四题只问**做过什么**，
 *      而且它只把起点挪半档，定不了级；
 *   2. 答题段：「答错了会怎样？」——每题提交后立刻给出正确答案与解析
 *      （票 11 验收 4），学习者当场就能判断系统有没有判错；
 *   3. 结果段：「这个档位是终审吗？」——必须显式写「临时」，并说清再答
 *      5 题后会用真实学习数据重判，可能升也可能降。
 *
 * ## 为什么答错也要立刻给答案
 *
 * 如果只在最后给一个「你被定为 P1」，被判低的人没有任何依据反驳，他会
 * 直接不信任这套系统。逐题给答案与解析，是把这个判断变成**可复核**的。
 *
 * ## 为什么自评不显示档位
 *
 * 自评只值 ±0.4 logit（engine 的 `priorShiftLogit`）。页面如实说「把你的
 * 起点略微挪了一点」——若显示成「你大概是 P2」，学生会把它当成结论，而
 * 后面 8–18 题推出来的档位与它不一致时，他会觉得系统在乱判。
 */
import { useState } from 'react';
import {
  Badge,
  Body1,
  Button,
  Caption1,
  Card,
  CardHeader,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Radio,
  RadioGroup,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  usePlacementResult,
  usePlacementStatus,
  useRejudgePlacement,
  useSelfAssessmentForm,
  useStartPlacement,
  useSubmitPlacementAnswer,
  useSubmitSelfAssessment,
  useTierChanges,
} from '../api/queries';
import type {
  PlacementAnswerResponse,
  PlacementResultResponse,
  PlacementSessionResponse,
  PlacementTier,
  SelfAssessmentFormResponse,
  SelfAssessmentSubmitResponse,
} from '../api/generated/model';

const useStyles = makeStyles({
  page: {
    padding: '32px',
    maxWidth: '860px',
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
  title: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightHero700,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  metaRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  // 中文在窄容器里会被 Badge 折成竖排，逐个禁止换行。
  badge: { whiteSpace: 'nowrap' },
  stem: {
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
    padding: '12px 14px',
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
  },
  reviewRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: '6px 12px',
    padding: '10px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  reviewStem: {
    gridColumn: '1 / -1',
    color: tokens.colorNeutralForeground2,
  },
  correct: { color: tokens.colorPaletteGreenForeground1 },
  wrong: { color: tokens.colorPaletteRedForeground1 },
  actions: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
});

/** 三档的中文说法。**不写「快班/慢班」**：三档是每关的渲染参数，不是分班。 */
const TIER_LABEL: Record<PlacementTier, string> = {
  P1: '更多示范与引导',
  P2: '标准节奏',
  P3: '更少脚手架',
};

const TIER_NOTE: Record<PlacementTier, string> = {
  P1: '关卡会先给完整样例，再逐步让你补全；追问从第 1 级起步。',
  P2: '关卡给部分步骤，剩下由你补；追问从第 2 级起步。',
  P3: '关卡直接出题，只在你卡住时给提示；追问从第 3 级起步。',
};

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: '基础',
  medium: '中等',
  hard: '综合',
};

/** 把「这题答得对不对」翻成中文，不把枚举值漏到界面上。 */
function judgementText(correct: boolean): string {
  return correct ? '回答正确' : '回答错误';
}

function formatTier(tier: PlacementTier | null): string {
  return tier === null ? '未定级' : `${tier}（${TIER_LABEL[tier]}）`;
}

/**
 * 一段收尾的卡片：本次定级结束了，去看结果。
 *
 * 单独提出来是因为「题池用尽」与「答满 18 题」都会走到这里 —— 复制两遍
 * 就有一处会忘了给按钮加 aria-label。
 */
function FinishedNotice({ onShowResult }: { onShowResult: () => void }) {
  return (
    <MessageBar intent="success">
      <MessageBarBody>
        <MessageBarTitle>这次定级结束了</MessageBarTitle>
        剩下的事是把它翻成一个临时档位 —— 你可以逐题复核系统有没有判错。
      </MessageBarBody>
      <div style={{ marginTop: 8 }}>
        <Button appearance="primary" onClick={onShowResult}>
          查看定级结果
        </Button>
      </div>
    </MessageBar>
  );
}

// ---------------------------------------------------------------------------
// 自评段
// ---------------------------------------------------------------------------

function SelfAssessmentStage({
  form,
  onReady,
}: {
  form: SelfAssessmentFormResponse;
  onReady: (prior: SelfAssessmentSubmitResponse, answers: Array<{ questionId: string; optionId: string }>) => void;
}) {
  const styles = useStyles();
  const [picked, setPicked] = useState<Record<string, string>>({});
  const submit = useSubmitSelfAssessment();

  const complete = form.questions.every((question) => Boolean(picked[question.id]));

  const onPick = (questionId: string, optionId: string) => {
    setPicked((prev) => ({ ...prev, [questionId]: optionId }));
  };

  const onSubmit = () => {
    const answers = form.questions.map((question) => ({
      questionId: question.id,
      optionId: picked[question.id] ?? '',
    }));
    submit.mutate(
      { answers },
      {
        onSuccess: (prior) => onReady(prior, answers),
      },
    );
  };

  return (
    <Card>
      <CardHeader
        header={<Text weight="semibold" as="h2">先问四个关于「做过什么」的问题</Text>}
        description={<Body1>{form.rationale}</Body1>}
      />
      <div className={styles.section} role="group" aria-label="行为自评">
        {form.questions.map((question, index) => (
          <div key={question.id} className={styles.section}>
            <Text weight="medium">{`${index + 1}. ${question.prompt}`}</Text>
            <RadioGroup
              // 每题一个 radiogroup 并且带名字：屏幕阅读器只念「单选按钮」时，
              // 四组题会变成一串没有归属的选项。
              aria-label={`第 ${index + 1} 题：${question.prompt}`}
              value={picked[question.id] ?? ''}
              onChange={(_, data) => onPick(question.id, data.value)}
            >
              {question.options.map((option) => (
                <Radio key={option.id} value={option.id} label={option.label} />
              ))}
            </RadioGroup>
          </div>
        ))}
      </div>

      {submit.isError && (
        <MessageBar intent="error">
          <MessageBarBody>
            自评没能提交：{submit.error instanceof Error ? submit.error.message : '未知错误'}
          </MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.actions}>
        <Button appearance="primary" onClick={onSubmit} disabled={!complete || submit.isPending}>
          {submit.isPending ? '正在记录…' : '提交自评'}
        </Button>
        {!complete && <Caption1>四道题都答完才能继续。</Caption1>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 答题段
// ---------------------------------------------------------------------------

function QuizStage({
  initial,
  onFinished,
}: {
  initial: PlacementSessionResponse;
  onFinished: () => void;
}) {
  const styles = useStyles();
  const [current, setCurrent] = useState(initial);
  const [picked, setPicked] = useState('');
  const [judged, setJudged] = useState<PlacementAnswerResponse | null>(null);
  const answer = useSubmitPlacementAnswer();

  const item = current.item;

  // 题答完、会话也结束，而且还没有判定卡可看 —— 到这一步才收摊。
  //
  // 注意**不能**直接写成 `if (item === null) return <FinishedNotice/>`：
  // 最后一题的作答回执里 `session.item` 就是 null，那样写会在学生提交完
  // 最后一道题的同一瞬间把判定卡连同**那题的正确答案与解析**一起抹掉 ——
  // 票面验收 4 要求的是「每道题都能复核」，最后一道也不例外。
  if (item === null && judged === null) {
    return <FinishedNotice onShowResult={onFinished} />;
  }

  const onSubmit = () => {
    if (item === null) return;
    const index = item.options.indexOf(picked);
    if (index < 0) return;
    answer.mutate(
      { sessionId: current.sessionId, request: { itemId: item.itemId, answer: index } },
      {
        onSuccess: (body) => {
          setJudged(body);
          setCurrent(body.session);
        },
      },
    );
  };

  const nextQuestion = () => {
    // 按钮写着「看结果」的时候，点下去就得看到结果。
    //
    // 原来这里无条件 `setJudged(null)`，于是最后一题之后会先落回
    // 「这次定级结束了」的中间页，再点一次才到结果 —— 两个按钮做一件事，
    // 而且第一个按钮的名字不算数。判定卡的内容已经看过了（学生点了才走），
    // 所以这里可以直接进结果段。
    if (judged !== null && judged.session.item === null) {
      onFinished();
      return;
    }
    setJudged(null);
    setPicked('');
  };

  return (
    <Card>
      <CardHeader
        header={<Text weight="semibold" as="h2">{`第 ${current.answered + (judged ? 0 : 1)} 题`}</Text>}
        description={
          <Caption1>
            {`已经答了 ${current.answered} 题，答对 ${current.correctCount} 题。题池里还剩 ${current.remainingItems} 道没问过。`}
          </Caption1>
        }
      />

      {item !== null && (
        <div className={styles.section} role="region" aria-label="定级题">
          <div className={styles.metaRow}>
            <Badge appearance="outline" className={styles.badge}>
              {`考的是：${item.microKpName}`}
            </Badge>
            <Badge appearance="tint" className={styles.badge}>
              {DIFFICULTY_LABEL[item.difficulty] ?? item.difficulty}
            </Badge>
          </div>

          <div className={styles.stem}>{item.stem}</div>

          <RadioGroup
            aria-label="这道题的选项"
            value={picked}
            onChange={(_, data) => setPicked(data.value)}
          >
            {item.options.map((option, index) => (
              <Radio
                key={index}
                value={option}
                label={`${String.fromCharCode(65 + index)}. ${option}`}
                disabled={judged !== null || answer.isPending}
              />
            ))}
          </RadioGroup>
        </div>
      )}

      {judged !== null && (
        <Card
          // 判定与解析要能被屏幕阅读器整块读到，并且和题面分开：
          // 一道题答完之后，「正确答案」属于这一题，不属于下一题。
          role="region"
          aria-label="这道题的判定"
        >
          <div className={styles.section}>
            <div className={styles.metaRow}>
              <Text
                weight="semibold"
                className={judged.correct ? styles.correct : styles.wrong}
              >
                {judgementText(judged.correct)}
              </Text>
              <Caption1>
                {`正确答案：${judged.correctAnswerText}`}
              </Caption1>
            </div>
            {judged.explanation !== null && <Body1>{judged.explanation}</Body1>}
            {judged.whyWrong !== null && (
              <Body1 className={styles.wrong}>{`你选的那一项：${judged.whyWrong}`}</Body1>
            )}
          </div>
        </Card>
      )}

      {answer.isError && (
        <MessageBar intent="error">
          <MessageBarBody>
            这一轮没能提交：{answer.error instanceof Error ? answer.error.message : '未知错误'}
          </MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.actions}>
        {judged === null ? (
          <Button
            appearance="primary"
            onClick={onSubmit}
            disabled={picked === '' || answer.isPending}
          >
            {answer.isPending ? '判定中…' : '提交这道题'}
          </Button>
        ) : (
          <Button appearance="primary" onClick={nextQuestion}>
            {judged.session.item === null ? '看结果' : '下一题'}
          </Button>
        )}
        {judged === null && <Caption1>选一个答案再提交。</Caption1>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 结果段
// ---------------------------------------------------------------------------

function ResultStage({ sessionId, onRestart }: { sessionId: string; onRestart: () => void }) {
  const styles = useStyles();
  const result = usePlacementResult(sessionId, true);

  if (result.isPending) {
    return <Spinner label="正在汇总这次定级…" />;
  }
  if (result.isError || !result.payload) {
    return (
      <MessageBar intent="error">
        <MessageBarBody>
          <MessageBarTitle>读不到定级结果</MessageBarTitle>
          {result.error instanceof Error ? result.error.message : '请稍后重试。'}
        </MessageBarBody>
      </MessageBar>
    );
  }

  const payload = result.payload;
  return (
    <Card role="region" aria-label="定级结果">
      <CardHeader
        header={<Text weight="semibold" as="h2">你的临时档位</Text>}
        description={
          <div className={styles.metaRow}>
            <Badge appearance="tint" color="brand" size="large" className={styles.badge}>
              {`${payload.tier}：${TIER_LABEL[payload.tier]}`}
            </Badge>
            {/* 「临时」必须是文字而不是低饱和度的颜色：这个结果会变，而
                一个看起来像终审的档位会让被判低的人直接放弃。 */}
            <Badge appearance="outline" className={styles.badge}>
              临时档位
            </Badge>
            {payload.lowConfidence && (
              <Badge appearance="outline" color="warning" className={styles.badge}>
                置信度不高
              </Badge>
            )}
          </div>
        }
      />
      <div className={styles.section}>
        <Body1>{TIER_NOTE[payload.tier]}</Body1>
        <Body1>{payload.explanation}</Body1>
        <Caption1>
          {`这次共答 ${payload.answered} 题，答对 ${payload.correctCount} 题；` +
            `再答 ${payload.rejudgeAfterAttempts} 题后，系统会用你的真实学习数据重新判断档位。`}
        </Caption1>
      </div>

      <Divider />

      <div className={styles.section}>
        <Text weight="semibold" as="h3">逐题复核</Text>
        <Caption1>
          下面列出每道题你的选择与正确答案。如果你发现哪一道被系统判错了，说明这个档位也需要再确认。
        </Caption1>
        <div role="list" aria-label="逐题复核">
          {payload.review.map((row) => (
            <div className={styles.reviewRow} role="listitem" key={row.itemId}>
              <span className={styles.reviewStem}>{row.stem}</span>
              <span>{`你选的是：${row.yourAnswerText}`}</span>
              <span>{`正确答案：${row.correctAnswerText}`}</span>
              <span className={row.correct ? styles.correct : styles.wrong}>
                {judgementText(row.correct)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.actions}>
        <Button onClick={onRestart}>重新定级</Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 档位状态卡
// ---------------------------------------------------------------------------

function StatusCard({
  onStart,
  forcing,
}: {
  onStart: () => void;
  forcing: boolean;
}) {
  const styles = useStyles();
  const status = usePlacementStatus();
  const rejudge = useRejudgePlacement();

  if (status.isPending) {
    return <Spinner label="正在读取你的档位…" />;
  }
  if (status.isError || !status.payload) {
    return (
      <MessageBar intent="error">
        <MessageBarBody>
          <MessageBarTitle>读不到档位状态</MessageBarTitle>
          {status.error instanceof Error ? status.error.message : '请稍后重试。'}
        </MessageBarBody>
      </MessageBar>
    );
  }

  const payload = status.payload;
  const placed = payload.status !== 'none';

  return (
    <Card>
      <CardHeader
        header={<Text weight="semibold" as="h2">你的档位</Text>}
        description={
          placed ? (
            <div className={styles.metaRow}>
              <Badge appearance="tint" color="brand" size="large" className={styles.badge}>
                {formatTier(payload.tier)}
              </Badge>
              <Badge appearance="outline" className={styles.badge}>
                {payload.status === 'provisional' ? '临时档位' : '已确认'}
              </Badge>
            </div>
          ) : (
            <Body1>还没定过级。定级不会给你打分，它只决定关卡从多完整的示范开始。</Body1>
          )
        }
      />

      {placed && (
        <div className={styles.section}>
          <Caption1>
            {payload.shouldRejudge
              ? `你已经在定级后答了 ${payload.attemptsSince} 题，系统正要用真实学习证据重判一次。`
              : `再答 ${Math.max(0, payload.rejudgeAfterAttempts - payload.attemptsSince)} 题，系统会自动用真实学习证据重判；重判不是重考一遍定级题。`}
          </Caption1>
        </div>
      )}

      {/*
        自动重判的那条说明。
        重判发生在「读状态」的时候 —— 学习者没有点任何按钮，档位却变了。
        不解释一句「系统根据你的学习数据把档位从 P1 调到 P2」，这件事看起来
        就是应用出错了。手动重判的结果走下面那条 `rejudge.data`，这里只报
        已经落库的历史，两者不会同时出现。
      */}
      {payload.lastRejudge !== null && rejudge.data === undefined && (
        <MessageBar intent={payload.lastRejudge.changed ? 'success' : 'info'}>
          <MessageBarBody>
            <MessageBarTitle>
              {payload.lastRejudge.changed
                ? `系统根据你的学习数据，把档位从 ${payload.lastRejudge.previousTier} 调整为 ${payload.lastRejudge.tier}`
                : '系统根据你的学习数据重判过，档位保持不变'}
            </MessageBarTitle>
            {payload.lastRejudge.explanation}
          </MessageBarBody>
        </MessageBar>
      )}

      {rejudge.isError && (
        <MessageBar intent="error">
          <MessageBarBody>
            重判没能进行：{rejudge.error instanceof Error ? rejudge.error.message : '未知错误'}
          </MessageBarBody>
        </MessageBar>
      )}

      {rejudge.data !== undefined && (
        <MessageBar intent={rejudge.data.changed ? 'success' : 'info'}>
          <MessageBarBody>
            <MessageBarTitle>
              {rejudge.data.changed
                ? `档位从 ${rejudge.data.previousTier} 调整为 ${rejudge.data.tier}`
                : '档位保持不变'}
            </MessageBarTitle>
            {rejudge.data.explanation}
          </MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.actions}>
        <Button appearance="primary" onClick={onStart} disabled={forcing}>
          {placed ? '重新定级' : '开始定级'}
        </Button>
        {/* 重判只在并发下才需要手动触发（读状态本身会结算），所以常态下
            这个按钮不可见 —— 而不是显示成灰的。一个永远灰色的按钮只会让
            人反复去点它。 */}
        {placed && payload.shouldRejudge && (
          <Button onClick={() => rejudge.mutate()} disabled={rejudge.isPending}>
            {rejudge.isPending ? '重判中…' : '用学习证据重判'}
          </Button>
        )}
      </div>

      {placed && <TierHistoryCard />}
    </Card>
  );
}

/**
 * 档位变更历史（票 12 验收 3：「升降级写进学习日志，用户能看到为什么给我降档了」）。
 *
 * ## 为什么单独拉一个接口，而不是从 `placement.lastRejudge` 渲染
 *
 * `lastRejudge` 只有**最近一次**，且它会被「重新定级」冲掉（旧指针对不上就
 * 不算了）。学习者想知道的往往是「我是从什么时候开始变差的」—— 那是历史，
 * 不是最新状态。数据源是 `app.learning_log` 的 `tier_rejudge` 事件，写入方是
 * `PlacementService#applyRejudge`（同一个事务里与档位更新一起写，见那里的注释）。
 *
 * ## 为什么每条都要带 explanation
 *
 * 只说「P2 → P1」等于宣布判决而不给理由。被判低的人如果看不到「平均首轮
 * 正确率 21%，低于 30% 的下调线」这一句，他能做的只有不信任这个系统。
 *
 * ## 为什么没有数据时什么都不显示
 *
 * “从没重判过” 是常态（新用户就是）。渲染一个空卡片或「暂无记录」会把
 * 一个正常状态弄得像出了问题。
 */
function TierHistoryCard() {
  const styles = useStyles();
  const history = useTierChanges(10);
  const items = history.payload?.items ?? [];

  if (history.isError) {
    return (
      <MessageBar intent="warning">
        <MessageBarBody>
          读不到档位变更历史：
          {history.error instanceof Error ? history.error.message : '请稍后重试。'}
          <br />
          这一块不影响你做关题，当前档位仍以上面那张卡片为准。
        </MessageBarBody>
      </MessageBar>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className={styles.section} role="region" aria-label="档位变更历史">
      <Text weight="semibold" as="h3">
        档位变更历史
      </Text>
      <Caption1>
        每次重判都写在学习日志里。档位只决定每一关从多完整的示范开始，不代表你的水平被重新定义。
      </Caption1>
      <div className={styles.section}>
        {items.map((entry) => (
          <div key={entry.id} className={styles.metaRow}>
            <Caption1>{formatRejudgeAt(entry.at)}</Caption1>
            <Badge
              appearance="tint"
              color={entry.changed ? 'informative' : 'subtle'}
              className={styles.badge}
            >
              {entry.changed ? `${entry.previousTier} → ${entry.tier}` : `${entry.tier} 保持不变`}
            </Badge>
            <Caption1>{entry.explanation}</Caption1>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 本地时区的 `YYYY-MM-DD HH:mm`，不依赖 `toLocaleString` 的平台差异。 */
function formatRejudgeAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------------

type Stage = 'status' | 'assess' | 'quiz' | 'result';

export function PlacementPage() {
  const styles = useStyles();
  const form = useSelfAssessmentForm();
  const start = useStartPlacement();

  const [stage, setStage] = useState<Stage>('status');
  const [prior, setPrior] = useState<SelfAssessmentSubmitResponse | null>(null);
  const [answers, setAnswers] = useState<Array<{ questionId: string; optionId: string }>>([]);
  const [session, setSession] = useState<PlacementSessionResponse | null>(null);

  const restart = () => {
    setStage('status');
    setPrior(null);
    setAnswers([]);
    setSession(null);
    start.reset();
  };

  const beginQuiz = () => {
    start.mutate(
      { selfAssessment: answers },
      { onSuccess: (body) => {
        setSession(body);
        setStage(body.item === null ? 'result' : 'quiz');
      } },
    );
  };

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <Text as="h1" className={styles.title}>
          初始定级
        </Text>
        <Body1>
          定级不问「你觉得自己什么水平」，只问最近做过什么，再用 8–18 道来自你接下来要学的知识点的题，
          定出一个**临时**档位。它决定的是每一关从多完整的示范开始，不是给你分班。
        </Body1>
      </div>

      {stage === 'status' && (
        <>
          <StatusCard onStart={() => setStage('assess')} forcing={start.isPending} />
          {start.isError && (
            <MessageBar intent="error">
              <MessageBarBody>
                <MessageBarTitle>这次定级没能开始</MessageBarTitle>
                {start.error instanceof Error ? start.error.message : '请稍后重试。'}
              </MessageBarBody>
            </MessageBar>
          )}
        </>
      )}

      {stage === 'assess' &&
        (form.isPending ? (
          <Spinner label="正在取自评问卷…" />
        ) : form.isError || !form.payload ? (
          <MessageBar intent="error">
            <MessageBarBody>
              <MessageBarTitle>读不到自评问卷</MessageBarTitle>
              {form.error instanceof Error ? form.error.message : '请稍后重试。'}
            </MessageBarBody>
          </MessageBar>
        ) : prior === null ? (
          <SelfAssessmentStage
            form={form.payload}
            onReady={(result, submitted) => {
              setPrior(result);
              setAnswers(submitted);
            }}
          />
        ) : (
          <Card role="region" aria-label="自评结果">
            <CardHeader
              header={<Text weight="semibold" as="h2">自评记录好了</Text>}
              description={
                <Body1>
                  {`根据你的回答，我们把起点${prior.priorShift >= 0 ? '略微上移' : '略微下移'}了 ${Math.abs(prior.priorShift).toFixed(2)} 个 logit —— 最多半档。真正的档位由接下来的题决定。`}
                </Body1>
              }
            />
            <Caption1>
              {`当前三档先验概率：P1 ${(prior.priorProbabilities[0]! * 100).toFixed(0)}% / P2 ${(prior.priorProbabilities[1]! * 100).toFixed(0)}% / P3 ${(prior.priorProbabilities[2]! * 100).toFixed(0)}%。`}
            </Caption1>
            <div className={styles.actions}>
              <Button appearance="primary" onClick={beginQuiz} disabled={start.isPending}>
                {start.isPending ? '正在准备题目…' : '开始答题'}
              </Button>
            </div>
            {start.isError && (
              <MessageBar intent="error">
                <MessageBarBody>
                  <MessageBarTitle>准备题目失败</MessageBarTitle>
                  {start.error instanceof Error ? start.error.message : '请稍后重试。'}
                </MessageBarBody>
              </MessageBar>
            )}
          </Card>
        ))}

      {stage === 'quiz' && session !== null && (
        <QuizStage initial={session} onFinished={() => setStage('result')} />
      )}

      {stage === 'result' && session !== null && (
        <ResultStage sessionId={session.sessionId} onRestart={restart} />
      )}
    </div>
  );
}
