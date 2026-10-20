/**
 * 视图状态单测：URL ↔ 焦点 / 跳数 / 视图模式。
 *
 * 票 03 第 4、5 条（往返保持焦点、切视图不丢位置）全靠这层的可逆性。所以
 * 用例的重点是**往返**：任意合法状态序列化再解析回来必须相等，否则「从关卡
 * 回来焦点还在」就会在某些参数组合下静默失效。
 */
import { describe, expect, it } from 'vitest';
import {
  canZoomInHops,
  canZoomOutHops,
  DEFAULT_VIEW,
  describeView,
  HOPS_ALL,
  nextHops,
  parseViewState,
  serializeViewState,
  viewHref,
  withMode,
  type ViewState,
} from './view-state.js';
import { DEFAULT_HOPS, MAX_HOPS } from './topology.js';

function params(init: Record<string, string>): URLSearchParams {
  return new URLSearchParams(init);
}

describe('parseViewState', () => {
  it('空 query 就是默认视图（全图模式）', () => {
    expect(parseViewState(params({}))).toEqual(DEFAULT_VIEW);
    expect(DEFAULT_VIEW).toEqual({ focus: null, hops: null, mode: 'graph' });
  });

  it('有 focus 但没写 hops 时按默认两跳 —— 票 03 的默认视野', () => {
    expect(parseViewState(params({ focus: 'kp-bool' }))).toEqual({
      focus: 'kp-bool',
      hops: DEFAULT_HOPS,
      mode: 'graph',
    });
  });

  it('hops=all 表示全图（有焦点也能看全图）', () => {
    expect(parseViewState(params({ focus: 'kp-bool', hops: HOPS_ALL }))).toEqual({
      focus: 'kp-bool',
      hops: null,
      mode: 'graph',
    });
  });

  it('数字 hops 被夹到合法区间', () => {
    expect(parseViewState(params({ focus: 'a', hops: '1' })).hops).toBe(1);
    expect(parseViewState(params({ focus: 'a', hops: '99' })).hops).toBe(MAX_HOPS);
    expect(parseViewState(params({ focus: 'a', hops: '-5' })).hops).toBe(0);
  });

  it('乱写的 hops 回落到默认两跳，不抛错', () => {
    // URL 可能来自手改或旧版本链接；地图页白屏的代价远大于跳数不对
    expect(parseViewState(params({ focus: 'a', hops: 'abc' })).hops).toBe(DEFAULT_HOPS);
  });

  it('空的 focus= 当成没焦点', () => {
    expect(parseViewState(params({ focus: '' })).focus).toBeNull();
  });

  it('view=mainline 被识别，其它值一律当 graph', () => {
    expect(parseViewState(params({ view: 'mainline' })).mode).toBe('mainline');
    expect(parseViewState(params({ view: 'graph' })).mode).toBe('graph');
    expect(parseViewState(params({ view: 'list' })).mode).toBe('graph');
  });
});

describe('serializeViewState', () => {
  it('默认视图不写任何参数', () => {
    expect(serializeViewState(DEFAULT_VIEW).toString()).toBe('');
  });

  it('有焦点有跳数时两个都写', () => {
    const query = serializeViewState({ focus: 'kp-bool', hops: 2, mode: 'graph' }).toString();
    expect(query).toBe('focus=kp-bool&hops=2');
  });

  it('有焦点但看全图时必须显式写 hops=all', () => {
    // 不写的话会被解析回「有焦点=两跳」，切到全图的动作就丢了
    const query = serializeViewState({ focus: 'kp-bool', hops: null, mode: 'graph' }).toString();
    expect(query).toBe('focus=kp-bool&hops=all');
  });

  it('没焦点时看全图不写 hops —— 那本来就是默认', () => {
    expect(serializeViewState({ focus: null, hops: null, mode: 'graph' }).toString()).toBe('');
  });

  it('主线模式写 view=mainline', () => {
    expect(serializeViewState({ focus: null, hops: null, mode: 'mainline' }).toString()).toBe(
      'view=mainline',
    );
  });
});

describe('往返：票 03 第 4、5 条的可逆性基础', () => {
  const cases: ViewState[] = [
    { focus: null, hops: null, mode: 'graph' },
    { focus: null, hops: null, mode: 'mainline' },
    { focus: 'kp-bool', hops: 2, mode: 'graph' },
    { focus: 'kp-bool', hops: 0, mode: 'graph' },
    { focus: 'kp-bool', hops: MAX_HOPS, mode: 'graph' },
    { focus: 'kp-bool', hops: null, mode: 'graph' },
    { focus: 'kp-bool', hops: 2, mode: 'mainline' },
    { focus: 'kp-bool', hops: null, mode: 'mainline' },
    { focus: 'kp-带中文的id', hops: 3, mode: 'mainline' },
  ];

  it.each(cases)('序列化再解析回得到同一状态：%j', (state) => {
    expect(parseViewState(serializeViewState(state))).toEqual(state);
  });
});

describe('viewHref', () => {
  it('没有参数时是 /map（不带问号）', () => {
    expect(viewHref(DEFAULT_VIEW)).toBe('/map');
  });

  it('有参数时拼成可分享的地址', () => {
    expect(viewHref({ focus: 'kp-bool', hops: 2, mode: 'graph' })).toBe('/map?focus=kp-bool&hops=2');
  });

  it('中文 id 被正确编码', () => {
    const href = viewHref({ focus: '带中文', hops: 1, mode: 'graph' });
    expect(href).toContain('focus=%E5%B8%A6%E4%B8%AD%E6%96%87');
    expect(parseViewState(new URLSearchParams(href.split('?')[1])).focus).toBe('带中文');
  });
});

describe('nextHops：+1 跳 / −1 跳', () => {
  const focused: ViewState = { focus: 'kp-bool', hops: 2, mode: 'graph' };

  it('+1 / −1 各移动一跳', () => {
    expect(nextHops(focused, 1).hops).toBe(3);
    expect(nextHops(focused, -1).hops).toBe(1);
  });

  it('全图状态下 +1 回到默认两跳', () => {
    expect(nextHops({ ...focused, hops: null }, 1).hops).toBe(DEFAULT_HOPS);
  });

  it('全图状态下 −1 无变化（已经是最宽的视野）', () => {
    const state = { ...focused, hops: null };
    expect(nextHops(state, -1)).toEqual(state);
  });

  it('到达上下界时不再变化（按钮该禁用）', () => {
    expect(nextHops({ ...focused, hops: 0 }, -1)).toEqual({ ...focused, hops: 0 });
    expect(nextHops({ ...focused, hops: MAX_HOPS }, 1)).toEqual({ ...focused, hops: MAX_HOPS });
  });

  it('没有焦点时两个方向都不动 —— 无从谈「谁的邻域」', () => {
    const noFocus = { focus: null, hops: null, mode: 'graph' } as const;
    expect(nextHops(noFocus, 1)).toEqual(noFocus);
    expect(nextHops(noFocus, -1)).toEqual(noFocus);
  });

  it('跳数变化不影响焦点与视图模式', () => {
    const next = nextHops({ ...focused, mode: 'mainline' }, 1);
    expect(next.focus).toBe('kp-bool');
    expect(next.mode).toBe('mainline');
  });
});

describe('canZoomInHops / canZoomOutHops', () => {
  it('没有焦点时都不可按', () => {
    expect(canZoomInHops(DEFAULT_VIEW)).toBe(false);
    expect(canZoomOutHops(DEFAULT_VIEW)).toBe(false);
  });

  it('有焦点的全图状态下只能往里收', () => {
    const state: ViewState = { focus: 'a', hops: null, mode: 'graph' };
    expect(canZoomInHops(state)).toBe(true);
    expect(canZoomOutHops(state)).toBe(false);
  });

  it('0 跳已经是最紧的，不能再 −1', () => {
    const state: ViewState = { focus: 'a', hops: 0, mode: 'graph' };
    expect(canZoomOutHops(state)).toBe(false);
    expect(canZoomInHops(state)).toBe(true);
  });
});

describe('withMode：切视图不丢位置', () => {
  it('保留焦点与跳数', () => {
    const state: ViewState = { focus: 'kp-bool', hops: 3, mode: 'graph' };
    const switched = withMode(state, 'mainline');
    expect(switched).toEqual({ focus: 'kp-bool', hops: 3, mode: 'mainline' });
  });

  it('切回来还是原样', () => {
    const state: ViewState = { focus: 'kp-bool', hops: 3, mode: 'graph' };
    expect(withMode(withMode(state, 'mainline'), 'graph')).toEqual(state);
  });
});

describe('describeView：画布的可访问替代文本', () => {
  it('全图', () => {
    expect(describeView(DEFAULT_VIEW, 167, null)).toBe('图谱 · 全图 · 167 个微知识点');
  });

  it('两跳邻域带焦点名', () => {
    expect(describeView({ focus: 'kp-bool', hops: 2, mode: 'graph' }, 5, '布尔代数基本运算')).toBe(
      '图谱 · 布尔代数基本运算 的 2 跳邻域 · 5 个微知识点',
    );
  });

  it('主线模式', () => {
    expect(describeView({ focus: null, hops: null, mode: 'mainline' }, 167, null)).toBe(
      '线性主线 · 全图 · 167 个微知识点',
    );
  });

  it('焦点 id 存在但节点已不在数据里时退回「全图」措辞', () => {
    // 焦点被删了，别输出「undefined 的 2 跳邻域」
    expect(describeView({ focus: 'ghost', hops: 2, mode: 'graph' }, 0, null)).toBe(
      '图谱 · 全图 · 0 个微知识点',
    );
  });
});
