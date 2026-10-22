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
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { CheckmarkCircleFilled, DismissCircleFilled } from '@fluentui/react-icons';
import type { LevelItem } from './flow';
import type { Feedback } from './flow';
import type { SubmissionStatus } from './attempts';
import { RichText, plainText } from './markdown';

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
  /**
   * 单个选项。**未选中态必须有可见边界**：单选项没有边界时，学习者只能靠
   * 「圆点在不在」判断选没选中，而圆点只有 16px —— 一屏四五个选项时，
   * 视线要先找圆点再回到文字，成本比一条边框高得多。
   *
   * 描边色用 `colorNeutralStrokeAccessible`（= `--sm-border-control`，
   * 深 3.61 / 亮 4.82 对 `bg-surface`），不用 `colorNeutralStroke2`
   * （= `border-hairline`，深 1.09 / 亮 1.23，等于没有边界）。
   */
  option: {
    padding: '6px 8px',
    borderRadius: tokens.borderRadiusMedium,
    /**
     * 用 `border` 简写，**不能写 `borderColor` / `borderStyle` 这类长写**：
     * Griffel 的类型层禁止同一次 `makeStyles` 里混用简写与长写（长写会被
     * 标成 `undefined`），这条规则在 `apps/web/src/agent/EvidencePanel.tsx:54`
     * 已有先例。所以下面 `optionSelected` / `optionLocked` 也全部重写整条
     * `border`，而不是只改其中一段。
     */
    border: `1px solid ${tokens.colorNeutralStrokeAccessible}`,
    /**
     * 焦点环交给 UA 的 `outline: auto`（`color-scheme` 已由主题层设好，
     * 深色下 UA 会画浅色环）。这里**不写 `outline: none`** —— 覆盖它就得
     * 自己重画一套，而自画的环在 Windows 高对比度模式下会被抹掉。
     * 内阴影是**补充**（画在边框内侧，不与 outline 抢同一圈像素）。
     */
    ':focus-within': {
      boxShadow: `inset 0 0 0 2px ${tokens.colorStrokeFocus2}`,
    },
  },
  /**
   * 已选中。背景换成 `colorNeutralBackground1Selected`（= `--sm-bg-selected`，
   * 深底近黑 / 亮底近粉），描边换成品牌色 —— 底色 + 描边 + 圆点
   * 三重编码，色弱学习者即使分不出底色也能看见描边变粗。
   */
  optionSelected: {
    background: tokens.colorNeutralBackground1Selected,
    border: `1px solid ${tokens.colorBrandStroke1}`,
  },
  /**
   * 已锁定（交卷后）。**刻意不让它「变淡」**：把禁用态画成低对比度是
   * 最省事的做法，代价是低视力学习者读不出自己刚选了什么 —— 而「我刚才
   * 选了哪个」正是交卷后最该能看清的信息。
   *
   * 所以禁用靠**虚线边框**（形状通道）表示。WCAG 1.4.11 对禁用控件本可
   * 豁免，这里不豁免。
   *
   * 颜色用 `colorNeutralForeground2`（= `--sm-text-secondary`）而不是
   * `colorNeutralStrokeAccessible`（= `border-control`）：锁定态可能落在
   * `bg-selected` 上（刚选中的那一项），而 `border-control` 对深色
   * `bg-selected` 只有 **2.82:1**，正好卡在 3:1 之下。`text-secondary`
   * 对 `bg-surface` 7.73 / 6.04（深）、`bg-selected` 6.04 / 6.34（浅），
   * 两种底、两套主题全部远超 3:1。
   */
  optionLocked: {
    border: `1px dashed ${tokens.colorNeutralForeground2}`,
    color: tokens.colorNeutralForeground2,
  },
  actions: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  /**
   * 对：绿底 + 绿边。边用 `colorPaletteGreenBorder1`（= `--sm-success`，
   * 深 9.43 / 亮 4.78 对各自 soft 底，均 ≥3）。
   *
   * **左侧 3px 竖条**是第二重编码：颜色之外给一个形状信号，色弱学习者
   * 靠「左边有一条粗线」也能认出这是结果条。用 `border-left` 而不是
   * 伪元素，是因为它在打印与高对比度模式下都不会被丢掉。
   */
  correctBar: {
    background: tokens.colorPaletteGreenBackground1,
    border: `1px solid ${tokens.colorPaletteGreenBorder1}`,
    borderLeft: `3px solid ${tokens.colorPaletteGreenBorder1}`,
  },
  /**
   * 错：警示底 + 警示边。**边色不是 Fluent 的 palette 黄**（亮主题下
   * 没有任何 Fluent 黄能到 3:1，最高 1.30），而是本仓的 `--sm-warning`
   * （深主题偏亮的琥珀、亮主题偏暗的褐，对各自 soft 底 7.98 / 5.67）。
   *
   * 这里用 `colorPaletteDarkOrangeBorder1`（theme.ts 把它映射到
   * `palette['warning']`）而不是 `colorPaletteYellowBorder1`：两者值相同，
   * 但「错」在本仓语义里属于警示（DarkOrange），黄色那组只为兼容 Fluent
   * 的 Badge `color="warning"` 保留。选语义正确的那个，将来有人改黄色组
   * 不会连带改坏这条反馈条。
   */
  wrongBar: {
    background: tokens.colorPaletteDarkOrangeBackground1,
    border: `1px solid ${tokens.colorPaletteDarkOrangeBorder1}`,
    borderLeft: `3px solid ${tokens.colorPaletteDarkOrangeBorder1}`,
  },
  /**
   * 已提交、对错未知（复验题）：中性底色，不暗示任何一种结果。
   *
   * 边框用 `colorNeutralStrokeAccessible`（= `border-control`）而不是
   * `colorNeutralStroke2`（= `border-hairline`，深 1.09 / 亮 1.23）：
   * 这条 bar 是「你的答案已经交上去了，正在等结果」的唯一提示，边框若
   * 淡到看不见，它就和普通的段落块没区别了。对 `bg-elevated` 是
   * 深 3.37 / 亮 4.50，两套主题都达标。
   */
  pendingBar: {
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStrokeAccessible}`,
  },
  /**
   * 结果图标。**不再 `aria-hidden`**：色弱用户、屏幕阅读器用户、以及
   * 「扫一眼就知道对错」的所有人都靠它。图标自带 `role="img"` +
   * `aria-label`，读屏会念「答对」/「没答对」。
   *
   * 字号跟着标题走（`1em`），不写死 px —— 它现在是标题行的一部分，
   * 不是装饰。
   */
  checkIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    marginRight: '6px',
    verticalAlign: '-0.125em',
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
          {item.options.map((option, index) => {
            const value = String(index);
            /**
             * 三态由 `value` 与锁定状态推出，不用额外 state：
             * - 已选中 = `draftChoice === value`（受控，React 单一真源）
             * - 锁定 = 交卷后（`locked`），此时仍要显示「选了哪个」
             */
            const selected = draftChoice === value;
            return (
              <Radio
                key={index}
                /**
                 * **必须用 `mergeClasses` 而不是字符串拼接**：Fluent 的 `Radio`
                 * 内部会对传入的 `className` 再跑一次 `mergeClasses`，如果传进去
                 * 的是几个原子类拼成的字符串，它会打警告
                 * 「a passed string contains multiple identifiers of atomic classes」，
                 * 并且**无法正确去重** —— 两个类都声明 `border` 时谁赢取决于
                 * 样式表顺序，而不是调用顺序。
                 */
                className={mergeClasses(
                  styles.option,
                  selected && styles.optionSelected,
                  locked && styles.optionLocked,
                )}
                value={value}
                label={plainText(option)}
                data-option-state={selected ? 'selected' : 'idle'}
                data-option-locked={locked ? 'true' : undefined}
              />
            );
          })}
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
              {/**
               * 图标是**语义的一部分**，不再 `aria-hidden`。
               *
               * 修复的缺陷：改之前这里是 `<span aria-hidden>✓ / △</span>`，
               * 而 ✓ 与 △ 在色弱用户眼里只差一点点形状、屏幕阅读器则完全
               * 拿不到 —— 对错只能靠底色区分（旧底 1.05:1）。现在图标带
               * `role="img"` + `aria-label`，读屏念「答对」/「没答对」；
               * 视觉上还有左侧 3px 竖条与整段文字兜底，三重通道。
               */}
              <span className={styles.checkIcon}>
                {submitted.feedback.correct ? (
                  <CheckmarkCircleFilled role="img" aria-label="答对" />
                ) : (
                  <DismissCircleFilled role="img" aria-label="没答对" />
                )}
              </span>
              {submitted.feedback.correct ? '答对了' : '这条没答对，看下错在哪'}
            </MessageBarTitle>
            {/**
              正文整段来自 spec 里作者预写的 explainCorrect / explainWrong。

              必须走 `RichText` 而不是直接插字符串：作者的讲解里带 `$…$`
              公式（吸收律那段就有四个），直插会把 `$A \oplus A·B$` 原样
              显示成源码。讲稿（CardView）早就走这个渲染器了，反馈是同一类
              作者预写内容，没有理由用两套。
            */}
            <RichText body={submitted.feedback.text} />
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
