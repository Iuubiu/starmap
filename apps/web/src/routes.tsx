import type { RouteObject } from 'react-router';
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
 * ## 全应用只有一套外壳（2026-10-26 修复「两套前端界面」）
 *
 * 曾经这里有两个根布局：`V2Shell`（新）管大多数页面，`AppShell`（旧）管
 * `/welcome`、`/me`、节点详情、关卡页与出题页——从新界面点「打开关卡」会整块
 * 切回旧顶栏，首访问卷更是直接开在旧壳里。修复后：
 *
 * - **所有页面都住在 `V2Shell` 下**（左轨 + 会话列 + 主列 + 右栏），一套导航、
 *   一套材质；旧 `AppShell` 已删除。
 * - `/welcome` 是**唯一**例外：它是首访引导，本来就不该带任何工作台外壳，
 *   独立成无壳根路由（答完由 `FirstVisitGate` 放行进学习台）。
 */
export const appRoutes: RouteObject[] = [
  // v2 外壳：全部页面共用（左轨 68 / 会话列 200 / 主列 / 右栏 314）。
  // 布局路由不带 path，子路由写绝对路径。页面自己只渲染主列（`<main
  // className="v2-main">`）；`/` 额外渲染右栏（`aside.v2-log`），作为外壳的
  // 右侧 slot。主列宽度因此全页一致。
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
      // 节点详情是阅读页：留在滚动主列里，不抢地图的 fill 形态。
      { path: '/map/:microKpId', element: <V2Main><NodeDetailPage /></V2Main> },
      { path: '/placement', element: <V2Main><PlacementPage /></V2Main> },
      { path: '/board', element: <V2Main><DashboardPage /></V2Main> },
      { path: '/review', element: <V2Main><ReviewPage /></V2Main> },
      { path: '/library', element: <V2Main><LibraryPage /></V2Main> },
      { path: '/database', element: <V2Main><DatabasePage /></V2Main> },
      { path: '/skills', element: <V2Main><SkillsPage /></V2Main> },
      { path: '/me', element: <V2Main><MePage /></V2Main> },
      // 关卡播放器：从右栏「打开关卡」进来时不再切换外壳（旧 AppShell 时期
      // 这一步会整块变回旧顶栏——「两套 UI」最刺眼的一跳）。
      { path: '/level/:levelId', element: <V2Main><LevelPage /></V2Main> },
      // 复验（票 07）单独开一页，不嵌在知识点详情页里：验收第 1 条要求
      // 「多个知识点交错出现而不是同一个连考」—— 单知识点页天然只有一张卷。
      { path: '/market/author/:microKpId', element: <V2Main><MarketAuthorPage /></V2Main> },
      { path: '/market/generate', element: <V2Main><GenerationPage /></V2Main> },
      // 兜底：没有它时 React Router 会渲染内置的英文开发者错误页。
      // 本地单用户的 URL 很容易改错一个字符，那时该看到中文说明而不是 💿。
      { path: '*', element: <V2Main><NotFoundPage /></V2Main> },
    ],
  },
  // 首访引导：无壳根路由。它不该借用任何工作台外壳——问卷期间学习者还没有
  // 「可导航的工作台」，旧做法把它塞在 AppShell 里，第一次打开应用看到的
  // 就是另一套 UI（正是「两套前端界面」的一部分）。
  {
    path: '/welcome',
    element: <WelcomePage />,
    errorElement: <RouteErrorPage />,
  },
];
