/**
 * 页面级动作 —— **从路由表生成**，不手抄一份路径清单。
 *
 * ## 为什么必须从 `appRoutes` 生成
 *
 * 手抄一份的结果已经在这个仓库里发生过：`AppShell` 的 `NAV_ITEMS` 是一份
 * 手写清单，`routes.tsx` 是另一份。两份一旦分叉，症状是「侧栏里有入口、
 * 面板里没有」或者更糟 —— 面板把一个已经不存在的路径当成可跳转目标，点了
 * 404。路由表是**唯一**知道「哪些路径存在」的地方，所以路径从那里读。
 *
 * 但路由表只有路径、没有中文名（`routes.tsx` 刻意不认识文案）。所以这里
 * 是「路径来自路由表 + 名字来自一张标签表」，标签表缺键时**不静默跳过**，
 * 而是让 `pages.test.ts` 红 —— 新增一个页面却忘了给面板加名字，是必须被
 * 提醒的事，不是可以忽略的事。
 *
 * ## 哪些路由不算「页面级动作」
 *
 * - 带参数的（`/map/:microKpId`、`/level/:levelId`）：它们需要先选中一个
 *   知识点/关卡，不是「跳转到某个页面」。
 * - `*` 兜底路由：它不是目的地，是「没找到」。
 * - 根路由（`/` 的 element 是 `AppShell`）：它是外壳，不是页面。
 */

import type { RouteObject } from 'react-router';

/** 一个页面级动作：跳到某个静态路径。 */
export interface PageAction {
  /** 稳定 id，测试与 `aria-activedescendant` 用 */
  id: string;
  /** 路由表里的路径 */
  path: string;
  /** 中文名 */
  label: string;
  /** 副标注（面板右列） */
  hint: string;
}

/**
 * 路径 → 中文名 + 副标注。
 *
 * 名字与 `AppShell` 的侧栏文案一致：用户在侧栏学到的词，在面板里必须是同一
 * 个词，否则「知识地图」和「图谱」会让人以为是两个地方。
 */
const PAGE_LABELS: Record<string, { label: string; hint: string }> = {
  '/': { label: '学习', hint: '智能体主页' },
  '/placement': { label: '定级', hint: '自评 → 答题 → 结果' },
  '/review': { label: '复验', hint: '到期的知识点' },
  '/board': { label: '看板', hint: '今日推荐与摘要' },
  '/map': { label: '知识地图', hint: '全部知识点图谱' },
  '/market': { label: '关卡市场', hint: '浏览与生成关卡' },
  '/market/generate': { label: '生成关卡', hint: '按知识点现场生成' },
  '/database': { label: '数据库', hint: '题库与内容统计' },
  '/library': { label: '内容库', hint: '教材·期刊·题库·技能' },
  '/skills': { label: '技能库', hint: '智能体技能' },
  // 票 78 新增的两页：欢迎页「初识」与「我的」。
  '/welcome': { label: '初识', hint: '八问建立学习者画像' },
  '/me': { label: '我的', hint: '画像与个人看板' },
  // 票 76：导航第一项从「学习」改成「学习记录」，这里必须跟上 ——
  // 漏了它，命令面板就搜不到自己的第一入口（漂移守卫会当场变红）。
  '/learning': { label: '学习记录', hint: '历次会话' },
};

/** 路径是否是一个「页面级动作」的目标。 */
function isPagePath(path: string): boolean {
  return path !== '*' && !path.includes(':') && !path.includes('*');
}

/**
 * 从路由表里抽出页面级动作。
 *
 * 入参显式传入（而不是直接 import `appRoutes`）有两个好处：单测可以喂一份
 * 假路由来验证过滤规则，而「真路由表能不能被覆盖」由另一条测试单独钉住 ——
 * 后者才是防漂移的那一条。
 *
 * 深度优先遍历：路由表当前只有一层 children，但嵌套是 react-router 的正常
 * 用法，写死一层等于埋一个「以后加嵌套路由就漏」的坑。
 */
export function buildPageActions(routes: readonly RouteObject[], parentPath = ''): PageAction[] {
  const out: PageAction[] = [];

  for (const route of routes) {
    const segment = route.path ?? '';
    const full =
      segment === '' ? parentPath : `${parentPath}/${segment}`.replace(/\/{2,}/g, '/');

    /* `index: true` 的路由是父路径的默认页，父路径本身已经是一个动作
       （`/` 的 index 是 HomePage）—— 把它当成独立动作会得到两个 `/`。 */
    if (route.index === true) {
      if (isPagePath(full) && PAGE_LABELS[full] !== undefined) {
        out.push({ id: `page:${full}`, path: full, ...PAGE_LABELS[full] });
      }
      continue;
    }

    if (route.children !== undefined && route.children.length > 0) {
      out.push(...buildPageActions(route.children, full));
      continue;
    }

    if (!isPagePath(full) || full === '') continue;
    const label = PAGE_LABELS[full];
    if (label === undefined) continue;
    out.push({ id: `page:${full}`, path: full, ...label });
  }

  return out;
}

/**
 * 路由表里所有「本该有名字」的静态路径。
 *
 * `pages.test.ts` 拿它跟 `PAGE_LABELS` 的键集比对：新增页面时如果忘了加名字，
 * 这条测试会告诉你**具体缺哪一个路径**。
 */
export function staticPagePaths(routes: readonly RouteObject[], parentPath = ''): string[] {
  const out: string[] = [];

  for (const route of routes) {
    const segment = route.path ?? '';
    const full = segment === '' ? parentPath : `${parentPath}/${segment}`.replace(/\/{2,}/g, '/');

    if (route.index === true) {
      if (isPagePath(full) && full !== '') out.push(full);
      continue;
    }
    if (route.children !== undefined && route.children.length > 0) {
      out.push(...staticPagePaths(route.children, full));
      continue;
    }
    if (!isPagePath(full) || full === '') continue;
    out.push(full);
  }

  return out;
}

/** 标签表本身，供测试比对键集。 */
export const pageLabels = PAGE_LABELS;
