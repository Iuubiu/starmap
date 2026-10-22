/**
 * 票 16 的前端落点：批量生成的发起与进度观察。
 *
 * ## 为什么是一张独立页面而不是市场页里的一个区块
 *
 * 批量生成是「跑一段时间的作业」，进度观察需要停留、刷新、看历史。塞进市场
 * 页会让那张页面同时回答「我有哪些关卡」和「那批跑完了吗」两个不同节奏的
 * 问题。路由 `/market/generate` 挂在市场之下，从市场页有入口过去。
 *
 * ## 为什么进度只靠轮询
 *
 * workflow 跑在服务端，前端拿不到推送（没接 SSE/WebSocket）。轮询
 * `GET /generations/{runId}` 是最便宜的方案，且运行本身有终态
 * （succeeded/partial/failed），轮询会自己停下 —— 见
 * `useGenerationRun` 里的 `refetchInterval`。
 *
 * ## 验收⑤的落点
 *
 * 「失败原因可汇总查看」在服务端已经算好（`failures: [{kind, count, sample}]`），
 * 这里**不再自己 group**：前端重新聚合等于把「什么是同一类失败」这个判断
 * 复制到第二个地方。页面只负责把结论翻成人话（`FAILURE_LABEL`）。
 */
import { useState } from 'react';
import {
  Badge,
  Body1,
  Button,
  Card,
  CardHeader,
  Divider,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useNavigate, useSearchParams } from 'react-router';
import { useGenerationRun, useStartGeneration } from '../api/queries';
import type { GenerationTask } from '../api/generated/model';

const useStyles = makeStyles({
  page: {
    padding: '32px',
    maxWidth: '980px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
  },
  title: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightHero700,
  },
  form: { display: 'flex', flexDirection: 'column', gap: '10px' },
  formRow: { display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' },
  badge: { whiteSpace: 'nowrap' },
  taskRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '10px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  taskHead: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  failureLine: { color: tokens.colorPaletteRedForeground1 },
  actions: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  summary: { display: 'flex', gap: '16px', flexWrap: 'wrap' },
});

const STATUS_LABEL: Record<string, string> = {
  pending: '排队中',
  running: '生成中',
  succeeded: '已生成',
  failed: '失败',
};

/**
 * 失败分类的人话翻译。
 *
 * 键与 `GenerationFailureKindSchema` 一一对应；这里只做展示，不做判断 ——
 * 页面不该重新解释「什么算语言不合规」。
 */
const FAILURE_LABEL: Record<string, string> = {
  llm_error: '上游模型报错',
  not_json: '返回的不是 JSON',
  schema_invalid: '过不了关卡校验',
  missing_field: '缺必填字段',
  language_not_compliant: '题干或解析不是中文',
  ungrounded_source: '出处指向不存在的教材片段',
  practice_violation: '想往判定池塞题',
  db_error: '写库失败',
};

/** 运行整体状态 → MessageBar 的 intent。partial 是有救的，不是 error。 */
function intentFor(status: string): 'info' | 'success' | 'warning' | 'error' {
  if (status === 'succeeded') return 'success';
  if (status === 'partial') return 'warning';
  if (status === 'failed') return 'error';
  return 'info';
}

export function GenerationPage() {
  const styles = useStyles();
  const navigate = useNavigate();
  // 运行 id 也接受 URL 上的 `?runId=`：批量生成要跑几十秒，刷新一下页面
  // 就丢掉正在观察的运行是不可接受的。有了这个参数，日志里贴一条链接
  // 也能直接打开那一批的进度。
  //
  // `?microKpIds=` 是**预填**而不是自动开跑：知识点详情页在「这个点还没有
  // 关卡」时给一个入口跳过来，学生要能在开跑前确认「就是这个点、题目会花
  // 一轮 LLM 调用」。自动开跑会把一次误点变成一次真实计费。
  const [searchParams, setSearchParams] = useSearchParams();
  const [rawIds, setRawIds] = useState(searchParams.get('microKpIds') ?? '');
  const [runId, setRunId] = useState<string | null>(searchParams.get('runId'));
  const [formError, setFormError] = useState<string | null>(null);

  const start = useStartGeneration();
  const run = useGenerationRun(runId ?? undefined);

  const onStart = () => {
    const ids = rawIds
      .split(/[\s,、]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      setFormError('先填至少一个知识点 id（例如 kp-bool），再开始生成。');
      return;
    }
    setFormError(null);
    start.mutate(
      { microKpIds: ids },
      {
        onSuccess: (payload) => {
          setRunId(payload.runId);
          // 把 id 写进 URL，刷新后还能接着看同一批
          setSearchParams({ runId: payload.runId }, { replace: true });
        },
      },
    );
  };

  const payload = run.payload;
  // `useStartGeneration` 的错误类型已经钉成 ApiClientError（fetcher 对所有非 2xx
  // 都抛它），所以这里不需要 instanceof 收窄 —— 反而是写了会让 TS 把 else 分支
  // 收窄成 never。防御只留给「万一将来换了 fetcher」那一种情况。
  const startFailure = start.error ? start.error.message : null;

  return (
    <div className={styles.page}>
      <div>
        <Text as="h1" className={styles.title}>
          AI 批量生成关卡
        </Text>
        <Body1>
          按知识点批量出题。每条产物都要过一遍与自制关卡<strong>同一个</strong>校验器；过不了的不会入库，
          但也不会拖垮整批 —— 失败原因会逐条记下来。
        </Body1>
      </div>

      <MessageBar intent="info">
        <MessageBarBody>
          <MessageBarTitle>生成的题只会进练习池，不会进判定池</MessageBarTitle>
          AI 出的题在库里全部是 <code>pool: practice</code>。要让它参与判定，得有人把
          <code>meta.author</code> 改成 <code>teacher</code> 或 <code>self</code> 并且重存一遍 ——
          那一步就是「有人看过并担保」。
        </MessageBarBody>
      </MessageBar>

      <Card>
        <CardHeader header={<Text weight="semibold">发起一批</Text>} />
        <div className={styles.form}>
          <Body1>知识点 id，逗号或换行分隔（最多 50 个）</Body1>
          <div className={styles.formRow}>
            <Input
              aria-label="知识点 id"
              placeholder="kp-bool, kp-kmap"
              value={rawIds}
              onChange={(_, data) => setRawIds(data.value)}
              style={{ flex: '1 1 320px' }}
            />
            <Button appearance="primary" onClick={onStart} disabled={start.isPending}>
              {start.isPending ? '发起中…' : '开始生成'}
            </Button>
          </div>
          {formError ? (
            <MessageBar intent="warning">
              <MessageBarBody>{formError}</MessageBarBody>
            </MessageBar>
          ) : null}
          {startFailure ? (
            <MessageBar intent="error">
              <MessageBarBody>发起失败：{startFailure}</MessageBarBody>
            </MessageBar>
          ) : null}
        </div>
      </Card>

      {runId ? (
        <>
          <Divider />
          {run.isPending ? (
            <Spinner label="正在取这批的状态…" />
          ) : run.isError || !payload ? (
            <MessageBar intent="error">
              <MessageBarBody>
                读不到这批的状态：
                {run.error instanceof Error ? run.error.message : '未知错误'}
              </MessageBarBody>
            </MessageBar>
          ) : (
            <>
              <MessageBar intent={intentFor(statusOf(payload))}>
                <MessageBarBody>
                  <MessageBarTitle>{runHeadline(payload)}</MessageBarTitle>
                  <div className={styles.summary}>
                    <span>
                      共 {payload.requestedCount} 个知识点，成功 {payload.succeededCount}，
                      失败 {payload.failedCount}
                    </span>
                    <span>并发 {payload.concurrency}</span>
                    <span className={styles.mono}>{payload.runId}</span>
                  </div>
                </MessageBarBody>
              </MessageBar>

              {payload.failures.length > 0 ? (
                <Card>
                  <CardHeader header={<Text weight="semibold">失败原因汇总</Text>} />
                  {payload.failures.map((f) => (
                    <div key={f.kind} className={styles.taskRow}>
                      <div className={styles.taskHead}>
                        <Badge appearance="outline" className={styles.badge}>
                          {FAILURE_LABEL[f.kind] ?? f.kind}
                        </Badge>
                        <Text>{f.count} 条</Text>
                      </div>
                      <Body1 className={styles.failureLine}>{f.sample}</Body1>
                    </div>
                  ))}
                </Card>
              ) : null}

              <Card>
                <CardHeader header={<Text weight="semibold">逐条结果</Text>} />
                {payload.tasks.map((task) => (
                  <TaskRow
                    key={task.taskId}
                    task={task}
                    styles={styles}
                    onOpen={(levelId) => navigate(`/level/${levelId}`)}
                  />
                ))}
              </Card>

              <div className={styles.actions}>
                <Button onClick={() => navigate('/market')}>回到关卡市场</Button>
                <Button
                  appearance="secondary"
                  onClick={() => {
                    setRunId(null);
                    setRawIds('');
                  }}
                >
                  再发起一批
                </Button>
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

/** 运行整体状态：由计数推出来，与服务端的 `status` 字段同构（列表接口才给那个）。 */
function statusOf(run: {
  requestedCount: number;
  succeededCount: number;
  failedCount: number;
  tasks: GenerationTask[];
}): string {
  const settled = run.tasks.every((t) => t.status === 'succeeded' || t.status === 'failed');
  if (!settled) return 'running';
  if (run.failedCount === 0 && run.succeededCount > 0) return 'succeeded';
  if (run.succeededCount === 0 && run.failedCount > 0) return 'failed';
  if (run.succeededCount > 0 && run.failedCount > 0) return 'partial';
  return 'running';
}

function runHeadline(run: {
  requestedCount: number;
  succeededCount: number;
  failedCount: number;
  tasks: GenerationTask[];
}): string {
  const status = statusOf(run);
  if (status === 'running') return '还在跑… 这一页会自己刷新';
  if (status === 'succeeded') return '这一批全部生成成功';
  if (status === 'partial') return '这一批部分成功 —— 失败的没入库，可以重跑';
  if (status === 'failed') return '这一批全部失败';
  return '状态未知';
}

function TaskRow({
  task,
  styles,
  onOpen,
}: {
  task: GenerationTask;
  styles: ReturnType<typeof useStyles>;
  onOpen: (levelId: string) => void;
}) {
  const succeeded = task.status === 'succeeded';
  return (
    <div className={styles.taskRow}>
      <div className={styles.taskHead}>
        <Badge
          appearance="filled"
          color={succeeded ? 'success' : task.status === 'failed' ? 'danger' : 'subtle'}
          className={styles.badge}
        >
          {STATUS_LABEL[task.status] ?? task.status}
        </Badge>
        <Text weight="semibold">{task.microKpName}</Text>
        <span className={styles.mono}>{task.microKpId}</span>
        {succeeded ? (
          <>
            <Text>
              {task.itemCount} 道题 · 《{task.levelTitle}》
            </Text>
            <Button size="small" onClick={() => onOpen(task.levelId ?? '')}>
              打开这一关
            </Button>
          </>
        ) : null}
        {task.failureKind ? (
          <Badge appearance="outline" className={styles.badge}>
            {FAILURE_LABEL[task.failureKind] ?? task.failureKind}
          </Badge>
        ) : null}
        {task.durationMs !== null ? (
          <span className={styles.mono}>{(task.durationMs / 1000).toFixed(1)}s</span>
        ) : null}
      </div>
      {task.failureMessage ? (
        <Body1 className={styles.failureLine}>{task.failureMessage}</Body1>
      ) : null}
      {Array.isArray(task.failureDetail) && task.failureDetail.length > 0 ? (
        <div className={styles.mono}>
          {(task.failureDetail as Array<{ path?: string; message?: string }>).map((issue, i) => (
            <div key={i}>
              {issue.path || '(根)'}：{issue.message}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
