import type { RouteObject } from 'react-router';
import { AppShell } from './components/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { MapPage } from './pages/MapPage';
import { NodeDetailPage } from './pages/NodeDetailPage';
import { DatabasePage } from './pages/DatabasePage';
import { LevelPage } from './pages/LevelPage';
import { MarketPage } from './pages/MarketPage';
import { MarketAuthorPage } from './pages/MarketAuthorPage';
import { GenerationPage } from './pages/GenerationPage';
import { HomeV2 } from './v2/HomeV2';
import { V2Main, V2Shell } from './v2/V2Shell';
import { LibraryPage } from './pages/LibraryPage';
import { SkillsPage } from './pages/SkillsPage';
import { PlacementPage } from './pages/PlacementPage';
import { ReviewPage } from './pages/ReviewPage';
import { NotFoundPage, RouteErrorPage } from './pages/NotFoundPage';
import { MePage } from './pages/MePage';
import { LearningPage } from './pages/LearningPage';
import { FirstVisitGate, WelcomePage } from './pages/WelcomePage';

/**
 * 路由表 —— **新增页面只改这一个文件**。
 *
 * 原来这张表写在 `App.tsx` 里，而 `App.tsx` 同时承担 Provider 分层与
 * QueryClient 配置。结果是「加一张页面」要改一个和页面无关的文件；多条
 * 泳道并行时，那是必然的撞车点。拆出来后：
 *
 *   - 本文件只管「路径 → 组件」；
 *   - `App.tsx` 只管 Provider 分层与路由实例化，不再认识任何页面。
 *
 * 页面直接 import，不用 `React.lazy`：六个页面都在首屏导航里，懒加载只会把
 * 「点一下菜单」换成一次网络往返 + 一次布局跳动，得不偿失。将来图谱画布这类
 * 重页面真要分包时，把它换成 `lazy(() => import(...))` 即可，本文件结构不变。
 *
 * 顶栏标签**不在这里**：导航文案住在 `components/AppShell.tsx`。反过来让
 * AppShell 从这里读会形成 `routes.tsx ↔ AppShell.tsx` 的循环 import（本仓库
 * 的 dependency-cruiser 有 `no-circular` 规则，会直接判违规）。
 */
export const appRoutes: RouteObject[] = [
  // v2 外壳（票 96）：`/`、`/learning`、`/market`、`/map` 共用**同一套**外壳
  // （左轨 68 / 会话列 200 / 主列 / 右栏 314）。布局路由不带 path，子路由写绝对路径。
  //
  // 页面自己只渲染主列（`<main className="v2-main">`）；`/` 额外渲染右栏
  // （`aside.v2-log`），作为外壳的右侧 slot。主列宽度因此四页一致。
  {
    element: <V2Shell />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        path: '/',
        element: (
          <FirstVisitGate>
            <HomeV2 />
          </FirstVisitGate>
        ),
      },
      { path: '/learning', element: <V2Main><LearningPage /></V2Main> },
      { path: '/market', element: <V2Main><MarketPage /></V2Main> },
      // 地图要的是「画布跟着窗口长」：主列不滚，页面撑满高度。
      { path: '/map', element: <V2Main fill><MapPage /></V2Main> },
    ],
  },
  {
    path: '/',
    element: <AppShell />,
    // 渲染期异常也落在壳子里，否则整个应用被 React Router 的默认错误页顶掉。
    errorElement: <RouteErrorPage />,
    children: [
      // `/` 是**智能体主页**，不是知识点列表（spec §9 第 1 条）。
      // 看板（推荐 + 今日摘要）在 `/board`。票 01 时 `/` 一度是知识点列表，
      // 那是「先有数据、后有智能体」阶段的临时形状；票 08 落地后必须换回来，
      // 否则最常用的入口是陈列架而不是工作台。
      // 「初识」还没走完时先让位给欢迎页（票 78）：第一次进来看到的是十个问题，
      // 而不是一个它还读不懂的学习台。走过一遍后由 localStorage 里的标记放行。
      { path: 'welcome', element: <WelcomePage /> },
      { path: 'me', element: <MePage /> },
      { path: 'placement', element: <PlacementPage /> },
      { path: 'board', element: <DashboardPage /> },
      { path: 'map/:microKpId', element: <NodeDetailPage /> },
      { path: 'level/:levelId', element: <LevelPage /> },
      // 复验（票 07）单独开一页，不嵌在知识点详情页里：验收第 1 条要求
      // 「多个知识点交错出现而不是同一个连考」—— 单知识点页天然只有一张卷。
      { path: 'review', element: <ReviewPage /> },
      { path: 'database', element: <DatabasePage /> },
      { path: 'market/author/:microKpId', element: <MarketAuthorPage /> },
      { path: 'market/generate', element: <GenerationPage /> },
      { path: 'skills', element: <SkillsPage /> },
      { path: 'library', element: <LibraryPage /> },
      // 兜底：没有它时 React Router 会渲染内置的英文开发者错误页。
      // 本地单用户的 URL 很容易改错一个字符，那时该看到中文说明而不是 💿。
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
