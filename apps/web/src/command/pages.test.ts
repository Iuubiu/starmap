import { describe, expect, it } from 'vitest';
import type { RouteObject } from 'react-router';
import { buildPageActions, pageLabels, staticPagePaths } from './pages.js';
import { appRoutes } from '../routes';

/**
 * 页面级动作的生成规则。
 *
 * 最重要的一条是「真路由表里每个静态路径都得有名字」：新增页面却忘了给面板
 * 加名字时，这里会红在**具体缺哪个路径**上，而不是等用户发现面板里少一项。
 */
describe('buildPageActions', () => {
  it('真路由表生成 13 个页面动作，路径与路由表一致', () => {
    const actions = buildPageActions(appRoutes);
    // 票 78 加了 /welcome 与 /me（9→11）；票 76 加了 /learning（11→12）；
    // 内容库加了 /library（12→13）。
    expect(actions.map((action) => action.path).sort()).toEqual([
      '/',
      '/board',
      '/database',
      '/learning',
      '/library',
      '/map',
      '/market',
      '/market/generate',
      '/me',
      '/placement',
      '/review',
      '/skills',
      '/welcome',
    ]);
    expect(actions.map((action) => action.label)).toEqual(
      expect.arrayContaining([
        '学习',
        '看板',
        '数据库',
        '技能库',
        '关卡市场',
        '生成关卡',
        '知识地图',
        '定级',
        '复验',
        '初识',
        '我的',
        '学习记录',
        '内容库',
      ]),
    );
  });

  it('带参数的路径与兜底路由都不算页面级动作', () => {
    const routes: RouteObject[] = [
      { path: 'map/:microKpId' },
      { path: 'level/:levelId' },
      { path: '*' },
    ];
    expect(buildPageActions(routes)).toEqual([]);
  });

  it('index 路由落在父路径上，不会为同一个页面产出两条动作', () => {
    const routes: RouteObject[] = [
      { path: '/', children: [{ index: true }, { path: 'map/:microKpId' }] },
    ];
    const paths = buildPageActions(routes).map((action) => action.path);
    expect(paths).toEqual(['/']);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('嵌套路由会把父路径拼进来，没名字的路径留给漂移检测去报', () => {
    const routes: RouteObject[] = [{ path: '/settings', children: [{ path: 'profile' }] }];
    expect(buildPageActions(routes)).toEqual([]);
    expect(staticPagePaths(routes)).toEqual(['/settings/profile']);
  });

  it('路由表里每个静态路径都必须有中文名（防「加了页面忘了加名字」）', () => {
    const paths = staticPagePaths(appRoutes).filter((path) => path !== '');
    const missing = paths.filter((path) => pageLabels[path] === undefined);
    expect(missing).toEqual([]);
    expect(paths.sort()).toEqual(Object.keys(pageLabels).sort());
  });

  it('id 稳定且带 page: 前缀，便于 aria-activedescendant 与测试定位', () => {
    for (const action of buildPageActions(appRoutes)) {
      expect(action.id).toBe(`page:${action.path}`);
      expect(action.hint.length).toBeGreaterThan(0);
    }
  });
});
