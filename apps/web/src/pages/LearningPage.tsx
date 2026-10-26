import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Button,
  Caption1,
  Input,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Add24Regular } from '@fluentui/react-icons';
import { useListAgentSessions } from '../api/generated/default/default';
import type { AgentSessionListResponse, AgentSessionListResponseSessionsItem } from '../api/generated/model';
import { resetSessionId } from '../agent/session';
import { Composer } from '../components/Composer';

/**
 * 「学习记录」页（票 76 第 3 项）。
 *
 * ## 为什么它是一个独立页面，而不是首页右侧那条「学习日志」
 *
 * 首页右侧的日志只装**当前会话**：它是「我刚说了什么」的参照物，不是
 * 「我以前学过什么」的索引。会话一多，把历史塞进同一列会让两者都读不清。
 * 这里按会话聚合：一条会话 = 一次学习，首句是它的名字。
 *
 * ## 数据从哪来
 *
 * `GET /api/v1/agent/sessions`（票 76 新增，按最近活动倒序，默认 50 条）。
 * 契约里的 `firstUtterance` 由服务端截断到 60 个码点，前端不再二次截断 ——
 * 两处都截会出现「60 个字到了前端又变成 40 个」的怪事。
 *
 * ## 点一条记录会发生什么
 *
 * 把会话 id 写回 `localStorage['starmap.session']`，再跳 `/`。首页挂载时用
 * `currentSessionId()` 读到的就是它，于是「恢复会话」复用的仍然是首页那套
 * 既有逻辑 —— 这里**不新造状态管理**，也不把 id 塞进 URL（会话内容是私人的，
 * 不该因为分享链接被看见）。
 */

/** 与首页共用：`/` 读取并立即删除，确保草稿只被消费一次。 */
const DRAFT_KEY = 'starmap.draft';
/** 与 `agent/session.ts` 共用：首页的「当前会话」就在这里。 */
const SESSION_KEY = 'starmap.session';

/** 列表请求的上限：契约允许 1–200，这里取 100（比一屏多，又不至于把整库拉下来）。 */
const LIST_LIMIT = 100;

const useStyles = makeStyles({
  page: {
    // 票 83：外壳不再给固定列宽，这里自己定阅读宽度；两栏是票面要求的
    // `320px + 1fr`（会话列表 + 空态/输入区）。
    maxWidth: 'min(1200px, 100%)',
    marginInline: 'auto',
    /*
     * `marginInline: auto` 会让这个网格项**失去 stretch**，宽度退回
     * fit-content（实测 2560 下只有 980px，max-width 根本没机会生效）。
     * 显式 `width: 100%` 把宽度压回包含块，再由 max-width 收口、auto 边距居中。
     */
    width: '100%',
    padding: '22px 0 0',
    display: 'grid',
    gridTemplateColumns: '320px minmax(0, 1fr)',
    gap: '18px',
    height: '100%',
    minHeight: 0,
    boxSizing: 'border-box',
  },
  side: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    minHeight: 0,
    padding: '16px 14px',
    borderRadius: 'var(--sm-liquid-r-inset)',
    backgroundColor: 'var(--sm-glass-fill-soft)',
    boxShadow: 'var(--sm-liquid-hi)',
  },
  sideHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  title: {
    fontSize: '20px',
    fontWeight: 600,
    lineHeight: '26px',
    letterSpacing: '-0.01em',
    color: 'var(--sm-text-primary)',
  },
  scroll: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  groupLabel: {
    color: 'var(--sm-text-tertiary)',
    padding: '0 4px 2px',
  },
  item: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: '2px',
    width: '100%',
    padding: '9px 10px',
    border: 'none',
    // 票 87：样例记录行是 9px 圆角，pill（999px）把它做成了胶囊
    borderRadius: '9px',
    backgroundColor: 'transparent',
    color: 'var(--sm-text-primary)',
    textAlign: 'left',
    cursor: 'pointer',
    font: 'inherit',
    ':hover': { backgroundColor: 'var(--sm-glass-fill-strong)' },
    ':focus-visible': {
      outline: '2px solid var(--sm-border-focus)',
      outlineOffset: '2px',
    },
  },
  itemFirst: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    fontSize: '13px',
    lineHeight: '19px',
  },
  itemMeta: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    color: 'var(--sm-text-tertiary)',
  },
  stage: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '14px',
    padding: '0 24px 40px',
    minWidth: 0,
    minHeight: 0,
  },
  emptyTitle: {
    fontSize: '18px',
    fontWeight: 600,
    color: 'var(--sm-text-primary)',
  },
  emptyHint: {
    maxWidth: '420px',
    textAlign: 'center',
    color: 'var(--sm-text-secondary)',
  },
  askRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    // 票 87：样例 .cbox 与内容列同宽（690），原 520 比样例窄 170
    width: 'min(690px, 100%)',
  },
  askInput: { flex: 1, minWidth: 0 },
  status: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: 'var(--sm-text-tertiary)',
  },
});

type Bucket = '今天' | '昨天' | '更早';

const BUCKET_ORDER: readonly Bucket[] = ['今天', '昨天', '更早'];

/** 本地日期键（`YYYY-MM-DD`）。按本地时区分组，而不是 UTC —— 用户说的是「今天」。 */
function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 某个时间点属于「今天 / 昨天 / 更早」。导出是为了让测试能用固定的 `now` 钉住边界。 */
export function bucketOf(iso: string, now: Date): Bucket {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '更早';
  const today = localDayKey(now);
  const day = localDayKey(then);
  if (day === today) return '今天';
  const yesterday = new Date(now.getTime());
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === localDayKey(yesterday)) return '昨天';
  return '更早';
}

/** 组内时间：今天/昨天给时刻，更早给日期（`8月3日`）。 */
export function sessionTimeLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const bucket = bucketOf(iso, now);
  if (bucket === '更早') {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  const hh = `${date.getHours()}`.padStart(2, '0');
  const mm = `${date.getMinutes()}`.padStart(2, '0');
  return `${hh}:${mm}`;
}

/** 把会话按「今天 / 昨天 / 更早」分组；空组不出现。 */
export function groupSessions(
  sessions: readonly AgentSessionListResponseSessionsItem[],
  now: Date,
): Array<{ bucket: Bucket; items: AgentSessionListResponseSessionsItem[] }> {
  const groups = new Map<Bucket, AgentSessionListResponseSessionsItem[]>();
  for (const session of sessions) {
    const bucket = bucketOf(session.lastActivityAt, now);
    const list = groups.get(bucket);
    if (list) list.push(session);
    else groups.set(bucket, [session]);
  }
  return BUCKET_ORDER.filter((bucket) => groups.has(bucket)).map((bucket) => ({
    bucket,
    items: groups.get(bucket) ?? [],
  }));
}

/** 把草稿交给首页。`sessionStorage` 的边界是「这一次导航」，取走即删。 */
function stashDraft(text: string): void {
  try {
    window.sessionStorage.setItem(DRAFT_KEY, text);
  } catch {
    /* 隐私模式：写不进去就直接跳，首页只会少一句草稿。 */
  }
}

/** 把会话 id 写回「当前会话」槽位，行为与首页的 `currentSessionId()` 对齐。 */
function restoreSession(sessionId: string): void {
  try {
    window.localStorage.setItem(SESSION_KEY, sessionId);
  } catch {
    /* 同上：写不进去时首页会开一个新会话，不会白屏。 */
  }
}

export function LearningPage() {
  const styles = useStyles();
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  const sessions = useListAgentSessions({ limit: LIST_LIMIT });
  const payload = sessions.data?.data as AgentSessionListResponse | undefined;
  const list = payload?.sessions ?? [];

  /*
   * `now` 只在数据到达时取一次：如果每次渲染都 `new Date()`，一条 23:59:59
   * 的会话会在下一秒从「今天」跳进「昨天」，而页面什么都没变。
   */
  const grouped = useMemo(() => groupSessions(list, new Date()), [list]);

  function startNewSession() {
    resetSessionId();
    navigate('/');
  }

  function openSession(sessionId: string) {
    restoreSession(sessionId);
    navigate('/');
  }

  /**
   * 从空态直接开始一句：把话写进草稿位再跳 `/`，由首页的 Composer 取走
   * （首页的 `takeDraft` 读后即删，草稿只被消费一次）。
   */
  function submitDraft() {
    const text = draft.trim();
    if (text === '') return;
    stashDraft(text);
    navigate('/');
  }

  return (
    <div className={styles.page}>
      <div className={styles.side}>
        <div className={styles.sideHead}>
          <Text as="h1" className={styles.title}>
            学习记录
          </Text>
          <Button
            appearance="subtle"
            size="small"
            icon={<Add24Regular />}
            onClick={startNewSession}
          >
            新会话
          </Button>
        </div>

        {sessions.isPending && (
          <div className={styles.status}>
            <Spinner size="tiny" />
            <Caption1>正在读会话列表…</Caption1>
          </div>
        )}
        {sessions.isError && (
          <Caption1 className={styles.status}>
            没读到会话列表：后端可能没连上。稍后重试。
          </Caption1>
        )}
        {!sessions.isPending && !sessions.isError && list.length === 0 && (
          <Caption1 className={styles.status}>
            还没有任何会话。点「新会话」开始第一轮。
          </Caption1>
        )}

        <div className={styles.scroll}>
          {grouped.map(({ bucket, items }) => (
            <section key={bucket} className={styles.group} aria-label={bucket}>
              <Caption1 className={styles.groupLabel}>{bucket}</Caption1>
              {items.map((session) => (
                <button
                  key={session.sessionId}
                  type="button"
                  className={styles.item}
                  onClick={() => openSession(session.sessionId)}
                >
                  <span className={styles.itemFirst}>{session.firstUtterance}</span>
                  <span className={styles.itemMeta}>
                    <span>{sessionTimeLabel(session.lastActivityAt, new Date())}</span>
                    <span>{session.turnCount} 轮</span>
                  </span>
                </button>
              ))}
            </section>
          ))}
        </div>
      </div>

      <div className={styles.stage}>
        <Text as="p" className={styles.emptyTitle}>
          {list.length === 0 ? '还没有记录可继续' : '选一条记录，或者直接说你想学什么'}
        </Text>
        <Text as="p" className={styles.emptyHint}>
          左边的每一条都是一次真实会话：点进去会回到那一轮，学习日志与卡片都还在。
          也可以在这里写下第一句话，回车即可开始。
        </Text>
        <div className={styles.askRow}>
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={submitDraft}
            placeholder="说一句你想学什么，比如「我想学布尔代数」"
            ariaLabel="这一轮想说的话"
            modelLabel="默认模型"
          />
        </div>
      </div>
    </div>
  );
}
