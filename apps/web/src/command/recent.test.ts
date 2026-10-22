import { beforeEach, describe, expect, it } from 'vitest';
import {
  RECENT_STORAGE_KEY,
  RECENT_STORAGE_LIMIT,
  RECENT_VISIBLE,
  clearRecentNodes,
  nodeIdFromPath,
  readRecentNodes,
  recordRecentNode,
} from './recent.js';

/**
 * 「最近访问」是一个纯本地记忆，跑在面板打开路径上。
 *
 * 因此它的失败模式全部是「不能抛」：localStorage 在隐私模式 / 配额满 / 被
 * 策略禁用时会抛异常，一条历史记录不该把命令面板弄崩。这些用例把每条
 * 降级路径钉住。
 */
beforeEach(() => {
  window.localStorage.clear();
});

describe('readRecentNodes', () => {
  it('没写过时返回空数组', () => {
    expect(readRecentNodes()).toEqual([]);
  });

  it('坏 JSON / 非数组 / 非字符串项都被当成空或跳过', () => {
    window.localStorage.setItem(RECENT_STORAGE_KEY, '{not json');
    expect(readRecentNodes()).toEqual([]);

    window.localStorage.setItem(RECENT_STORAGE_KEY, '{"a":1}');
    expect(readRecentNodes()).toEqual([]);

    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(['kp-a', 42, '', 'kp-a', 'kp-b']));
    expect(readRecentNodes()).toEqual(['kp-a', 'kp-b']);
  });

  it('超过上限的部分被截断', () => {
    const many = Array.from({ length: RECENT_STORAGE_LIMIT + 5 }, (_, index) => `kp-${index}`);
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(many));
    expect(readRecentNodes()).toHaveLength(RECENT_STORAGE_LIMIT);
  });
});

describe('recordRecentNode', () => {
  it('置顶 + 去重：再访问一次会挪到最前，不长出重复项', () => {
    recordRecentNode('kp-a');
    recordRecentNode('kp-b');
    recordRecentNode('kp-a');
    expect(readRecentNodes()).toEqual(['kp-a', 'kp-b']);
  });

  it('返回值就是写入后的列表（读写不出现两个世界）', () => {
    const next = recordRecentNode('kp-c');
    expect(next).toEqual(readRecentNodes());
    expect(next[0]).toBe('kp-c');
  });

  it('空白 id 被忽略', () => {
    expect(recordRecentNode('   ')).toEqual([]);
    expect(readRecentNodes()).toEqual([]);
  });

  it('显示条数小于存储上限（多存是为了容错，不是多显示）', () => {
    expect(RECENT_VISIBLE).toBe(3);
    expect(RECENT_STORAGE_LIMIT).toBeGreaterThan(RECENT_VISIBLE);
  });
});

describe('clearRecentNodes', () => {
  it('清空后读到空数组', () => {
    recordRecentNode('kp-a');
    clearRecentNodes();
    expect(readRecentNodes()).toEqual([]);
  });
});

describe('nodeIdFromPath', () => {
  it('从详情页路径取 id，并做 URL 解码', () => {
    expect(nodeIdFromPath('/map/kp-bool')).toBe('kp-bool');
    expect(nodeIdFromPath('/map/kp-%E5%B8%83%E5%B0%94')).toBe('kp-布尔');
  });

  it('只认 /map/:id 一种形状：关卡页、列表页与更深路径都不算', () => {
    expect(nodeIdFromPath('/level/lv-1')).toBeNull();
    expect(nodeIdFromPath('/map')).toBeNull();
    expect(nodeIdFromPath('/map/kp-1/extra')).toBeNull();
    expect(nodeIdFromPath('/board')).toBeNull();
  });

  it('非法百分号编码时原样返回，而不是抛 URIError', () => {
    expect(nodeIdFromPath('/map/kp-%E0%A4%A')).toBe('kp-%E0%A4%A');
  });
});
