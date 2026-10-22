/**
 * 欢迎页「初识」（票 78）。
 *
 * ## 一屏一问，是为了让「为什么问这个」有地方放
 *
 * 票面要求每一问都配一句「为什么问这个」。把十问塞进一张表单，「为什么」就只能
 * 塞进标签的 title 或一行灰色小字 —— 那不是解释，是装饰。一次一问时，那句
 * 解释和选项在同一屏里，学生读完就知道该不该答、值不值得跳过。
 *
 * ## 为什么是 PATCH 而不是「最后统一提交」
 *
 * 统一提交要先在本地攒十份答案，中途刷新就全丢；而「改单题」又必须能只改一个
 * 字段。两件事指向同一条实现：每答一题就写一次，服务端合并。代价是十个请求，
 * 在本地单用户场景可以接受。
 *
 * ## 跳过为什么也发请求
 *
 * 「跳过」是学生的真实表达，要在画像里留下 `null` —— 它与「还没问到」在数据上
 * 同形（都是 null），但语义上必须由这次写入记下来：下次进入时跳过项仍然显示
 * 「未填写」，而不是被一个默认值填上。`null` 不会被上一题的值覆盖（只有同一个
 * 字段才会），所以这里的安全边界是「字段」而不是「记录」。
 *
 * ## `profileDone` 为什么在 localStorage 而不在服务端
 *
 * 它记录的是「这台机器的这位学习者已经走过一遍初识」，不是学习数据。放服务端
 * 会让「换一台机器」变成重新走一遍，而画像是单行的 —— 已经有的画像不该因为
 * 换设备就被再问一遍。清掉 localStorage 或从 `/me` 点「重新初识」都能回来。
 */
import { useCallback, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Input,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  PROFILE_FIELD_LABEL,
  PROFILE_QUESTIONS,
  type LearnerProfilePatch,
  type ProfileField,
  type ProfileQuestion,
  type ProfileResponse,
} from '@starmap/api-contract';
import {
  getGetProfileQueryKey,
  updateProfile,
  useGetProfile,
} from '../api/generated/default/default';

/** 「初识」已完成的本地标记。 */
export const PROFILE_DONE_KEY = 'profileDone';

/** 是否已经走过一遍初识。 */
export function isProfileDone(): boolean {
  try {
    return window.localStorage.getItem(PROFILE_DONE_KEY) === '1';
  } catch {
    // 隐私模式下 localStorage 可能抛异常：当成「没走过」，最多多问一遍。
    return false;
  }
}

/** 标记已完成。 */
export function markProfileDone(): void {
  try {
    window.localStorage.setItem(PROFILE_DONE_KEY, '1');
  } catch {
    /* 存不下就算了：下一次进来会再问一遍，不会丢画像数据 */
  }
}

/** 清掉标记 —— `/me` 的「重新初识」用它回到欢迎页。 */
export function clearProfileDone(): void {
  try {
    window.localStorage.removeItem(PROFILE_DONE_KEY);
  } catch {
    /* 同上 */
  }
}

/**
 * 首次访问时把 `/` 让给欢迎页。
 *
 * 放在这里而不是 `HomePage` 里：`HomePage` 正在被别的票改，而「还没认识你」
 * 这条判断与智能体主页本身无关 —— 它只依赖一次 localStorage 读取。
 */
export function FirstVisitGate({ children }: { children: React.ReactNode }) {
  if (!isProfileDone()) return <Navigate to="/welcome" replace />;
  return <>{children}</>;
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    maxWidth: '720px',
    margin: '0 auto',
    padding: '32px 24px',
  },
  progress: { display: 'flex', gap: '6px', alignItems: 'center' },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: tokens.colorNeutralBackground3,
  },
  dotDone: { backgroundColor: tokens.colorBrandBackground },
  dotCurrent: { backgroundColor: tokens.colorBrandForeground1, transform: 'scale(1.35)' },
  card: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusLarge,
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    backgroundColor: tokens.colorNeutralBackground1,
  },
  why: { color: tokens.colorNeutralForeground3 },
  options: { display: 'flex', flexDirection: 'column', gap: '8px' },
  option: { justifyContent: 'flex-start', textAlign: 'left' },
  optionSelected: { border: `2px solid ${tokens.colorBrandStroke1}` },
  hint: { color: tokens.colorNeutralForeground3, marginLeft: '8px' },
  other: { display: 'flex', gap: '8px', alignItems: 'center' },
  actions: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  error: { color: tokens.colorPaletteRedForeground1 },
});

/** 把某道题的选项值转成要写进画像的值。 */
export function answerValueOf(question: ProfileQuestion, selected: readonly string[]): unknown {
  if (question.field === 'weeklyHours') {
    const first = selected[0];
    return first === undefined ? null : Number(first);
  }
  if (question.field === 'priorCourses') {
    const cleaned = selected.map((v) => v.trim()).filter((v) => v.length > 0);
    return cleaned.length === 0 ? [] : cleaned;
  }
  const first = selected[0];
  return first === undefined ? null : first;
}

export interface InterviewCardProps {
  readonly question: ProfileQuestion;
  readonly index: number;
  readonly total: number;
  readonly initialSelected?: readonly string[];
  /** 回答或跳过。`value === null` 表示跳过。 */
  readonly onAnswer: (field: ProfileField, value: unknown) => Promise<void>;
  readonly onDone?: () => void;
  readonly doneLabel?: string;
  readonly busy?: boolean;
}

/**
 * 一屏一问的卡片 —— 欢迎页与 `/me` 的「改」共用。
 *
 * 只负责这一屏的交互；写库、推进、跳转都在调用方。共用是为了让「改单题」与
 * 「第一次答这题」在界面上没有第二种行为（两种行为意味着两处 bug）。
 */
export function InterviewCard(props: InterviewCardProps): React.JSX.Element {
  const styles = useStyles();
  const { question, index, total, onAnswer, busy } = props;
  const [selected, setSelected] = useState<string[]>(() => [...(props.initialSelected ?? [])]);
  const [other, setOther] = useState('');
  const [error, setError] = useState<string | null>(null);

  const multi = question.multi === true;

  const toggle = useCallback(
    (value: string) => {
      setError(null);
      setSelected((prev) => {
        if (!multi) return [value];
        return prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value];
      });
    },
    [multi],
  );

  const submit = useCallback(
    async (skip: boolean) => {
      setError(null);
      if (skip) {
        await onAnswer(question.field, null);
        return;
      }
      const values = [...selected];
      if (question.allowsOther && other.trim().length > 0) values.push(other.trim());
      if (values.length === 0) {
        setError('先选一个，或点「跳过」——我不会替你猜。');
        return;
      }
      const value = answerValueOf(question, values);
      if (value === null || (Array.isArray(value) && value.length === 0)) {
        setError('这一题至少选一个，或点「跳过」。');
        return;
      }
      await onAnswer(question.field, value);
    },
    [onAnswer, other, question, selected],
  );

  return (
    <div className={styles.card} data-question-id={question.id}>
      <div className={styles.progress} aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={mergeClasses(
              styles.dot,
              i < index && styles.dotDone,
              i === index && styles.dotCurrent,
            )}
          />
        ))}
        <Text size={200} className={styles.why}>
          第 {index + 1}/{total} 问 · {PROFILE_FIELD_LABEL[question.field]}
        </Text>
      </div>

      <Text size={500} weight="semibold">
        {question.prompt}
      </Text>
      <Text className={styles.why}>{question.why}</Text>

      <div className={styles.options} role={multi ? 'group' : 'radiogroup'} aria-label={question.prompt}>
        {question.options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <Button
              key={option.value}
              appearance={active ? 'primary' : 'secondary'}
              className={mergeClasses(styles.option, active && styles.optionSelected)}
              aria-pressed={multi ? active : undefined}
              onClick={() => toggle(option.value)}
            >
              {option.label}
              {option.hint === undefined ? null : <span className={styles.hint}>{option.hint}</span>}
            </Button>
          );
        })}
        {question.options.length === 0 ? (
          <Text className={styles.why}>这题只有自由输入，写在下面即可；不写就跳过。</Text>
        ) : null}
      </div>

      {question.allowsOther === true ? (
        <div className={styles.other}>
          <Input
            aria-label="其他（自由填写）"
            placeholder="其他（自由填写）"
            value={other}
            onChange={(_, data) => setOther(data.value)}
          />
        </div>
      ) : null}

      {error === null ? null : <Text className={styles.error}>{error}</Text>}

      <div className={styles.actions}>
        <Button appearance="subtle" onClick={() => void submit(true)} disabled={busy}>
          跳过
        </Button>
        <Button appearance="primary" onClick={() => void submit(false)} disabled={busy}>
          {props.doneLabel ?? (index + 1 === total ? '完成，去我的页面' : '继续')}
        </Button>
      </div>
    </div>
  );
}

/** 找到「第一道还没答的题」的下标；全答过就从 0 开始（重走一遍）。 */
export function firstUnansweredIndex(profile: ProfileResponse['profile']): number {
  const index = PROFILE_QUESTIONS.findIndex((q) => profile[q.field] === null);
  return index === -1 ? 0 : index;
}

export function WelcomePage(): React.JSX.Element {
  const styles = useStyles();
  const navigate = useNavigate();
  const profileQuery = useGetProfile();
  const queryClient = useQueryClient();
  // 生成器对 PATCH 也产出 query 风格 hook（见 api/queries/agent.ts 的说明），
  // 所以这里用 useMutation 包生成的原生函数，并在成功后把新画像写回缓存 ——
  // 不写回的话下一题拿到的仍是旧 profile，「已答几项」会停在 0。
  const update = useMutation({
    mutationFn: async (patch: LearnerProfilePatch) => (await updateProfile(patch)).data,
    onSuccess: async () => {
      // 失效而不是手写缓存：生成的返回值是 { data, status } 包装，直接 setQueryData
      // 会把包装层也换掉，下一次读 `data.data` 就是 undefined。重新拉一次最省心。
      await queryClient.invalidateQueries({ queryKey: getGetProfileQueryKey() });
    },
  });
  const [index, setIndex] = useState(0);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 生成的返回是 200 | ApiError 的联合：先用 payload 收窄到 200 的形状。
  const payload = profileQuery.data?.data as ProfileResponse | undefined;
  const profile = payload?.profile;

  // 第一道题在拿到画像后决定从哪一题开始（已经答过的问不再重复问）。
  // 只在第一次进入时决定一次：中途答完一题 profile 会变，跟着变会把画面
  // 拉回「第一个空字段」而不是「下一题」。
  const startIndex = useMemo(() => (profile === undefined ? 0 : firstUnansweredIndex(profile)), [profile]);
  const effectiveIndex = started ? index : startIndex;
  const questionIndex = Math.min(effectiveIndex, PROFILE_QUESTIONS.length - 1);
  const question = PROFILE_QUESTIONS[questionIndex];

  const answer = useCallback(
    async (field: ProfileField, value: unknown) => {
      setBusy(true);
      setError(null);
      try {
        // 同一字段可能对应两道题（`courses` 与 `recent` 都写 priorCourses）。跳过
        // 第二问时若把字段写成 null，会把第一问刚答的真答案抹掉 —— 那不是「跳过」，
        // 是数据丢失。所以「跳过且这一项已经有答案」时只推进，不写库。
        const current = profile?.[field] ?? null;
        const answered = current !== null && !(Array.isArray(current) && current.length === 0);
        if (!(value === null && answered)) {
          // `priorCourses` 由三道题（courses / recent / anything）共同填充，每次只问一个
          // 角度。这里做并集而不是覆盖：答「电路分析」之后再答「核电子学」，两门都算学过。
          const next =
            field === 'priorCourses' && Array.isArray(value) && Array.isArray(current)
              ? Array.from(new Set([...current, ...value]))
              : value;
          await update.mutateAsync({ [field]: next } as LearnerProfilePatch);
        }
        // 从「第一个没答的题」进入时，下一题要接着它往后走，而不是回到第 2 题。
        const nextIndex = (started ? index : startIndex) + 1;
        if (nextIndex >= PROFILE_QUESTIONS.length) {
          markProfileDone();
          navigate('/me');
          return;
        }
        setStarted(true);
        setIndex(nextIndex);
      } catch {
        setError('这一步没写进画像。检查后端是否在跑，然后重试或先跳过。');
      } finally {
        setBusy(false);
      }
    },
    [index, navigate, profile, startIndex, started, update],
  );

  if (profileQuery.isPending) {
    return (
      <div className={styles.root}>
        <Text>正在读你的画像…</Text>
      </div>
    );
  }
  if (profileQuery.isError) {
    return (
      <div className={styles.root}>
        <Text className={styles.error}>没读到画像：后端可能没连上。这里不能编一份假的继续。</Text>
      </div>
    );
  }
  if (question === undefined) {
    return (
      <div className={styles.root}>
        <Text className={styles.error}>题目表是空的：契约里的 PROFILE_QUESTIONS 没导出。</Text>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <Text size={600} weight="semibold">
        先认识你一下
      </Text>
      <Text className={styles.why}>
        八个问题，一次一个。答过的会写进画像，随时可以跳过 —— 跳过的项在「我的」页显示为未填写。
      </Text>
      {error === null ? null : <Text className={styles.error}>{error}</Text>}
      <InterviewCard
        key={question.id}
        question={question}
        index={questionIndex}
        total={PROFILE_QUESTIONS.length}
        onAnswer={answer}
        busy={busy}
      />
      <Text size={200} className={styles.why}>
        当前已答 {payload?.answeredCount ?? 0}/6 项 ·{' '}
        <a href="/me" onClick={(e) => { e.preventDefault(); navigate('/me'); }}>
          直接去「我的」
        </a>
      </Text>
    </div>
  );
}
