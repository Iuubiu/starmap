/**
 * 「我的」页（票 78）。
 *
 * ## 左边画像卡、右边个人看板
 *
 * 画像是**输入**（学生自述），看板是**输出**（学习证据推出的进度）。把两者放在
 * 同一页，是为了让「画像 → 推荐」这条因果在界面上可见：改了每周可投入时间，
 * 右边会话计划里的新知识点上限会跟着变。分两页的话，学生永远看不到这层关系。
 *
 * 右侧看板来自 t80（`me/ProgressBoard`），数据是只读的三级进度。它与画像各自
 * 取数、各自失败：后端没连上时画像还能看，看板只报「没读到」，不会互相拖成空白。
 *
 * ## 「改」为什么只改一个字段
 *
 * 票面的硬要求：重新问单题只改该字段、其它字段不变。实现上就是
 * `PATCH /profile` 只带那一个键；服务端按合并语义处理。这里不做「先读出整份、
 * 改一个字段、整份提交」——那会在两次请求之间把别人刚写的字段覆盖回旧值。
 */
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { ProgressBoard } from '../me/ProgressBoard.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Text, makeStyles, tokens } from '@fluentui/react-components';
import {
  PROFILE_FIELD_LABEL,
  PROFILE_QUESTIONS,
  PROFILE_VALUE_LABEL,
  type LearnerProfile,
  type LearnerProfilePatch,
  type ProfileResponse,
  type ProfileField,
  type ProfileQuestion,
} from '@starmap/api-contract';
import {
  getGetProfileQueryKey,
  updateProfile,
  useGetProfile,
} from '../api/generated/default/default';
import { clearProfileDone, InterviewCard } from './WelcomePage';

const FIELD_ORDER: readonly ProfileField[] = [
  'background',
  'mathLevel',
  'goal',
  'weeklyHours',
  'explanationDensity',
  'priorCourses',
];

/** 一个字段在界面上的显示值。`null` → 「未填写」（不用默认值伪装）。 */
export function displayValue(profile: LearnerProfile, field: ProfileField): string {
  const value = profile[field];
  if (value === null || (Array.isArray(value) && value.length === 0)) return '未填写';
  if (field === 'weeklyHours') return `每周 ${String(value)} 小时`;
  if (Array.isArray(value)) return value.join('、');
  return PROFILE_VALUE_LABEL[String(value)] ?? String(value);
}

/** 某字段对应的问题（用于「改」时重新问）。 */
function questionFor(field: ProfileField): ProfileQuestion | undefined {
  return PROFILE_QUESTIONS.find((q) => q.field === field);
}

const useStyles = makeStyles({
  root: { display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)', gap: '20px', padding: '24px' },
  panel: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusLarge,
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    backgroundColor: tokens.colorNeutralBackground1,
    alignSelf: 'start',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '88px 1fr auto',
    gap: '12px',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  label: { color: tokens.colorNeutralForeground3 },
  missing: { color: tokens.colorNeutralForeground3, fontStyle: 'italic' },
  error: { color: tokens.colorPaletteRedForeground1 },
});

export function MePage(): React.JSX.Element {
  const styles = useStyles();
  const navigate = useNavigate();
  const profileQuery = useGetProfile();
  const queryClient = useQueryClient();
  // 同 WelcomePage：生成器把 PATCH 也生成为 query 风格 hook，这里用 useMutation
  // 包原生函数，成功后写回画像缓存，列表才会立刻显示新值而不是等下一次挂载。
  const update = useMutation({
    mutationFn: async (patch: LearnerProfilePatch) => (await updateProfile(patch)).data,
    onSuccess: async () => {
      // 同 WelcomePage：失效后重拉，避免把 { data, status } 包装层写坏。
      await queryClient.invalidateQueries({ queryKey: getGetProfileQueryKey() });
    },
  });
  const [editing, setEditing] = useState<ProfileField | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answer = useCallback(
    async (field: ProfileField, value: unknown) => {
      setBusy(true);
      setError(null);
      try {
        await update.mutateAsync({ [field]: value } as LearnerProfilePatch);
        setEditing(null);
      } catch {
        setError('没写进去。检查后端后重试。');
      } finally {
        setBusy(false);
      }
    },
    [update],
  );

  if (profileQuery.isPending) {
    return <Text className={styles.root}>正在读你的画像…</Text>;
  }
  if (profileQuery.isError) {
    return <Text className={styles.error}>没读到画像：后端可能没连上。</Text>;
  }

  // 同 WelcomePage：先收窄到 200 的响应形状，再取画像。
  const payload = profileQuery.data?.data as ProfileResponse;
  const profile = payload.profile;
  const editingQuestion = editing === null ? undefined : questionFor(editing);

  return (
    <div className={styles.root}>
      <section className={styles.panel} aria-label="学习者画像">
        <Text size={500} weight="semibold">
          你的画像
        </Text>
        <Text size={200} className={styles.label}>
          已填 {payload.answeredCount}/6 项。未填写表示你跳过了那题，不是默认值。
        </Text>
        {error === null ? null : <Text className={styles.error}>{error}</Text>}

        {editingQuestion === undefined ? (
          <div>
            {FIELD_ORDER.map((field) => (
              <div key={field} className={styles.row}>
                <Text className={styles.label}>{PROFILE_FIELD_LABEL[field]}</Text>
                <Text className={displayValue(profile, field) === '未填写' ? styles.missing : undefined}>
                  {displayValue(profile, field)}
                </Text>
                <Button size="small" appearance="subtle" onClick={() => setEditing(field)}>
                  改
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <InterviewCard
            question={editingQuestion}
            index={FIELD_ORDER.indexOf(editingQuestion.field)}
            total={FIELD_ORDER.length}
            onAnswer={answer}
            busy={busy}
            doneLabel="只改这一项"
          />
        )}

        <div>
          <Button
            appearance="secondary"
            onClick={() => {
              clearProfileDone();
              navigate('/welcome');
            }}
          >
            重新初识
          </Button>
        </div>
      </section>

      <section className={styles.panel} aria-label="个人看板">
        <Text size={500} weight="semibold">
          学习看板
        </Text>
        <ProgressBoard />
      </section>
    </div>
  );
}
