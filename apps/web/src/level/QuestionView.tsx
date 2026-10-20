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
  const locked = submitted !== undefined;
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
            已作答，本关内不可重答
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

      {submitted && (
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

      {submitted && submitted.feedback.sourceRef !== null && (
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
