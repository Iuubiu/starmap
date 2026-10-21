/**
 * 复验页：到期的已掌握微知识点回来找你（票 07）。
 *
 * ## 这一页为什么是独立一页
 *
 * 票 07 验收第 1 条要求「多个知识点交错出现而不是同一个连考」。交错只有
 * 跨知识点的会话才成立 —— 嵌在单个知识点详情页里，一次只能考一个知识点，
 * 无论题单怎么排都是「同一个连考」。
 *
 * ## 三个状态，缺一不可
 *
 * 1. **队列**（`/?tab` 之外的默认态）：列出此刻到期的知识点，说明各逾期几天、
 *    还有多少可复验的题。空队列是正常状态，不是错误。
 * 2. **作答**：题单是开始那一刻由后端定下的（不是前端现抽），所以刷新页面
 *    回来还是同一批题；每题答完立刻显示作者预写的反馈。
 * 3. **结果**：按知识点分别判 —— A 记得牢、B 忘了，不能让 B 的遗忘把 A 的
 *    间隔一起退回去。结果里同时给出 `current`（降了）与 `achieved`（没降），
 *    这是票 07 验收第 3 条要学习者能看见的事实。
 *
 * ## 判分不是「答完最后一题自动触发」
 *
 * 判分是显式按钮。学习者可能中途离开去查资料，判早了会把没做的题算成答错。
 */
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
  MessageBarTitle,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useNavigate, useSearchParams } from 'react-router';
import {
  useCompleteReviewRound,
  useReviewQueue,
  useReviewRound,
  useStartReviewRound,
  useSubmitAttempt,
} from '../api/queries';
import type {
  ReviewCompleteResponse,
  ReviewQueueResponse,
  ReviewRoundDetailResponse,
} from '../api/queries';
import { ApiClientError } from '../api/fetcher';
import { QuestionView } from '../level/QuestionView';
import type { AnswerMeta } from '../level/QuestionView';
import type { LevelItem } from '../level/flow';
import { MasteryMeter } from '../level/MasteryMeter';
import { plainText } from '../level/markdown';

const useStyles = makeStyles({
  page: {
    padding: '32px',
    maxWidth: '880px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
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
  sectionTitle: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
  },
  card: {
    padding: '18px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  dueRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  dueName: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
  },
  meta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
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
  statRow: {
    display: 'flex',
    gap: '28px',
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
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
  },
  questionHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  centered: {
    display: 'flex',
    justifyContent: 'center',
    padding: '48px 0',
  },
  outcomeCard: {
    padding: '16px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  outcomeHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  message: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
  },
});

const VERDICT_LABEL: Record<'passed' | 'failed', string> = {
  passed: '通过了',
  failed: '没通过',
};

const VERDICT_COLOR: Record<'passed' | 'failed', 'success' | 'warning'> = {
  passed: 'success',
  failed: 'warning',
};

/**
 * 复验题的形状 → 播放器组件的形状。
 *
 * 复验题与关卡题的字段几乎重合，只有三处不同：没有 `answer`（判对错在服务端）、
 * 没有 `hintLadder`/`sourceRef`/`pool`/`kind`。这里补上「不影响渲染」的默认值，
 * 让 `QuestionView` 不必为复验分叉。
 *
 * `answer` 给 `0` 是刻意的：`QuestionView` 只用 `typeof item.answer === 'number'`
 * 判断「这是选择题还是填空题」，复验题一律带选项，所以只要是数字即可。
 * 真正的判分在服务端，这个字段从不参与对错判定。
 */
function toLevelItem(question: ReviewRoundDetailResponse['items'][number]): LevelItem {
  return {
    id: question.itemId,
    kind: 'concept',
    stem: question.stem,
    options: question.options,
    answer: 0,
    variantGroup: question.variantGroup,
    explainCorrect: question.explainCorrect,
    explainWrong: question.explainWrong,
    misconceptionTags: question.misconceptionTags,
    sourceRef: null,
    pool: 'core',
    hintLadder: [],
  };
}

/**
 * 一轮复验的作答区。题单一旦开始就固定，刷新后从后端读回同一份。
 *
 * ## 为什么每题有「已提交、待核对」这一态
 *
 * 关卡里的题对错是本地判的（`spec.items.answer` 就在手上），复验题刻意不带
 * 答案（判对错必须在服务端，否则前端能改分数）。所以复验的反馈必然分两步：
 * 先把「已提交」这件事定下来（选项锁死，不能改），等后端返回后再显示预写的
 * `explainCorrect` / `explainWrong`。
 *
 * 中间那一态**不能**用「答对了/答错了」任一个去填。用「答错了」兜底会让每个
 * 答对的人在等待期间先被误告一次；用「答对了」兜底则是骗人。
 */
function ReviewRoundPlayer({
  roundId,
  detail,
  onFinished,
}: {
  roundId: string;
  detail: ReviewRoundDetailResponse;
  onFinished: (result: ReviewCompleteResponse) => void;
}) {
  const styles = useStyles();
  const submitAttempt = useSubmitAttempt();
  const complete = useCompleteReviewRound();
  const [answers, setAnswers] = useState<
    Record<string, { choice: number | string; correct: boolean | null }>
  >({});
  const [recordErrors, setRecordErrors] = useState<Record<string, string>>({});
  const [completeError, setCompleteError] = useState<string | undefined>(undefined);

  const answeredCount = Object.keys(answers).length;
  const itemCount = detail.items.length;

  const submit = (
    question: ReviewRoundDetailResponse['items'][number],
    choice: number | string,
    meta: AnswerMeta,
  ) => {
    // 第一步：本地立即锁住这道题（「已提交」是本地事实，不需要等网络）
    setAnswers((current) => ({
      ...current,
      [question.itemId]: { choice, correct: null },
    }));
    submitAttempt.mutate(
      {
        itemId: question.itemId,
        answer: choice,
        latencyMs: meta.latencyMs,
        hintsUsed: meta.hintsUsed,
        reviewRoundId: roundId,
      },
      {
        onSuccess: (data) => {
          // 第二步：后端判完，换成真正的对错 —— 这时才显示预写反馈
          setAnswers((current) => ({
            ...current,
            [question.itemId]: { choice, correct: data.attempt.correct },
          }));
        },
        onError: (error) => {
          setRecordErrors((current) => ({
            ...current,
            [question.itemId]:
              error instanceof ApiClientError ? error.message : '这条作答没能记进档案',
          }));
        },
      },
    );
  };

  const runComplete = () => {
    setCompleteError(undefined);
    complete.mutate(roundId, {
      onSuccess: (data) => onFinished(data),
      onError: (error) => {
        setCompleteError(error instanceof ApiClientError ? error.message : '判分失败，请重试');
      },
    });
  };

  return (
    <>
      <div className={styles.section}>
        <div className={styles.questionHead}>
          <Text className={styles.sectionTitle}>这一轮复验</Text>
          <Badge appearance="tint" color="brand" style={{ whiteSpace: 'nowrap' }}>
            共 {itemCount} 题
          </Badge>
          <Badge appearance="outline" style={{ whiteSpace: 'nowrap' }}>
            已答 {answeredCount}/{itemCount}
          </Badge>
        </div>
        <Caption1 className={styles.meta}>
          题目按变式组交错排列 —— 不会连着考同一个知识点。复验题不重出你做过的原题。
        </Caption1>
      </div>

      {detail.items.map((question) => {
        const answer = answers[question.itemId];
        const item = toLevelItem(question);
        return (
          <div key={question.itemId} className={styles.section}>
            <div className={styles.questionHead}>
              <Badge appearance="tint" size="small" style={{ whiteSpace: 'nowrap' }}>
                第 {question.ordinal} 题
              </Badge>
              <Text className={styles.dueName}>{question.microKpName}</Text>
            </div>
            <QuestionView
              item={item}
              submitted={
                answer === undefined
                  ? undefined
                  : answer.correct === null
                    ? {
                        choice: answer.choice,
                        feedback: {
                          itemId: question.itemId,
                          correct: false,
                          text: '',
                          misconceptionTags: [],
                          sourceRef: null,
                          masteryCredit: 0,
                          countsTowardMastery: true,
                          origin: 'spec' as const,
                        },
                      }
                    : {
                        choice: answer.choice,
                        feedback: {
                          itemId: question.itemId,
                          correct: answer.correct,
                          // 预写反馈：答完立即显示，不调模型
                          text: answer.correct ? question.explainCorrect : question.explainWrong,
                          misconceptionTags: answer.correct ? [] : question.misconceptionTags,
                          sourceRef: null,
                          masteryCredit: 0,
                          countsTowardMastery: true,
                          origin: 'spec' as const,
                        },
                      }
              }
              verdictPending={answer !== undefined && answer.correct === null}
              onSubmit={(choice, meta) => submit(question, choice, meta)}
              recording={
                recordErrors[question.itemId] === undefined
                  ? undefined
                  : { kind: 'failed', message: recordErrors[question.itemId] as string }
              }
            />
          </div>
        );
      })}

      {completeError !== undefined && (
        <MessageBar intent="error">
          <MessageBarBody>
            <MessageBarTitle>判分没成功</MessageBarTitle>
            {completeError}
          </MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.footer}>
        <Button
          appearance="primary"
          onClick={runComplete}
          disabled={complete.isPending || answeredCount < itemCount}
        >
          {complete.isPending ? '判分中…' : '交卷并判分'}
        </Button>
        <Text className={styles.meta}>
          {answeredCount < itemCount
            ? `还有 ${itemCount - answeredCount} 道没答，答完才能判`
            : '判分是显式动作：没答完的题不会被算成答错'}
        </Text>
      </div>
    </>
  );
}

/** 复验结果：按知识点分别给出「通过了没有 / 下次什么时候 / 哪几道答错」。 */
function ReviewResult({ result }: { result: ReviewCompleteResponse }) {
  const styles = useStyles();
  const navigate = useNavigate();

  return (
    <>
      <div className={styles.section}>
        <div className={styles.titleRow}>
          <Text className={styles.sectionTitle}>这一轮复验结束了</Text>
          <Badge
            appearance="tint"
            color={result.round.verdict === 'passed' ? 'success' : 'warning'}
            style={{ whiteSpace: 'nowrap' }}
          >
            {result.round.verdict === null ? '未判分' : VERDICT_LABEL[result.round.verdict]}
          </Badge>
        </div>
        <Caption1 className={styles.meta}>
          共 {result.round.itemCount} 题，答对 {result.round.correctCount ?? 0} 题。
          每个知识点单独判、单独排期 —— 一个没记住不会拖累另一个的间隔。
        </Caption1>
      </div>

      {result.outcomes.map((outcome) => (
        <Card key={outcome.microKpId} className={styles.outcomeCard} appearance="outline">
          <div className={styles.outcomeHead}>
            <Text className={styles.dueName}>{outcome.name}</Text>
            <Badge
              appearance="tint"
              color={VERDICT_COLOR[outcome.verdict]}
              style={{ whiteSpace: 'nowrap' }}
            >
              {VERDICT_LABEL[outcome.verdict]}
            </Badge>
            <Caption1 className={styles.meta}>
              答对 {outcome.correct}/{outcome.total} 题
            </Caption1>
          </div>
          <Text className={styles.message}>{outcome.message}</Text>
          <div className={styles.statRow}>
            <div className={styles.stat}>
              <Text className={styles.statLabel}>间隔档位</Text>
              <Text className={styles.statValue}>第 {outcome.stage + 1} 档</Text>
            </div>
            <div className={styles.stat}>
              <Text className={styles.statLabel}>下次复验</Text>
              <Text className={styles.statValue}>{formatDue(outcome.nextDueAt)}</Text>
            </div>
          </div>
          {outcome.wrongItemIds.length > 0 && (
            <Caption1 className={styles.meta}>
              这次答错的是：{outcome.wrongItemIds.join('、')}
            </Caption1>
          )}
        </Card>
      ))}

      {result.mastery.length > 0 && (
        <div className={styles.section}>
          <Text className={styles.sectionTitle}>复验之后的掌握度</Text>
          <Caption1 className={styles.meta}>
            「历史最高」不回落，用来解锁；「当前熟练度」会随时间与遗忘回落。复验没通过时下调的
            只有后者 —— 你曾经达到过的高度不会被这次遗忘抹掉。
          </Caption1>
          {result.mastery.map((view) => (
            <Card key={view.microKpId} className={styles.card} appearance="outline">
              <CardHeader
                header={<Text className={styles.dueName}>{view.name}</Text>}
                description={
                  <Caption1 className={styles.meta}>
                    第 {view.attemptCount} 次作答 · {view.variantCount} 个变式
                  </Caption1>
                }
              />
              <MasteryMeter view={view} />
            </Card>
          ))}
        </div>
      )}

      <div className={styles.footer}>
        <Button appearance="primary" onClick={() => navigate('/board')}>
          回到看板
        </Button>
        <Button appearance="secondary" onClick={() => navigate('/map')}>
          去知识地图
        </Button>
      </div>
    </>
  );
}

/** `2026-10-23T...` → `10 月 23 日`。到期日只需要日期粒度。 */
function formatDue(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  const date = new Date(parsed);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

/** 队列视图：此刻到期、按到期先后列出。 */
function ReviewQueueList({ queue }: { queue: ReviewQueueResponse }) {
  const styles = useStyles();
  const navigate = useNavigate();

  if (queue.due.length === 0) {
    return (
      <>
        <Card className={styles.card} appearance="outline">
          <CardHeader
            header={<Text className={styles.dueName}>今天没有要复验的内容</Text>}
            description="复验只在你已经掌握、而且到期了的时候才会出现。学完并掌握新的知识点之后，它会在 1 天后回来找你。"
          />
        </Card>
        <div className={styles.footer}>
          <Button appearance="primary" onClick={() => navigate('/board')}>
            回到看板
          </Button>
          <Button appearance="secondary" onClick={() => navigate('/map')}>
            去知识地图
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className={styles.section}>
        <Text className={styles.sectionTitle}>到期的知识点</Text>
        <Caption1 className={styles.meta}>
          按到期先后排列。一次复验最多抽 5 题，会跨这些知识点交错出题。
        </Caption1>
      </div>
      {queue.due.map((entry) => (
        <Card key={entry.microKpId} className={styles.card} appearance="outline">
          <div className={styles.dueRow}>
            <Text className={styles.dueName}>{entry.name}</Text>
            <Badge
              appearance="tint"
              color={entry.overdueDays > 0 ? 'warning' : 'informative'}
              style={{ whiteSpace: 'nowrap' }}
            >
              {entry.overdueDays > 0 ? `逾期 ${entry.overdueDays} 天` : '今天到期'}
            </Badge>
            <Badge appearance="outline" style={{ whiteSpace: 'nowrap' }}>
              第 {entry.reviewStage + 1} 档 · 间隔 {entry.intervalDays} 天
            </Badge>
          </div>
          <Caption1 className={styles.meta}>
            可复验的题 {entry.availableItemCount} 道 · 原定 {formatDue(entry.nextDueAt)} 复验
          </Caption1>
        </Card>
      ))}
    </>
  );
}

export function ReviewPage() {
  const styles = useStyles();
  const [searchParams] = useSearchParams();
  const roundId = searchParams.get('round') ?? undefined;

  const queue = useReviewQueue();
  const start = useStartReviewRound();
  const round = useReviewRound(roundId);
  const [startedRoundId, setStartedRoundId] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<ReviewCompleteResponse | undefined>(undefined);
  const [startError, setStartError] = useState<string | undefined>(undefined);

  const activeRoundId = roundId ?? startedRoundId;
  // 刚判完的结果优先；否则读后端那一轮（刷新回来仍是同一份题单/结果）
  const detail: ReviewRoundDetailResponse | undefined = round.payload;
  const finished = useMemo(() => {
    if (result !== undefined) return result;
    if (detail === undefined) return undefined;
    if (detail.round.verdict === null) return undefined;
    return {
      round: detail.round,
      outcomes: detail.outcomes,
      mastery: detail.mastery,
    } satisfies ReviewCompleteResponse;
  }, [result, detail]);

  const begin = () => {
    setStartError(undefined);
    start.mutate(undefined, {
      onSuccess: (data) => setStartedRoundId(data.round.roundId),
      onError: (error) => {
        setStartError(
          error instanceof ApiClientError && error.status === 409
            ? error.message
            : error instanceof ApiClientError
              ? error.message
              : '开始复验失败，请重试',
        );
      },
    });
  };

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.titleRow}>
          <Text as="h1" className={styles.title}>
            复验
          </Text>
        </div>
        <Text className={styles.subtitle}>
          已经掌握的知识点会按 1 / 3 / 7 / 21 / 60 天回来找你。没通过只下调当前熟练度，
          历史最高不会掉。
        </Text>
      </div>

      {startError !== undefined && (
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>现在还开不了复验</MessageBarTitle>
            {startError}
          </MessageBarBody>
        </MessageBar>
      )}

      {finished !== undefined ? (
        <ReviewResult result={finished} />
      ) : activeRoundId !== undefined && round.isPending ? (
        <div className={styles.centered}>
          <Spinner label="正在读这一轮复验的题单…" />
        </div>
      ) : activeRoundId !== undefined && detail !== undefined && detail.round.verdict === null ? (
        <ReviewRoundPlayer
          roundId={activeRoundId}
          detail={detail}
          onFinished={(data) => setResult(data)}
        />
      ) : queue.isPending ? (
        <div className={styles.centered}>
          <Spinner label="正在看有没有到期的复验…" />
        </div>
      ) : queue.payload !== undefined ? (
        <>
          <ReviewQueueList queue={queue.payload} />
          {queue.payload.due.length > 0 && (
            <div className={styles.footer}>
              <Button appearance="primary" onClick={begin} disabled={start.isPending}>
                {start.isPending ? '正在抽题…' : '开始复验'}
              </Button>
              <Text className={styles.meta}>
                每次 3–5 题，从不同变式组里抽 —— 不会出你做过的那道原题。
              </Text>
            </div>
          )}
        </>
      ) : (
        <div className={styles.centered}>
          <Spinner label="正在看有没有到期的复验…" />
        </div>
      )}

      <Body1 className={styles.meta}>
        复验题与普通作答走同一套掌握度更新 —— 没有第二套算法。
      </Body1>
    </div>
  );
}
