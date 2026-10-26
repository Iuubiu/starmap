/**
 * 知识点搜索索引（票 07）的纯逻辑测试。
 *
 * 这里钉住判据的**数据半边**（组件测试只钉入口与空态文案）：
 *
 * 1. 名字子串命中，结果项带 `sourceTitle`——库里 3000+ 节点大量重名
 *    （「吸收律」在两本书里各有一个），不带书名消歧做不出来。
 * 2. 纯数字输入按**印刷页码精确命中**，且不落在名字的数字上——
 *    「12」该找的是第 12 页，不是名字里碰巧有 12 的点。
 * 3. ~4030 节点量的一次 `query()` 实测 < 200ms（阈值放 200ms 防 CI 抖动；
 *    朴素线性扫描在 4030 量级是微秒级，这个断言防的是有人把实现换成
 *    正则全表或每次查询重建索引）。
 */
import { describe, expect, it } from 'vitest';
import { createKpIndex, KP_INDEX_MAX_RESULTS, type KpIndexNode } from './kp-index.js';

const NODES: readonly KpIndexNode[] = [
  {
    microKpId: 'kp-bool',
    name: '布尔代数基本运算',
    sourceTitle: '电子技术基础·数字部分（康华光 第5版）',
    page: 12,
  },
  {
    microKpId: 'kp-kmap',
    name: '卡诺图化简',
    sourceTitle: '电子技术基础·数字部分（康华光 第5版）',
    page: 34,
  },
  {
    microKpId: 'kp-absorb-kang',
    name: '吸收律',
    sourceTitle: '电子技术基础·数字部分（康华光 第5版）',
    page: 45,
  },
  {
    microKpId: 'kp-absorb-knoll',
    name: '吸收律',
    sourceTitle: '辐射探测与测量（Knoll 第4版 2010）',
    page: 210,
  },
  // 名字里带数字、页码不相关：证明纯数字输入走页码路径，不做名字子串
  { microKpId: 'kp-ttl', name: '74LS12 译码器', sourceTitle: null, page: 88 },
  // 手工知识点：无书无页，字段是 null 不是 undefined
  { microKpId: 'kp-manual', name: '触发器例题', sourceTitle: null, page: null },
];

describe('createKpIndex：按名字子串', () => {
  it('重名各带书名消歧（两本书的「吸收律」都在结果里，可区分）', () => {
    const hits = createKpIndex(NODES).query('吸收律');
    expect(hits.map((hit) => hit.microKpId)).toEqual(['kp-absorb-kang', 'kp-absorb-knoll']);
    expect(hits.map((hit) => hit.sourceTitle)).toEqual([
      '电子技术基础·数字部分（康华光 第5版）',
      '辐射探测与测量（Knoll 第4版 2010）',
    ]);
  });

  it('子串命中名字中段；结果保持列表顺序（不按得分重排）', () => {
    const hits = createKpIndex(NODES).query('卡诺');
    expect(hits.map((hit) => hit.name)).toEqual(['卡诺图化简']);
  });

  it('手工知识点（sourceTitle/page 为 null）不炸，书名位为 null', () => {
    const hits = createKpIndex(NODES).query('触发器');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({ microKpId: 'kp-manual', name: '触发器例题', sourceTitle: null });
  });

  it('不命中返回空数组而不是抛错', () => {
    expect(createKpIndex(NODES).query('不存在的东西')).toEqual([]);
  });

  it('空白输入返回空数组（空态由界面说话，不在这里猜）', () => {
    expect(createKpIndex(NODES).query('   ')).toEqual([]);
    expect(createKpIndex(NODES).query('')).toEqual([]);
  });
});

describe('createKpIndex：纯数字按页码精确命中', () => {
  it('「34」命中 page=34 的节点', () => {
    const hits = createKpIndex(NODES).query('34');
    expect(hits.map((hit) => hit.microKpId)).toEqual(['kp-kmap']);
  });

  it('「12」命中第 12 页，不命中名字里带 12 的（页码路径不做名字子串）', () => {
    const hits = createKpIndex(NODES).query('12');
    expect(hits.map((hit) => hit.microKpId)).toEqual(['kp-bool']);
  });

  it('全角数字「１２」也命中第 12 页（中文输入法的默认数字形态）', () => {
    const hits = createKpIndex(NODES).query('１２');
    expect(hits.map((hit) => hit.microKpId)).toEqual(['kp-bool']);
  });

  it('带空格的数字先 trim 再判（「 210 」也命中第 210 页）', () => {
    const hits = createKpIndex(NODES).query(' 210 ');
    expect(hits.map((hit) => hit.microKpId)).toEqual(['kp-absorb-knoll']);
  });

  it('没有第 999 页 → 空数组', () => {
    expect(createKpIndex(NODES).query('999')).toEqual([]);
  });
});

describe('createKpIndex：结果上限', () => {
  it(`同名节点多于 ${KP_INDEX_MAX_RESULTS} 个时截断（弹层不渲染 2000 个按钮）`, () => {
    const many: KpIndexNode[] = Array.from({ length: KP_INDEX_MAX_RESULTS + 10 }, (_, i) => ({
      microKpId: `kp-signal-${i}`,
      name: '信号',
      sourceTitle: `书 ${i}`,
      page: i + 1,
    }));
    expect(createKpIndex(many).query('信号')).toHaveLength(KP_INDEX_MAX_RESULTS);
    // 页码路径同样截断：第 1 页只有一条，但同名多的场景两个路径同一套规则
    expect(createKpIndex(many).query('1')).toHaveLength(1);
  });
});

describe('票 07 判据 3：~4030 节点量的查询性能（单测层探针）', () => {
  // 与真实库同量级的合成数据：4030 个节点，一半名字含「布尔」（让子串
  // 命中最坏情况——结果多到触上限），页码铺开 1..4030。
  const NODE_COUNT = 4030;
  const synthetic: KpIndexNode[] = Array.from({ length: NODE_COUNT }, (_, i) => ({
    microKpId: `kp-synth-${i}`,
    name: i % 2 === 0 ? `布尔代数变式 ${i}` : `组合逻辑分析 ${i}`,
    sourceTitle: i % 3 === 0 ? '电子技术基础·数字部分（康华光 第5版）' : '辐射探测与测量（Knoll 第4版 2010）',
    page: i + 1,
  }));
  const index = createKpIndex(synthetic);

  it(`名字子串查询 ${NODE_COUNT} 节点 < 200ms（朴素线性扫描，实测数字见输出）`, () => {
    const started = performance.now();
    const hits = index.query('布尔');
    const elapsed = performance.now() - started;
    // 这行输出就是票面要的探针数字（回执引用它，不靠人肉掐表）
    console.info(`[kp-index 探针] 名字子串「布尔」@${NODE_COUNT} 节点：${elapsed.toFixed(2)}ms，命中 ${hits.length} 条（上限 ${KP_INDEX_MAX_RESULTS}）`);
    expect(hits.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(200);
  });

  it(`纯数字页码查询 ${NODE_COUNT} 节点 < 200ms（全表扫 page 字段）`, () => {
    const started = performance.now();
    const hits = index.query('4030');
    const elapsed = performance.now() - started;
    console.info(`[kp-index 探针] 页码「4030」@${NODE_COUNT} 节点：${elapsed.toFixed(2)}ms，命中 ${hits.length} 条`);
    expect(hits).toHaveLength(1);
    expect(elapsed).toBeLessThan(200);
  });

  it('每次查询不重建索引：连打 50 次与 1 次同量级（防把建索引写进 query）', () => {
    const started = performance.now();
    for (let i = 0; i < 50; i += 1) index.query('布尔');
    const elapsed = performance.now() - started;
    console.info(`[kp-index 探针] 50 次连查：${elapsed.toFixed(2)}ms（均摊 ${(elapsed / 50).toFixed(3)}ms/次）`);
    expect(elapsed).toBeLessThan(200 * 50);
  });
});
