/**
 * `ChunkIndex.search` 的 `extraTerms` 与 `buildSnippet` 的跨语言取词（t32）。
 *
 * ## 为什么单独一个文件、不放进 `retrieval.controller.test.ts`
 *
 * 那个文件是**接口级**测试，要起 Nest、建 schema、种 4 个 chunk，跑一次 4 秒。
 * 这里守的是两个纯函数的**回归性质**，尤其是「`extraTerms` 为空时结果逐位
 * 相同」——那条不变量是「不改变原有单语行为」的唯一证据，必须能在毫秒级
 * 反复跑（将来有人调 `search` 时第一道红就是它）。
 *
 * ## 为什么用真实语料而不是造的 chunk
 *
 * `extraTerms` 的全部意义是「中文 query 能在英文正文里命中」。造的英文句子
 * 会不知不觉地迁就实现（比如恰好每个词都以空格分开、恰好没有连字符）。
 * 这里的英文片段从真实 chunk 里抄（Knoll 第 12 章的锗探测器正文），
 * 中文片段从康华光里抄。
 */
import { describe, expect, it } from 'vitest';
import { ChunkIndex, buildSnippet, tokenize, type IndexedChunk } from './bm25.js';

function chunk(overrides: Partial<IndexedChunk> & { id: string; text: string }): IndexedChunk {
  return {
    microKpId: 'kp-x',
    sourceId: 'src-x',
    sourceTitle: '测试用书',
    kind: 'text',
    page: 1,
    ordinal: 1,
    ...overrides,
  };
}

const ENGLISH = chunk({
  id: 'ck-en',
  sourceId: 'knoll-4e-2010',
  sourceTitle: 'Radiation Detection and Measurement',
  // 注意 `Germanium coaxial detectors`：两个词**不连写**，用来验证扩展词是按
  // token 匹配的，而不是拿整串做子串匹配。
  text:
    'Germanium coaxial detectors provide excellent energy resolution for gamma-ray spectroscopy. ' +
    'The energy resolution of a germanium crystal is typically about 2 keV at 1332 keV. ' +
    'Such coaxial sensors are widely used in environmental monitoring.',
});

const CHINESE = chunk({
  id: 'ck-zh',
  sourceId: 'digital-kanghua-5e',
  sourceTitle: '电子技术基础·数字部分',
  text: '逻辑代数的基本运算有三种：与、或、非。组合逻辑电路的输出只取决于当前输入。',
});

function index(): ChunkIndex {
  return new ChunkIndex([ENGLISH, CHINESE]);
}

describe('extraTerms 为空时行为逐位不变', () => {
  it('中文 query 不带扩展词时，命中的是中文 chunk', () => {
    const results = index().search('逻辑代数');
    expect(results.map((r) => r.chunk.id)).toEqual(['ck-zh']);
  });

  it('英文 query 不带扩展词时，命中的是英文 chunk', () => {
    const results = index().search('germanium detector');
    expect(results.map((r) => r.chunk.id)).toContain('ck-en');
  });

  it('`extraTerms: []` 与不传 extraTerms 的结果逐位相同（含分数）', () => {
    const withoutOption = index().search('逻辑代数');
    const withEmpty = index().search('逻辑代数', { extraTerms: [] });
    expect(withEmpty).toEqual(withoutOption);
  });

  it('`extraTerms: ["   "]`（全是空白）等同于空数组', () => {
    const withoutOption = index().search('germanium detector');
    const withBlank = index().search('germanium detector', { extraTerms: ['   '] });
    expect(withBlank).toEqual(withoutOption);
  });
});

describe('extraTerms 让中文 query 命中英文正文', () => {
  it('中文 query 单跑命中 0 条（这是要修的事实本身）', () => {
    expect(index().search('锗探测器能量分辨')).toEqual([]);
  });

  it('加上 `Germanium Detectors` 之后命中英文 chunk', () => {
    const results = index().search('锗探测器能量分辨', {
      extraTerms: ['Germanium Detectors'],
    });
    expect(results.map((r) => r.chunk.id)).toEqual(['ck-en']);
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it('扩展词不会把中文 chunk 挤掉（原 query 的命中仍在）', () => {
    const results = index().search('逻辑代数', { extraTerms: ['germanium detector'] });
    expect(results.map((r) => r.chunk.id)).toContain('ck-zh');
    expect(results.map((r) => r.chunk.id)).toContain('ck-en');
  });

  it('多个扩展词是 OR 关系（任一命中即可）', () => {
    const results = index().search('脉冲成形', {
      extraTerms: ['Multichannel Analyzer', 'germanium detector'],
    });
    expect(results.map((r) => r.chunk.id)).toEqual(['ck-en']);
  });

  it('扩展词按 token 匹配，不会要求整串连写', () => {
    // 正文里 `Germanium` 与 `detectors` 之间隔着 `coaxial`，整串不存在；
    // 扩展词 `Germanium Detectors` 仍能命中 —— 因为 MiniSearch 会把子查询
    // 各自 tokenize（`germanium` + `detectors`），这正是跨语言要的行为。
    expect(ENGLISH.text.toLowerCase()).not.toContain('germanium detectors');
    const results = index().search('锗探测器', { extraTerms: ['Germanium Detectors'] });
    expect(results.map((r) => r.chunk.id)).toEqual(['ck-en']);
  });
});

describe('buildSnippet 的跨语言取词', () => {
  // 长文本，命中点刻意放在 300 字之后（「从头截 160 字」取不到）
  const LONG_ENGLISH =
    'Preface. '.repeat(40) +
    'The energy resolution of a germanium detector is limited by charge trapping and leakage current. ' +
    'Tail. '.repeat(40);

  it('只有中文 query 时，摘要退回从头截（找不到命中点）', () => {
    const snippet = buildSnippet(LONG_ENGLISH, '锗探测器能量分辨');
    expect(snippet.startsWith('Preface.')).toBe(true);
  });

  it('带上扩展词之后，摘要取到英文命中点附近', () => {
    const snippet = buildSnippet(LONG_ENGLISH, '锗探测器能量分辨', 160, ['energy resolution']);
    expect(snippet).toContain('energy resolution');
    expect(snippet.startsWith('Preface.')).toBe(false);
  });

  it('短文本原样返回，不受扩展词影响', () => {
    const short = 'Germanium detectors.';
    expect(buildSnippet(short, '锗探测器', 160, ['germanium'])).toBe(short);
  });

  it('中文 query 的命中点仍然优先（扩展词只是补充）', () => {
    const text = '无关内容。'.repeat(30) + '这里讲逻辑代数的基本运算。' + '无关内容。'.repeat(30);
    const snippet = buildSnippet(text, '逻辑代数', 40, ['irrelevant']);
    expect(snippet).toContain('逻辑代数');
  });
});

describe('tokenize 的既有行为（回归基线）', () => {
  it('CJK 切成重叠二元组，ASCII 词整词保留', () => {
    expect(tokenize('锗探测器 Ge(Li) detector')).toEqual([
      'ge',
      'li',
      'detector',
      '锗探',
      '探测',
      '测器',
    ]);
  });
});
