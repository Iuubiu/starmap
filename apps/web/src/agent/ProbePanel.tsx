/**
 * 苏格拉底追问面板（票 10 的作答侧）。
 *
 * ## 为什么这张卡要能被「答」，而不只是被「看」
 *
 * 追问卡如果只是展示一个问题然后等用户再开一轮，那一次追问就只值一个回合。
 * 真正的追问是**多轮**的：答错 → 提示升级 → 再答 → 命中则停 / 连续无进展则
 * 退出。这些状态全在服务端的 `nextLadder` 里（纯函数、非 LLM），前端只负责
 * 把每一轮的回复贴上去。
 *
 * ## 为什么不是聊天气泡
 *
 * 下面那段「阶梯记录」刻意做成带标签的表格行而不是左右气泡：气泡会让人以为
 * 这是自由对话，于是开始解释自己的思路、提问、聊天；而追问是有结构的 ——
 * 每一轮都要落到「答对了 / 部分对 / 答错 / 不知道 / 放弃 / 情绪」，状态机
 * 按这个分类决定下一步。学生的自由文本会被归类，不是被回复。
 *
 * ## 为什么把「第几级 / 上限几级」显示出来
 *
 * 学生最怕的是被无限盘问。看见 `2/3` 就知道还剩一次，愿意继续想；看不见就
 * 会觉得「它是不是永远不会告诉我」。上限由服务端策略决定（P1 封顶 3 级、
 * P3 到 5 级），前端不自己算 —— 那是票 10 的越界判定，不能出现两个真源。
 */
import { useState } from 'react';
import {
  Badge,
  Body1,
  Button,
  Caption1,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  Radio,
  RadioGroup,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useReplyProbe } from '../api/queries';
import type { ProbeTurnResponse } from '../api/generated/model';

const useStyles = makeStyles({
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  question: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightMedium,
    lineHeight: tokens.lineHeightBase400,
    padding: '12px 14px',
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
  },
  progressRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  progress: { flex: 1 },
  actions: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  trail: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '10px 12px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  trailRow: {
    display: 'grid',
    gridTemplateColumns: '64px 1fr',
    gap: '8px',
    alignItems: 'baseline',
  },
  trailKey: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

/** 学生答完之后系统给它的判定 —— 这是学生需要看到的唯一反馈。 */
const REPLY_KIND_LABEL: Record<string, string> = {
  correct: '答对了',
  partial: '部分对',
  wrong: '这步不对',
  dont_know: '不知道',
  give_up: '想先看答案',
  frustration: '有点挫败',
};

const ACTION_LABEL: Record<string, string> = {
  acknowledge: '确认',
  hint: '提示升级',
  probe_deeper: '往下追问',
  reteach: '退回重讲',
  reveal: '揭晓',
  exit: '结束追问',
};

/** 一轮交换的记录（不是气泡，是一条带标签的账目）。 */
interface TrailEntry {
  question: string;
  answer: string;
  verdict: string;
  action: string;
}

export function ProbePanel({
  probeId,
  microKpId,
  initialQuestion,
  initialLevel,
  initialCap,
  inputKind,
  choices,
  onFinished,
}: {
  probeId: string;
  microKpId: string;
  initialQuestion: string;
  initialLevel: number;
  initialCap: number;
  inputKind: 'free_text' | 'choice';
  choices: readonly string[];
  /** 追问结束时通知外层（外层可能要把产物换成「进度变化」卡）。 */
  onFinished?: (turn: ProbeTurnResponse) => void;
}) {
  const styles = useStyles();
  const reply = useReplyProbe(probeId);

  const [draft, setDraft] = useState('');
  const [current, setCurrent] = useState<ProbeTurnResponse | null>(null);
  const [trail, setTrail] = useState<TrailEntry[]>([]);

  // 当前要展示的问题永远是「最近一轮返回的问题」，没有就退回卡上的初始问题。
  const question = current?.question ?? initialQuestion;
  const level = current?.ladder.level ?? initialLevel;
  const cap = current?.ladder.cap ?? initialCap;
  const exited = current?.ladder.exited ?? false;
  const revealed = current?.action === 'reveal' || current?.action === 'exit';
  /**
   * 这一轮服务端只是「收到了、确认了」（答对），没有新问题要问。
   *
   * `acknowledge` 的 `question` 字段里放的是**状态陈述**（「对。这一步的推理
   * 是成立的，我们往下走。」），不是问句。旧实现把它当问题渲染，于是学生看到
   * 一句肯定语、下面还挂着一个等他作答的输入框和「提交这一轮」按钮 —— 答对了
   * 却被要求再答一遍，再提交还是同一句「对」。
   *
   * 所以确认轮单独处理：陈述照常显示，但**收起作答区**，把「要不要继续」交回
   * 给页面底部那句可以提交的话。
   */
  const acknowledged = current?.action === 'acknowledge';
  /**
   * 追问阶梯已经走到头（`reteach` / `exit` 两种退出方式都会置 `ladder.exited`）。
   *
   * 旧实现只在「揭晓答案」时才收起作答区，于是 `reteach` 退出后学生看到一个
   * 仍然可打字的输入框，而「提交这一问的回答」按钮因为 `canSubmit` 里的
   * `!exited` 是灰的 —— 打字没有任何反应，也没有一句话说这一问已经结束了。
   * 所以退出与揭晓同等对待：都不再提问。
   */
  const closed = exited || revealed;

  const trimmed = draft.trim();
  const canSubmit = trimmed !== '' && !reply.isPending && !closed && !acknowledged;

  const submit = async () => {
    if (!canSubmit) return;
    const answered = trimmed;
    try {
      const turn = await reply.mutateAsync({ replyText: answered });
      setTrail((previous) => [
        ...previous,
        {
          question,
          answer: answered,
          verdict: REPLY_KIND_LABEL[turn.replyKind] ?? turn.replyKind,
          action: ACTION_LABEL[turn.action] ?? turn.action,
        },
      ]);
      setCurrent(turn);
      setDraft('');
      if (turn.ladder.exited) onFinished?.(turn);
    } catch {
      // 错误由下面 `reply.isError` 统一展示；这里不吞掉状态，重试按钮复用同一段文本。
    }
  };

  return (
    <div className={styles.panel}>
      <Body1 className={styles.question}>{question}</Body1>

      {!closed && !acknowledged && (
        <div className={styles.progressRow}>
          <Caption1>
            提助等级 {level}/{cap}
          </Caption1>
          <ProgressBar
            className={styles.progress}
            value={cap === 0 ? 0 : level / cap}
            max={1}
            thickness="medium"
            color="warning"
            aria-label={`提示等级 ${level}，上限 ${cap}`}
          />
        </div>
      )}

      {!closed && !acknowledged && inputKind === 'choice' && choices.length > 0 ? (
        <RadioGroup value={draft} onChange={(_, data) => setDraft(data.value)}>
          {choices.map((choice, index) => (
            <Radio
              key={index}
              value={choice}
              // 选项本身作为 value：服务端判对错用的是文本比对/模型归类，
              // 传序号会让「选 C」和「写下 C 的内容」变成两种输入。
              label={`${String.fromCharCode(65 + index)}. ${choice}`}
            />
          ))}
        </RadioGroup>
      ) : (
        !closed &&
        !acknowledged && (
          <Textarea
            value={draft}
            onChange={(_, data) => setDraft(data.value)}
            placeholder="用你自己的话答，说错也没关系"
            resize="vertical"
            aria-label="追问作答"
            disabled={reply.isPending}
          />
        )
      )}

      {reply.isError && (
        <MessageBar intent="error">
          <MessageBarBody>
            这一轮没能提交：{reply.error instanceof Error ? reply.error.message : '未知错误'}
          </MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.actions}>
        {acknowledged && !exited && (
          <Badge appearance="tint" color="success">
            这一问已经答上了
          </Badge>
        )}
        {!closed && !acknowledged && (
          <Button
            appearance="primary"
            onClick={submit}
            disabled={!canSubmit}
            // 页面底部还有一颗「提交这一轮」（提交一句话）。两颗按钮同页并存时
            // 屏幕阅读器只会念出同一个名字，分不出哪颗属于哪个输入框。
            aria-label="提交这一问的回答"
          >
            {reply.isPending ? '判定中…' : '提交这一轮'}
          </Button>
        )}
        {exited && (
          <Badge appearance="filled" color="informative">
            追问已结束
          </Badge>
        )}
        {current && (
          <Caption1>
            上一轮：{REPLY_KIND_LABEL[current.replyKind] ?? current.replyKind} ·{' '}
            {ACTION_LABEL[current.action] ?? current.action}
          </Caption1>
        )}
      </div>

      {trail.length > 0 && (
        <div className={styles.trail} aria-label="追问记录">
          {trail.map((entry, index) => (
            <div key={index} className={styles.trailRow}>
              <Text className={styles.trailKey}>第 {index + 1} 轮</Text>
              <Text size={200}>
                {entry.answer} → {entry.verdict}（{entry.action}）
              </Text>
            </div>
          ))}
        </div>
      )}

      <Caption1>知识点 {microKpId} · 追问 {probeId.slice(-8)}</Caption1>
    </div>
  );
}
