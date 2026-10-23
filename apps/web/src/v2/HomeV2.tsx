/*
 * HomeV2 —— 学习页，按已通过样例（cx-1.png / cx-2.png）从零写。
 *
 * 与旧 HomePage 的关系：**不复用它的任何 JSX 与样式**。旧页是六轮返工的叠加物，
 * 里面同时有标题区、说明段、右侧三块堆叠卡片、被裁掉的输入条；继续在上面打补丁
 * 只会越改越像补丁。这里只复用两样东西：数据 hook（`useAgentTurns`/`useSubmitTurn`）
 * 与卡片组件（`ArtifactCard`，它已经过独立验收）。
 *
 * 版式取自样例的四个硬数字：左轨 48 · 会话列 200 · 内容列 920 居中 · 日志列 300。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen24Regular,
  Clock24Regular,
  Bookmark24Regular,
  DataBarVertical24Regular,
  Library24Regular,
  Map24Regular,
  Person24Regular,
  Send24Filled,
  Target24Regular,
} from '@fluentui/react-icons';
import { useAgentTurns, useSubmitTurn } from '../api/queries/agent';
import { ArtifactCard } from '../agent/ArtifactCard';
import { currentSessionId, resetSessionId } from '../agent/session';
import type { AgentTurnResponse } from '../api/generated/model';
import './v2.css';

type Row = { id?: string; utterance?: string; visibleResponse?: string | null; createdAt?: string };

const NAV = [
  { key: 'learn', label: '学习', icon: BookOpen24Regular },
  { key: 'placement', label: '定级', icon: Target24Regular },
  { key: 'review', label: '复验', icon: Clock24Regular },
  { key: 'board', label: '看板', icon: DataBarVertical24Regular },
  { key: 'map', label: '知识地图', icon: Map24Regular },
  { key: 'market', label: '关卡市场', icon: Bookmark24Regular },
  { key: 'library', label: '内容库', icon: Library24Regular },
  { key: 'me', label: '我的', icon: Person24Regular },
];

/** 会话记录按「今天 / 昨天 / 更早」分组 —— 样例里就是这个分组。 */
function groupByDay(rows: Row[]): Array<{ label: string; items: Row[] }> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const today: Row[] = [];
  const yesterday: Row[] = [];
  const earlier: Row[] = [];
  const buckets: Array<{ label: string; items: Row[] }> = [
    { label: '今天', items: today },
    { label: '昨天', items: yesterday },
    { label: '更早', items: earlier },
  ];
  for (const row of rows) {
    const created = row.createdAt;
    const at = created ? new Date(created).getTime() : now.getTime();
    if (at >= startOfToday) today.push(row);
    else if (at >= startOfYesterday) yesterday.push(row);
    else earlier.push(row);
  }
  return buckets.filter((b) => b.items.length > 0);
}

export function HomeV2() {
  const [sessionId, setSessionId] = useState(() => currentSessionId());
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState<string>('');
  const listRef = useRef<HTMLDivElement | null>(null);

  const [sessions, setSessions] = useState<Row[]>([]);
  useEffect(() => {
    let alive = true;
    fetch('/api/v1/agent/sessions?limit=40')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((json: { sessions?: Array<{ sessionId?: string; firstUtterance?: string | null; lastActivityAt?: string }> }) => {
        if (!alive || !Array.isArray(json.sessions)) return;
        setSessions(
          json.sessions.map((it) => ({
            id: it.sessionId,
            utterance: it.firstUtterance ?? '（未记录原话）',
            createdAt: it.lastActivityAt,
          })),
        );
      })
      .catch(() => {
        /* 会话列表读不到不影响主流程：进度条与输入框照常可用 */
      });
    return () => {
      alive = false;
    };
  }, []);

  const history = useAgentTurns(sessionId);
  const submit = useSubmitTurn(sessionId);

  const rows: Row[] = useMemo(() => {
    const payload = (history.data as { data?: { items?: Row[] } } | undefined)?.data;
    return payload?.items ?? [];
  }, [history.data]);

  const latest: AgentTurnResponse | undefined = submit.data;
  const groups = useMemo(() => groupByDay(rows), [rows]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [rows.length, latest]);

  const send = () => {
    const text = draft.trim();
    if (!text || submit.isPending) return;
    setSent(text);
    setDraft('');
    submit.mutate({ utterance: text, microKpId: '', tier: 'P2' });
  };

  const newSession = () => {
    resetSessionId();
    setSessionId(currentSessionId());
    setSent('');
  };

  return (
    <div className="v2-shell">
      <nav className="v2-rail" aria-label="主导航">
        <button type="button" className="brand" title="StarMap" aria-label="StarMap 首页" onClick={() => window.location.assign('/')}>
          S
        </button>
        {NAV.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            title={label}
            aria-label={label}
            aria-current={key === 'learn' ? 'page' : undefined}
            onClick={() => {
              if (key === 'learn') window.location.assign('/');
              else window.location.assign(`/${key === 'market' ? 'market' : key}`);
            }}
          >
            <Icon />
          </button>
        ))}
      </nav>

      <div className="v2-panel">
      <aside className="v2-sessions" aria-label="学习记录">
        <button type="button" className="new" onClick={newSession}>
          新对话
        </button>
        <button type="button" className="row entry" onClick={() => window.location.assign('/learning')}>
          <span>学习记录</span>
        </button>
        {groups.length === 0 &&
          sessions.slice(0, 12).map((row, i) => (
            <button key={row.id ?? `s-${i}`} type="button" className="row" title={row.utterance}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.utterance ?? '（未记录原话）'}
              </span>
              <span>{row.createdAt ? new Date(row.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : ''}</span>
            </button>
          ))}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="grp">{g.label}</div>
            {g.items.slice(0, 8).map((row, i) => (
              <button key={row.id ?? `${g.label}-${i}`} type="button" className="row" title={row.utterance}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.utterance ?? '（未记录原话）'}
                </span>
                <span>{row.createdAt ? new Date(row.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
              </button>
            ))}
          </div>
        ))}
      </aside>

      <main className="v2-main">
        <div className="v2-col" ref={listRef}>
          <h1 className="v2-title">学习</h1>
          <p className="v2-caption">STARMAP</p>
          <p className="v2-say">
            说一句你想学什么，或者你卡在哪一步。每轮只给一张卡片：一个关卡、一张图谱、一次追问，或一段进度。
          </p>

          {sent && (
            <div className="v2-me">
              <p>{sent}</p>
            </div>
          )}

          {submit.isPending && <p className="v2-say">正在准备这一轮的卡片…</p>}
          {submit.isError && (
            <p className="v2-say" style={{ color: 'var(--sm-warning-text, #8a5200)' }}>
              这一轮没提交成功：{submit.error instanceof Error ? submit.error.message : '未知错误'}。你的话还在，可以直接重试。
            </p>
          )}

          {latest?.artifact && (
            <div className="v2-card">
              <ArtifactCard artifact={latest.artifact} />
            </div>
          )}
        </div>

        <div className="v2-composer">
          <textarea
            value={draft}
            placeholder="说说你想学什么，或者你卡在哪一步…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="bar">
            <button type="button" className="plus" title="添加附件" aria-label="添加附件">
              +
            </button>
            <button type="button" className="chip" title="难度档（当前 P2）">
              P2
            </button>
            <span className="spacer" />
            <button type="button" className="chip" title="模型（当前默认模型）">
              默认模型
            </button>
            <button type="button" className="mic" title="语音输入（下一步接入）" aria-label="语音输入">
              ◎
            </button>
            <button type="button" className="send" onClick={send} disabled={!draft.trim() || submit.isPending} aria-label="提交这一轮">
              <Send24Filled />
            </button>
          </div>
          <div className="hint">Enter 提交 · Shift+Enter 换行</div>
        </div>
      </main>

      <aside className="v2-log" aria-label="学习日志">
        <h2>学习日志</h2>
        {rows.length === 0 && <div className="row">还没有记录。说第一句话后这里会出现。</div>}
        {rows.slice(-6).reverse().map((row, i) => (
          <div className="row" key={row.id ?? `log-${i}`}>
            {row.visibleResponse ?? row.utterance ?? '（空记录）'}
            <time>{row.createdAt ? new Date(row.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}</time>
          </div>
        ))}
      </aside>
      </div>
    </div>
  );
}
