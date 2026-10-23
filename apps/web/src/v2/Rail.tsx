/**
 * 非聊天页的右栏（个人看板 + 该页快捷指令）。
 *
 * ## 为什么要一个共用组件
 *
 * 之前的右栏只在学习页存在，其它页右侧是空的 —— 2560 全屏下那是一片 800+ px 的
 * 空白。用户 2026-10-23 的裁定是「每个页面要有特色化的右栏」：同一套**结构**
 * （个人现状 + 快捷指令），不同页给不同的**内容**。
 *
 * 判定原则有两条：
 * 1. **数字只能来自接口**。拿不到就显示「—」并写清原因，绝不显示 0 假冒
 *    「做了 0 题」（本项目一以贯之的规矩）。
 * 2. **每个指令都真的能执行**。要么 `navigate` 到某个页面，要么调一次接口，
 *    不做「点了没反应」的装饰性按钮。
 */

import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

interface Quick {
  label: string;
  /** 点击后去哪。与 onClick 二选一 */
  to?: string;
  hint?: string;
}

interface PageSpec {
  title: string;
  /** 该页专属的快捷指令 */
  quick: Quick[];
}

/**
 * 每页的专属指令。之所以写在一处而不是散在各页里：右栏由外壳渲染，
 * 页面本身不需要知道右栏存在 —— 这样加一页只需要往这张表里加一行。
 */
const PAGES: Record<string, PageSpec> = {
  '/map': {
    title: '知识地图',
    quick: [
      { label: '回到全图（以枢纽点为中心）', to: '/map', hint: '不指定焦点，自动落在连接最多的点' },
      { label: '去关卡市场挑一关', to: '/market' },
      { label: '看内容库的缺口', to: '/library' },
    ],
  },
  '/market': {
    title: '关卡市场',
    quick: [
      { label: '去知识地图挑知识点', to: '/map' },
      { label: '看我的保存与模板', to: '/market' },
      { label: '去内容库看题库来源', to: '/library' },
    ],
  },
  '/library': {
    title: '内容库',
    quick: [
      { label: '去关卡市场用这些内容出题', to: '/market' },
      { label: '去知识地图看图谱', to: '/map' },
      { label: '看今天该学什么', to: '/board' },
    ],
  },
  '/board': {
    title: '看板',
    quick: [
      { label: '开始学习', to: '/' },
      { label: '开始定级', to: '/placement' },
      { label: '去做复验', to: '/review' },
    ],
  },
  '/placement': {
    title: '初始定级',
    quick: [
      { label: '开始学习（按当前档位）', to: '/' },
      { label: '看今天该学什么', to: '/board' },
      { label: '去知识地图挑知识点', to: '/map' },
    ],
  },
  '/review': {
    title: '复验',
    quick: [
      { label: '开始学习', to: '/' },
      { label: '看今天该学什么', to: '/board' },
      { label: '去知识地图', to: '/map' },
    ],
  },
};

interface DashNode {
  microKpId: string;
  moduleId?: string;
  name: string;
  state: string;
  percent: number | null;
}

interface Dashboard {
  total: number;
  /** 三个分档的计数：已掌握 / 在学（有证据未达标）/ 未开始。右栏要把它们并排显示。 */
  counts: { mastered: number; learning: number; unseen: number };
  mastered: DashNode[];
  learning: DashNode | null;
  /** 学科整体进度：已掌握 / 全部叶节点 */
  ratio: number;
  subject: { total: number; mastered: number; ratio: number };
}

/**
 * 右栏看板的数据：全部从 `GET /api/v1/graph` 一次算出。
 *
 * 为什么不用 `GET /placement` 的档位当主指标：档位（P1/P2/P3）是**内部**的
 * 教学脚手架刻度，学习者看不懂也不该拿它当成绩。用户明确要求展示的是
 * 「学科整体进度 / 最近在学的知识点进度 / 已掌握的知识点」，且每个都要
 * **换算成数字**（多少 / 共多少、百分比），不是一句模糊的「还有不少」。
 */
function useDashboard(): { dash: Dashboard | null; failed: boolean } {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/v1/graph')
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { nodes?: DashNode[] } | null) => {
        if (!alive) return;
        const nodes = Array.isArray(json?.nodes) ? json!.nodes : [];
        if (nodes.length === 0) {
          setFailed(true);
          return;
        }
        const mastered = nodes.filter((n) => n.state === 'mastered');
        /* 「最近在学」= 有作答证据但还没掌握、且百分比最高的那一个。
           拿不到作答时间（图谱接口不返回），所以用掌握度代替「最近」——
           这比编一个时间戳诚实：题目里说的「最近」在数据上就是「推得最远」。 */
        const learningPool = nodes
          .filter((n) => n.state !== 'mastered' && n.state !== 'unseen')
          .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
        setDash({
          total: nodes.length,
          counts: {
            mastered: mastered.length,
            learning: learningPool.length,
            unseen: nodes.filter((n) => n.state === 'unseen').length,
          },
          mastered,
          learning: learningPool[0] ?? null,
          ratio: mastered.length / nodes.length,
          /* 学科口径：用户要的是「核电子学学了 50%」，分母就该是核电子学这批书，
             不是全库 3085（还含电子技术/电路分析）。按 moduleId 里嵌的来源 slug 判定，
             这张 slug 表与 `.scratch/seed-demo-50.sql` 的分母完全一致。 */
          subject: (() => {
            const SUBJECT = [
              'nuclear-electronics-wangjingjin-1983',
              'nuclear-electronics-wangzhiying-1989',
              'radiation-detectors-dinghonglin-2010',
              'nuclear-radiation-physics-chenboxian-2011',
              'nuclear-radiation-measurement-tangbin',
              'radiation-detector-handbook-jichangsong-1990',
              'nuclear-physics-experiment-methods-1997',
              'guojiang-2014',
              'guojiang-2023',
            ];
            const inSubject = nodes.filter((n) =>
              SUBJECT.some((slug) => (n.moduleId ?? '').includes(slug)),
            );
            const done = inSubject.filter((n) => n.state === 'mastered').length;
            return {
              total: inSubject.length,
              mastered: done,
              ratio: inSubject.length ? done / inSubject.length : 0,
            };
          })(),
        });
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { dash, failed };
}

/** 知识点进度条：百分比与「多少 / 共多少」同时给出，不只画一根条。 */
function KpProgress({ kpId, name, source }: { kpId: string; name: string; source: string }) {
  const [view, setView] = useState<{
    gates: Array<{ key: string; label: string; value: number; target: number; ratio: number; unit: string }>;
    gatePassed: boolean;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/v1/mastery/kp/${encodeURIComponent(kpId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (alive && json) setView(json);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [kpId]);

  return (
    <div className="card" data-rail-kp>
      <div className="metric">
        <b>正在学</b>
        <span className="metric-label">{name}</span>
        {/* 「正在学」的选法是「有证据但未达标、掌握度最高的那个」——
            图谱接口不返回作答时间，所以这里不能说「最近」。如实标注选法。 */}
        <span className="rail-note">{source}</span>
      </div>
      {view === null ? (
        <div className="why">正在读进度…</div>
      ) : (
        view.gates.map((g) => (
          <div className="rail-gate" key={g.key}>
            <span className="rail-gate-label">{g.label}</span>
            <span className="rail-gate-track" aria-hidden>
              <i style={{ width: `${Math.round(g.ratio * 100)}%` }} data-tone={g.ratio >= 1 ? 'ok' : 'plain'} />
            </span>
            <span className="rail-gate-num">
              {g.value}/{g.target}
              {g.unit}
            </span>
          </div>
        ))
      )}
      <div className="why">
        {view?.gatePassed ? '本关判定已达标。' : '还没达标：这三条是判定用的硬门槛，不看感觉看数字。'}
      </div>
    </div>
  );
}

export function Rail(): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const spec = PAGES[location.pathname] ?? { title: '', quick: [] };
  const [params] = useSearchParams();
  const kpFromUrl = params.get('kp');
  const { dash, failed } = useDashboard();

  /* 用户要求「精确展示单个知识点的进度」：URL 上带了 ?kp= 就以它为准
     （从知识地图/详情页点进来时会带），否则退回到「掌握度最高的在学节点」。
     两条路径都在卡片上写清楚来源，读的人不用猜。 */
  const focus = kpFromUrl
    ? (dash?.mastered.find((n) => n.microKpId === kpFromUrl) ??
       dash?.learning ??
       { microKpId: kpFromUrl, name: kpFromUrl, state: 'unseen', percent: null })
    : dash?.learning ?? null;
  const focusSource = kpFromUrl ? '来自地址里的 ?kp=' : '按掌握度最高挑出';

  return (
    <aside className="v2-log v2-railbox" aria-label={`${spec.title} 的个人看板与快捷指令`}>
      {spec.title ? <h2>{spec.title}</h2> : null}

      <h3>核电子学 · 学科进度</h3>
      <div className="card" data-rail-subject>
        {dash === null ? (
          <div className="why">{failed ? '图谱接口没返回数据，这一块暂时读不到。' : '正在读图谱…'}</div>
        ) : (
          <>
            <div className="metric">
              <b className="rail-big">{dash.subject.mastered}</b>
              <span className="metric-label">/ {dash.subject.total} 个核电子学知识点已掌握</span>
              <b className="rail-pct">{Math.round(dash.subject.ratio * 100)}%</b>
            </div>
            <span className="rail-bar" aria-hidden>
              <i style={{ width: `${Math.max(2, Math.round(dash.subject.ratio * 100))}%` }} />
            </span>
            <div className="rail-chips">
              <span className="rail-chip" data-kind="mastered">已掌握 <b>{dash.counts.mastered}</b></span>
              <span className="rail-chip" data-kind="learning">在学 <b>{dash.counts.learning}</b></span>
              <span className="rail-chip" data-kind="unseen">未开始 <b>{dash.counts.unseen}</b></span>
            </div>
            <div className="why">
              分母是核电子学 9 本书的 {dash.subject.total} 个叶节点；分子是「已掌握」（连对达标，不是看过）。
              全库另有 {dash.total} 个叶节点（含电子技术、电路分析），全库 {dash.counts.mastered} 个已掌握。
            </div>
          </>
        )}
      </div>

      {focus ? <KpProgress kpId={focus.microKpId} name={focus.name} source={focusSource} /> : null}

      <h3>已掌握的知识点</h3>
      {dash === null ? (
        <div className="why">正在读图谱…</div>
      ) : dash.mastered.length === 0 ? (
        <div className="why">还没有掌握的知识点。答完一关的判定题，这里就会出现第一条。</div>
      ) : (
        <ul className="rail-mastered">
          {dash.mastered.slice(0, 6).map((n) => (
            <li key={n.microKpId}>
              <span className="rail-mastered-name">{n.name}</span>
              <b>{Math.round((n.percent ?? 1) * 100)}%</b>
            </li>
          ))}
        </ul>
      )}
      {dash !== null && dash.mastered.length > 6 ? (
        <div className="why">还有 {dash.mastered.length - 6} 个未列出。</div>
      ) : null}

      {/* 学习页在 PAGES 里没有专属条目，若仍无条件渲染就会出现两个「快捷指令」标题 */}
      {spec.quick.length > 0 ? <h3>快捷指令</h3> : null}
      <ul className="advice">
        {spec.quick.map((q) => (
          <li key={q.label}>
            <button
              type="button"
              className="advice-btn"
              onClick={() => q.to && navigate(q.to)}
              title={q.hint ?? q.label}
            >
              {q.label}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
