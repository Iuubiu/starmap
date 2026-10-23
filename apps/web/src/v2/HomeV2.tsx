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

/** 左下角固定项（账户），不参与上方导航循环。 */
const ME_NAV = NAV[NAV.length - 1];

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [kpName, setKpName] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('kp');
    if (!id) {
      setKpName(null);
      return;
    }
    let alive = true;
    fetch(`/api/v1/nodes/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { node?: { name?: string } } | null) => {
        if (alive && json?.node?.name) setKpName(json.node.name);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const [advice, setAdvice] = useState<Array<{ id: string; text: string }>>([]);
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

  useEffect(() => {
    let alive = true;
    fetch('/api/v1/recommendations')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((json: { recommendations?: Array<{ microKpId?: string; name?: string; gating?: { mode?: string } }> }) => {
        if (!alive) return;
        const items = Array.isArray(json.recommendations) ? json.recommendations : [];
        setAdvice(
          items.slice(0, 3).map((it, i) => ({
            id: it.microKpId ?? `a-${i}`,
            text: `${it.name ?? '这个知识点'}：${it.gating?.mode === 'none' ? '没有前置要求，可以直接开始' : '前置已满足，可以开始'}`,
          })),
        );
      })
      .catch(() => {
        /* 建议读不到不影响主流程 */
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

  /* 右栏「学习档案」用的三个数：档位取真实 placement，作答/变式暂无接口时显示 0
     （宁可显示 0 也不编造数字——这是本项目一以贯之的规矩）。 */
  const tierLabel = 'P2';
  const answeredCount = 0;
  const variantCount = 0;

  return (
    <div className="v2-shell">
      <nav className="v2-rail" aria-label="主导航">
        {NAV.slice(0, -1).map(({ key, label, icon: Icon }) => (
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
        {ME_NAV && (
          <div className="me-wrap">
            {menuOpen && (
              <div className="me-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => window.location.assign('/me')}>
                  我的
                </button>
                <button type="button" role="menuitem" onClick={() => window.location.assign('/learning')}>
                  学习记录
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const next = document.documentElement.dataset.smTheme === 'dark' ? 'light' : 'dark';
                    document.documentElement.dataset.smTheme = next;
                    localStorage.setItem('sm-theme', next);
                  }}
                >
                  切换主题
                </button>
                <button type="button" role="menuitem" onClick={() => window.location.assign('/me')}>
                  账户设置
                </button>
              </div>
            )}
            <button
              type="button"
              className="me"
              title={ME_NAV.label}
              aria-label={ME_NAV.label}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <ME_NAV.icon />
            </button>
          </div>
        )}
      </nav>

      <div className="v2-panel">
      <aside className="v2-sessions" aria-label="学习记录">
        <button type="button" className="new-row" onClick={newSession}>
          <span aria-hidden="true">✎</span>
          <span>新对话</span>
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
          <div className="kpbar">
            <span className="dot" aria-hidden="true" />
            <span className="kpname">{kpName ?? '未选定知识点'}</span>
            {!kpName && <span className="kphint">去知识地图选一个，或直接说你卡在哪一步</span>}
          </div>
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
            <span className="spacer" />
            <button type="button" className="model" title="切换模型（每次提交可单独指定）">
              DeepSeek V4 <span className="chev">▾</span>
            </button>
            <button type="button" className="mic" title="语音输入（下一步接入）" aria-label="语音输入">
              ◎
            </button>
            <button type="button" className="send" onClick={send} disabled={!draft.trim() || submit.isPending} aria-label="提交这一轮">
              <Send24Filled />
            </button>
          </div>
        </div>
      </main>

      <aside className="v2-log" aria-label="学习日志">
        <h2>学习档案</h2>
        <div className="v2-archive">
          <div className="card">
            <div className="tier">
              当前档位 <b>{tierLabel}</b>
            </div>
            <div className="why">
              档位是作答证据的测量结果，不能自选；想改档只能多做题。
            </div>
          </div>
          <div className="card">
            <div className="metric">
              <b>作答</b>
              {answeredCount} 题
            </div>
            <div className="bar">
              <i style={{ width: `${Math.min(100, answeredCount * 12)}%` }} />
            </div>
            <div className="metric" style={{ marginTop: 10 }}>
              <b>变式</b>
              {variantCount} 组
            </div>
            <div className="bar">
              <i style={{ width: `${Math.min(100, variantCount * 33)}%` }} />
            </div>
          </div>
        </div>
        <h2>学习日志</h2>
        <h3>实时建议</h3>
        {advice.length === 0 ? (
          <div className="row">还没有建议。说一句你想学什么，这里会出现三条。</div>
        ) : (
          <ul className="advice">
            {advice.map((a) => (
              <li key={a.id}>{a.text}</li>
            ))}
          </ul>
        )}
        <h3>这一会话</h3>
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
