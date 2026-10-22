import { describe, expect, it } from 'vitest';
import type { GraphResponse } from '../api/generated/model';
import type { PaletteItem } from './items.js';
import { defaultItems, groupBySection, nodeActions, nodeItem, pageItem } from './items.js';

type ActionItem = Extract<PaletteItem, { kind: 'action' }>;

function asActions(items: PaletteItem[]): ActionItem[] {
  return items.filter((item): item is ActionItem => item.kind === 'action');
}

type Node = GraphResponse['nodes'][number];

function node(microKpId: string, name: string, state: Node['state'] = 'unseen'): Node {
  return {
    microKpId,
    name,
    moduleId: 'digital',
    moduleName: '数字逻辑',
    moduleOrdinal: 1,
    ordinal: 1,
    depth: 1,
    percent: null,
    reviewDueAt: null,
    state,
  };
}

const byId = new Map(
  [
    node('kp-bool', '布尔代数基本运算', 'familiar'),
    node('kp-kmap', '卡诺图化简'),
    node('kp-signal', '信号的频谱'),
  ].map((entry) => [entry.microKpId, entry]),
);

const pages = [
  { id: 'page:/', path: '/', label: '学习', hint: '智能体主页' },
  { id: 'page:/board', path: '/board', label: '看板', hint: '今日推荐与摘要' },
];

describe('nodeItem', () => {
  it('副标注是「所属模块 · 掌握状态」，状态用统一词表', () => {
    const item = nodeItem(node('kp-bool', '布尔代数基本运算', 'familiar'));
    expect(item.id).toBe('node:kp-bool');
    expect(item.hint).toBe('数字逻辑 · 已熟悉');
  });
});

describe('nodeActions', () => {
  it('三个动作的落点都不新增路由：详情 / 地图视野 / 生成页预填', () => {
    const actions = asActions(nodeActions(node('kp-bool', '布尔代数基本运算')));
    expect(actions.map((action) => action.label)).toEqual(['打开详情', '去地图定位', '生成关卡']);
    expect(actions.map((action) => action.path)).toEqual([
      '/map/kp-bool',
      expect.stringContaining('/map?'),
      '/market/generate?microKpIds=kp-bool',
    ]);
    expect(actions.map((action) => action.id)).toEqual([
      'action:detail:kp-bool',
      'action:locate:kp-bool',
      'action:generate:kp-bool',
    ]);
  });

  it('id 里的知识点 id 带冒号时也能被动作解析回来', () => {
    const [detail] = asActions(nodeActions(node('kp:a', '怪 id')));
    expect(detail?.id.split(':').slice(2).join(':')).toBe('kp:a');
  });
});

describe('defaultItems', () => {
  it('最近访问按顺序取前 3 个，后面的页面动作都保留', () => {
    const items = defaultItems(['kp-kmap', 'kp-bool', 'kp-signal', 'kp-bool'], byId, pages);
    expect(items.slice(0, 3).map((item) => item.kind)).toEqual(['node', 'node', 'node']);
    expect(items.slice(0, 3).map((item) => item.label)).toEqual([
      '卡诺图化简',
      '布尔代数基本运算',
      '信号的频谱',
    ]);
    expect(items.slice(3).map((item) => item.kind)).toEqual(['page', 'page']);
  });

  it('失效的知识点 id 被跳过，但页面动作仍然填满空态', () => {
    const items = defaultItems(['kp-gone', 'kp-bool'], byId, pages);
    expect(items.map((item) => item.label)).toEqual(['布尔代数基本运算', '学习', '看板']);
  });

  it('没有历史时至少给出全部页面动作（不是空白）', () => {
    expect(defaultItems([], byId, pages).map((item) => item.kind)).toEqual(['page', 'page']);
  });
});

describe('groupBySection', () => {
  it('固定顺序是「知识点 → 页面 → 动作」，空段不出现', () => {
    const groups = groupBySection([
      pageItem(pages[0]!),
      nodeItem(byId.get('kp-bool')!),
      nodeActions(byId.get('kp-bool')!)[0]!,
    ]);
    expect(groups.map((group) => group.section)).toEqual(['node', 'page', 'action']);
    expect(groups.map((group) => group.title)).toEqual(['知识点', '页面', '动作']);
  });
});
