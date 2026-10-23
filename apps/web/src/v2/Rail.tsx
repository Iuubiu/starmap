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
import { useLocation, useNavigate } from 'react-router';

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

/** 右栏顶部的「个人现状」：只显示能拿到的真数字，拿不到就说清楚为什么。 */
function useSnapshot(): { tier: string | null; answered: number | null; stillLoading: boolean } {
  const [tier, setTier] = useState<string | null>(null);
  const [answered, setAnswered] = useState<number | null>(null);
  const [stillLoading, setStillLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/api/v1/placement')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch('/api/v1/recommendations')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([placement, rec]) => {
        if (!alive) return;
        const t = (placement as { tier?: string } | null)?.tier ?? null;
        const a = (rec as { summary?: { answered?: number } } | null)?.summary?.answered;
        setTier(t);
        setAnswered(typeof a === 'number' ? a : null);
      })
      .finally(() => {
        if (alive) setStillLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { tier, answered, stillLoading };
}

export function Rail(): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const spec = PAGES[location.pathname] ?? { title: '快捷指令', quick: [] };
  const { tier, answered, stillLoading } = useSnapshot();

  return (
    <aside className="v2-log v2-railbox" aria-label={`${spec.title} 的个人看板与快捷指令`}>
      <h2>{spec.title}</h2>

      <h3>我的现状</h3>
      <div className="card">
        <div className="metric">
          <span className="metric-label">当前档位</span>
          <b data-rail-tier>{tier ?? (stillLoading ? '读取中…' : '—')}</b>
        </div>
        <div className="why">
          {tier === null && !stillLoading
            ? '还没定级：去「初始定级」答完 5 题，这里就有档位了。'
            : '档位是作答证据的测量结果，不能自选。'}
        </div>
      </div>
      <div className="card">
        <div className="metric">
          <span className="metric-label">今天答了</span>
          <b data-rail-answered>{answered ?? (stillLoading ? '读取中…' : '—')}</b>
          <span className="metric-label">题</span>
        </div>
        <div className="why">
          {answered === null && !stillLoading ? '推荐接口没返回统计，这个数暂时读不到（不是 0）。' : '含派生练习与复验。'}
        </div>
      </div>

      <h3>快捷指令</h3>
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
