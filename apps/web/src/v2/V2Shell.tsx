/*
 * V2Shell —— 四页（/、/learning、/market、/map）共用的 v2 外壳。
 *
 * ## 为什么要有这个文件
 *
 * 票 83 之后，只有 `/` 用了 v2 外壳（左轨 68 / 会话列 200 / 内容列 / 右栏），
 * 其余三页仍由 `components/AppShell.tsx` 渲染：四页里三页是旧壳、一页是新壳，
 * 同一个应用里两套侧栏并存。本节把外壳抽出来，`/` 与三页挂到同一个
 * `<V2Shell/>` 布局路由下。
 *
 * ## 边界
 *
 * - **不替换 AppShell**：`/skills`、`/database`、`/level/:id` 等尚未迁移的路由
 *   继续走 `AppShell`，本文件不 import、不改动它。
 * - 页面只负责自己的**主列**（`<main className="v2-main">`），右侧栏作为
 *   slot 由页面自己渲染（`/` 的「学习档案 / 学习日志」就是这么进来的）。
 *   外壳给 `.v2-panel` 固定三列 `200px minmax(0,1fr) 314px`，主列宽度因此
 *   在四页之间**逐像素一致**；某页没有右栏时，第三列留空而不是被主列吃掉。
 * - 窄屏复用 `v2.css` 现有的 `@media (max-width: 1180px)` 单列规则
 *   （票面写的 767px 与代码不符，以代码为准，见 evidence）：会话列/右栏收起，
 *   主列占满，左轨仍在。
 *
 * ## 为什么导航用 window.location.assign 而不是 <Link>
 *
 * 四页之间的切换是「换一个工作台」而不是同一页内的状态变化：会话、滚动位置、
 * 图谱相机都不该跨页带着走。整页导航顺带把外壳也重新挂载，避免旧页的 effect
 * 在后台继续跑。`/` 的会话切换同理（换会话 id 后必须重新拉对话历史）。
 */
import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Rail } from './Rail';
import {
  BookOpen24Regular,
  Clock24Regular,
  Bookmark24Regular,
  DataBarVertical24Regular,
  Library24Regular,
  Map24Regular,
  Person24Regular,
  Target24Regular,
} from '@fluentui/react-icons';
import { resetSessionId } from '../agent/session';
import './v2.css';

type Row = { id?: string; utterance?: string; createdAt?: string };

type NavItem = { key: string; label: string; path: string; icon: typeof BookOpen24Regular };

const NAV: NavItem[] = [
  { key: 'learn', label: '学习', path: '/', icon: BookOpen24Regular },
  { key: 'placement', label: '定级', path: '/placement', icon: Target24Regular },
  { key: 'review', label: '复验', path: '/review', icon: Clock24Regular },
  { key: 'board', label: '看板', path: '/board', icon: DataBarVertical24Regular },
  { key: 'map', label: '知识地图', path: '/map', icon: Map24Regular },
  { key: 'market', label: '关卡市场', path: '/market', icon: Bookmark24Regular },
  { key: 'library', label: '内容库', path: '/library', icon: Library24Regular },
  { key: 'me', label: '我的', path: '/me', icon: Person24Regular },
];

/** 左下角固定项（账户），不参与上方导航循环。 */
const ME_NAV = NAV[NAV.length - 1];

/** 会话记录按「今天 / 昨天 / 本周 / 更早」分组，用服务端 lastActivityAt 真值。 */
function bucketSessions(rows: Row[]): Array<{ label: string; items: Row[] }> {
  const dayStart = new Date().setHours(0, 0, 0, 0);
  const out: Array<{ label: string; items: Row[] }> = [
    { label: '今天', items: [] },
    { label: '昨天', items: [] },
    { label: '本周', items: [] },
    { label: '更早', items: [] },
  ];
  for (const row of rows) {
    const d = row.createdAt ? new Date(row.createdAt).setHours(0, 0, 0, 0) : dayStart;
    const days = Math.round((dayStart - d) / 86_400_000);
    const idx = days <= 0 ? 0 : days === 1 ? 1 : days < 7 ? 2 : 3;
    out[idx]?.items.push(row);
  }
  return out.filter((b) => b.items.length > 0);
}

/** 当前路径属于哪个导航项：`/map/:id` 也算「知识地图」。 */
function activeKey(pathname: string): string {
  if (pathname === '/') return 'learn';
  const hit = NAV.filter((n) => n.path !== '/')
    .sort((a, b) => b.path.length - a.path.length)
    .find((n) => pathname === n.path || pathname.startsWith(`${n.path}/`));
  return hit?.key ?? '';
}

/**
 * 外壳本体：左轨 + 会话列 + `<Outlet/>`。
 *
 * `<Outlet/>` 直接放在 `.v2-panel` 里，因此页面渲染的 `<main className="v2-main">`
 * （以及 `/` 的 `<aside className="v2-log">`）才是网格的第 2 / 第 3 列。
 */
export function V2Shell() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sessions, setSessions] = useState<Row[]>([]);
  const [sessionsError, setSessionsError] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/v1/agent/sessions?limit=40')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(
        (json: {
          sessions?: Array<{ sessionId?: string; firstUtterance?: string | null; lastActivityAt?: string }>;
        }) => {
          if (!alive || !Array.isArray(json.sessions)) return;
          setSessions(
            json.sessions.map((it) => ({
              id: it.sessionId,
              utterance: it.firstUtterance ?? '（未记录原话）',
              createdAt: it.lastActivityAt,
            })),
          );
        },
      )
      .catch(() => {
        /* 会话列表读不到不影响主流程：导航与页面照常可用 */
        if (alive) setSessionsError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const buckets = useMemo(() => bucketSessions(sessions), [sessions]);
  const current = activeKey(location.pathname);
  const isChat = location.pathname === '/';

  const startNewSession = () => {
    resetSessionId();
    window.location.assign('/');
  };

  const openSession = (sessionId: string | undefined) => {
    if (!sessionId) return;
    try {
      window.localStorage.setItem('starmap.session', sessionId);
    } catch {
      /* 隐私模式下写不进去：退回当前会话，不弹错 */
    }
    window.location.assign('/');
  };

  return (
    <div className="v2-shell">
      <nav className="v2-rail" aria-label="主导航">
        {NAV.slice(0, -1).map(({ key, label, path, icon: Icon }) => (
          <button
            key={key}
            type="button"
            title={label}
            aria-label={label}
            aria-current={key === current ? 'page' : undefined}
            onClick={() => window.location.assign(path)}
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

      {/* 非聊天页（学习页以外）左栏收起：会话列表只对「继续某个学习对话」有意义，
          在定级/复验/地图/市场/内容库/技能库上占掉 15% 宽度纯属浪费。
          用户 2026-10-23 裁定：非聊天界面左中栏合并。 */}
      <div className={isChat ? 'v2-panel' : 'v2-panel v2-panel--wide'}>
        <aside className="v2-sessions" aria-label="学习记录">
          <button type="button" className="new-row" onClick={startNewSession}>
            <span aria-hidden="true">✎</span>
            <span>新对话</span>
          </button>
          <button type="button" className="row entry" onClick={() => window.location.assign('/learning')}>
            <span>学习记录</span>
          </button>
          {buckets.map((b) => (
            <div key={b.label}>
              <div className="grp">{b.label}</div>
              {b.items.slice(0, 8).map((row, i) => (
                <button
                  key={row.id ?? `${b.label}-${i}`}
                  type="button"
                  className="row"
                  title={row.utterance}
                  onClick={() => openSession(row.id)}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.utterance ?? '（未记录原话）'}
                  </span>
                  <span>
                    {row.createdAt
                      ? new Date(row.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                      : ''}
                  </span>
                </button>
              ))}
            </div>
          ))}
          {sessionsError && <div className="grp">会话列表暂时读不到</div>}
        </aside>
        <Outlet />
        {/* 非聊天页的右栏：个人现状 + 该页快捷指令（每项都能点、点了有用）。
            聊天页的右栏由 HomeV2 自己渲染（它的内容是「本次会话」相关的）。 */}
        {!isChat && <Rail />}
      </div>
    </div>
  );
}

/**
 * 迁移页面的主列。
 *
 * - 默认（`fill` 不传）：内容自己滚，整页高度交给内容；
 * - `fill`：主列不滚，内容撑满可用高度（地图要的是这一档：画布高度跟着窗口长，
 *   而不是恒 480）。
 *
 * 页面根节点上的 `maxWidth: min(1200px, 100%)` 等阅读宽度在这里被解除：
 * 迁移到外壳之后，「多宽」由外壳决定，页面不该再自己封顶。
 */
export function V2Main({ children, fill }: { children: React.ReactNode; fill?: boolean }) {
  return (
    <main className={fill ? 'v2-main v2-main--fill' : 'v2-main v2-main--page'}>{children}</main>
  );
}
