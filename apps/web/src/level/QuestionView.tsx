/**
 * 一道题的作答视图：选项 / 填空 + 提交 + **立即显示的预写反馈** + 提示阶梯。
 *
 * 三条设计约束，都直接对应票 04 的验收：
 *
 * 1. **反馈不等模型**：`onSubmit` 是同步回调，父组件从 spec 里取
 *    `explainCorrect/explainWrong` 回填。这里没有 loading 态、没有
 *    `isPending`，因为不存在需要等待的事情。验收 3。
 * 2. **反馈区分对错且给错因**：答错时不仅说「错了」，还列出
 *    `misconceptionTags`（作者写的中文错因标签），让学习者知道自己是哪一类
 *    误解，而不是只知道结果。验收 3 的「有预先写好的反馈」要做到底。
 * 3. **提交后不可改**：一旦提交就是证据（票 05 要拿它更新 BKT），所以选项
 *    立刻禁用、提交按钮消失。想重来请重开关卡，而不是重答同一题。
 *
 * 提示阶梯（`hintLadder`）是**逐步展开**的：一次只多给一条，最后一条才是
 * 接近答案的提示。一次性全摊开等于直接给答案。
 */
import { useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Radio,
  RadioGroup,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import type { LevelItem } from './flow';
import type { Feedback } from './flow';
import type { SubmissionStatus } from './attempts';
import { plainText } from './markdown';

const useStyles = makeStyles({
  card: {
    padding: '18px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  stemRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  stem: {
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
    fontWeight: tokens.fontWeightMedium,
  },
  metaRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  options: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  option: {
    padding: '6px 8px',
    borderRadius: tokens.borderRadiusMedium,
  },
  actions: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  /** 对：绿底。错：红底但**不写「错误」两个大字**——写「再想一下这条规则」。 */
  correctBar: {
    background: tokens.colorPaletteGreenBackground1,
    border: `1px solid ${tokens.colorPaletteGreenBorder1}`,
  },
  wrongBar: {
    background: tokens.colorPaletteYellowBackground1,
    border: `1px solid ${tokens.colorPaletteYellowBorder1}`,
  },
  /** 已提交、对错未知（复验题）：中性底色，不暗示任何一种结果。 */
  pendingBar: {
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  checkIcon: {
    fontFamily: tokens.fontFamilyMonospace,
    fontWeight: tokens.fontWeightBold,
  },
  tags: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
    marginTop: '6px',
  },
  hints: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  hintLine: {
    display: 'flex',
    gap: '8px',
    lineHeight: tokens.lineHeightBase300,
  },
  source: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  /**
   * 记账状态行。**三态都要有像素**，尤其 `failed` —— 悄悄吞掉失败等于告诉学习者
   * 「你的作答进档案了」，而掌握度其实没动。
   */
  recordLine: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  recordFailed: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorPaletteDarkOrangeForeground1,
  },
});

export interface QuestionViewProps {
  item: LevelItem;
  /** 已提交的选择；`undefined` 表示还没作答。 */
  submitted: { choice: number | string; feedback: Feedback } | undefined;
  /**
   * 提交回调。`meta` 带这次作答的过程量（用了几级提示、想了多久），
   * 它们**不是**判分依据，而是票 05 的 BKT 与票 07 的复验要用的信号：
   * 「8 分钟才蒙对」与「3 秒答对」在证据里不该同权。
   */
  onSubmit: (choice: number | string, meta: AnswerMeta) => void;
  /** 这一段不改变掌握度时显示的说明（深究分支）。 */
  nonScoring?: boolean;
  /**
   * 这条作答的记账状态（票 05）。`undefined` = 还没提交。
   *
   * 与 `submitted` 分开：反馈是**本地**事实（已答、对错已定），记账是**远端**事实
   * （后端收没收下）。两者在失败时不是同一件事，合成一个状态就只能挑一个说谎。
   */
  recording?: SubmissionStatus;
  /**
   * 已提交但**对错还没定**（票 07 的复验题）。
   *
   * 关卡里的题对错是本地判的（`spec.items.answer` 就在手上），所以反馈零延迟。
   * 复验题刻意不带答案（判对错在服务端），提交后要等一次后端响应才知道对错。
   * 这两种情况下「用户已经不能改了」是共同的，但该显示什么不同：前者立刻给预写
   * 反馈，后者只能先说「已提交，正在核对」，**不能**拿 `false` 兜底冒充「答错了」。
   */
  verdictPending?: boolean;
  /**
   * 本档要求「整段提交后统一反馈」（P3）。
   *
   * 与 `verdictPending` 是**两件事**，不能合并：
   * - `verdictPending` = **我**不知道对错（等后端判），只能如实说「正在核对」；
   * - `deferredFeedback` = **我知道**但对你不说 —— 这是 P3 的 reduced-feedback
   *   设计（票 12），满口说出来会给高先备者多余的打断，但也不能装成在等系统。
   *
   * 两者的中性条文案必须不同，否则学生会以为系统卡住了。
   * 优先级：`verdictPending` 高于 `deferredFeedback`（真不知道的情况更该如实说）。
   */
  deferredFeedback?: boolean;
  /**
   * 还剩几次提交机会（票 12）。`undefined` 表示不显示这一行。
   *
   * 只在**大于 0** 且有理由显示时传。为 0 时组件不锁题（锁不锁由 `submitted`
   * 决定）—— 但页面在次数用完时会传 `submitted`，两者职责不重叠：
   * 这里只是「还剩几次」的展示，不是可提交性的判断。
   */
  attemptsLeft?: number;
}

/** 一次作答的过程量。两者都不影响对错，只影响证据的权重。 */
export interface AnswerMeta {
  /** 用了几级提示（0 = 裸答）。 */
  hintsUsed: number;
  /**
   * 从这道题**首次出现在屏幕上**到提交的毫秒数。
   *
   * `null` 表示没有测到（组件挂载与提交之间没有拿到时间基准）——
   * 与「0 毫秒」是两件事，所以不能拿 0 兜底。
   */
  latencyMs: number | null;
}

export function QuestionView({
  item,
  submitted,
  onSubmit,
  nonScoring,
  recording,
  verdictPending,
  deferredFeedback,
  attemptsLeft,
}: QuestionViewProps) {
  const styles = useStyles();
  const [draftChoice, setDraftChoice] = useState<string>('');
  const [draftText, setDraftText] = useState('');
  const [revealedHints, setRevealedHints] = useState(0);

  /**
   * 计时起点。用 `useRef` 而不是 `useState`：它不进渲染输出，写它不该触发重渲染。
   *
   * 在首次渲染时初始化（`useState` 的惰性初值同理，但 ref 更直白），
   * 而不是在 `submit` 里读 `Date.now()` 再减 —— 那样差值永远是 0。
   */
  const startedAt = useRef<number | null>(Date.now());

  const isChoice = typeof item.answer === 'number';
  /**
   * 能不能再提交。
   *
   * `submitted` 有值 = 已答过一次。默认这就是锁（票 04 的行为），但票 12 的
   * P1/P2 允许两次：页面会在「答错且还有次数」时**不传** `submitted` 之外
   * 还额外传 `attemptsLeft > 0`，此时不锁。
   *
   * 锁定判断放这里而不是页面里：页面自己决定 `submitted` 传不传，会出现
   * 「组件以为锁了、页面以为还能试」的两套真相。
   */
  const retryable = attemptsLeft !== undefined && attemptsLeft > 0;
  const locked = submitted !== undefined && !retryable;
  /**
   * 对错要不要现在就亮。
   *
   * 两种不亮的情况：`verdictPending`（真的不知道）与 `deferredFeedback`
   * （知道但不说）。两者在中性条里写不同的话，所以不合并成一个布尔值。
   */
  const withheld = verdictPending === true || deferredFeedback === true;
  const hintLadder = item.hintLadder;
  const hasHints = hintLadder.length > 0;
  const canSubmit = isChoice ? draftChoice !== '' : draftText.trim() !== '';

  const submit = () => {
    if (!canSubmit || locked) return;
    const started = startedAt.current;
    const meta: AnswerMeta = {
      hintsUsed: revealedHints,
      latencyMs: started === null ? null : Math.max(0, Date.now() - started),
    };
    if (isChoice) onSubmit(Number(draftChoice), meta);
    else onSubmit(draftText.trim(), meta);
  };

  return (
    <Card className={styles.card} appearance="outline">
      <div className={styles.stemRow}>
        <div className={styles.metaRow}>
          <Badge
            appearance="tint"
            color={item.pool === 'practice' ? 'informative' : 'brand'}
            size="small"
            style={{ whiteSpace: 'nowrap' }}
          >
            {item.pool === 'practice' ? '练习（不计分）' : '判定题'}
          </Badge>
          {nonScoring && (
            <Badge appearance="outline" size="small" style={{ whiteSpace: 'nowrap' }}>
              本段不影响掌握度
            </Badge>
          )}
        </div>
        <Text className={styles.stem}>{plainText(item.stem)}</Text>
        {/*
          还剩几次机会（票 12）：只在「还能再试」时显示。
          答对后 `attemptsLeft` 为 0，这一行消失 —— 否则会出现「已答对但仍提示
          还能再试一次」这种自相矛盾的消息。
        */}
        {retryable && submitted !== undefined && (
          <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
            还可以再试 {attemptsLeft} 次
          </Text>
        )}
      </div>

      {isChoice ? (
        <RadioGroup
          className={styles.options}
          value={draftChoice}
          onChange={(_, data) => setDraftChoice(data.value)}
          disabled={locked}
        >
          {item.options.map((option, index) => (
            <Radio
              key={index}
              className={styles.option}
              value={String(index)}
              label={plainText(option)}
            />
          ))}
        </RadioGroup>
      ) : (
        <Textarea
          value={draftText}
          onChange={(_, data) => setDraftText(data.value)}
          placeholder="填写化简后的结果"
          disabled={locked}
          resize="vertical"
          aria-label="答案填空"
        />
      )}

      <div className={styles.actions}>
        {!locked && (
          <Button appearance="primary" onClick={submit} disabled={!canSubmit}>
            提交答案
          </Button>
        )}
        {!locked && hasHints && revealedHints < hintLadder.length && (
          <Button
            appearance="subtle"
            onClick={() => setRevealedHints((count) => count + 1)}
            icon={<span aria-hidden>?</span>}
          >
            给一点提示（{revealedHints}/{hintLadder.length}）
          </Button>
        )}
        {locked && (
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {verdictPending ? '已提交，正在核对…' : '已作答，本关内不可重答'}
          </Text>
        )}
        {/* 还能再试时给一句理由，不然“选项又可点了”看起来像 bug。 */}
        {!locked && submitted !== undefined && retryable && (
          <Text size={200} style={{ color: tokens.colorPaletteDarkOrangeForeground1 }}>
            这一次没答对，还有 {attemptsLeft} 次机会
          </Text>
        )}
      </div>

      {revealedHints > 0 && (
        <div className={styles.hints} aria-live="polite">
          <Divider />
          {hintLadder.slice(0, revealedHints).map((hint, index) => (
            <div key={index} className={styles.hintLine}>
              <span aria-hidden>›</span>
              <span>提示 {index + 1}：{plainText(hint)}</span>
            </div>
          ))}
        </div>
      )}

      {submitted && verdictPending && (
        /**
         * 票 07 的复验题：题面不带答案，对错要等后端。这里**不能**先用
         * `correct:false` 冒充「答错了」—— 那会让每个答对的人在等待的几十
         * 毫秒里先被告诉一次「你答错了」。预写反馈等判定结果回来再显示。
         */
        <MessageBar className={styles.pendingBar} layout="multiline" aria-live="polite">
          <MessageBarBody>
            <MessageBarTitle>已提交，正在核对</MessageBarTitle>
            这道题的答案不在题面上，判对错要等服务端比对一次。
          </MessageBarBody>
        </MessageBar>
      )}

      {/**
       * P3 档的整段延迟反馈（票 12）：**知道**对错，但按设计不在这一步说。
       * 文案必须与「正在核对」区分 —— 后者会让学生以为系统卡住了。
       */}
      {submitted && !verdictPending && deferredFeedback && (
        <MessageBar className={styles.pendingBar} layout="multiline">
          <MessageBarBody>
            <MessageBarTitle>本题不即时给对错</MessageBarTitle>
            这一档把反馈收到整段末尾，一次说清这一段里的共性问题。答完直接往下一题走。
          </MessageBarBody>
        </MessageBar>
      )}

      {submitted && !withheld && (
        <MessageBar
          className={submitted.feedback.correct ? styles.correctBar : styles.wrongBar}
          layout="multiline"
          aria-live="polite"
        >
          <MessageBarBody>
            <MessageBarTitle>
              <span className={styles.checkIcon} aria-hidden>
                {submitted.feedback.correct ? '✓ ' : '△ '}
              </span>
              {submitted.feedback.correct ? '答对了' : '这条没答对，看下错在哪'}
            </MessageBarTitle>
            {/* 正文整段来自 spec 里作者预写的 explainCorrect / explainWrong。 */}
            {submitted.feedback.text}
            {submitted.feedback.misconceptionTags.length > 0 && (
              <div className={styles.tags}>
                {submitted.feedback.misconceptionTags.map((tag) => (
                  <Badge
                    key={tag}
                    appearance="tint"
                    color="warning"
                    size="small"
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </MessageBarBody>
        </MessageBar>
      )}

      {submitted && !withheld && submitted.feedback.sourceRef !== null && (
        <Text className={styles.source}>溯源：{submitted.feedback.sourceRef}</Text>
      )}

      {/**
       * 记账状态。只有 `recorded` 与 `failed` 两种落定态才值得一行字：
       * `pending` 通常只存在几十毫秒，为它闪一句「正在记账」反而像卡住了。
       * 失败必须显示 —— 这是本页唯一会告诉学习者「掌握度这次没更新」的地方。
       */}
      {recording?.kind === 'recorded' && (
        <Text className={styles.recordLine}>已记入学习档案（第 {recording.record.attemptNo} 次）</Text>
      )}
      {recording?.kind === 'failed' && (
        <Text className={styles.recordFailed}>
          这条作答没能记进档案：{recording.message}。掌握度这次不会更新。
        </Text>
      )}
    </Card>
  );
}
