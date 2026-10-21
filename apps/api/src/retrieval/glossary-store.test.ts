/**
 * 术语表加载器的测试（t32）。
 *
 * ## 为什么「文件不存在」这条必须测
 *
 * 全新 clone 还没跑过 ingest 时没有 `content/glossary.json`。这时如果
 * `loadGlossary` 抛错，`RetrievalService` 的构造函数就抛错 → `AppModule` 起不来
 * → **整个 API 挂掉**，包括看板、图谱、技能库这些与检索无关的页面。
 *
 * 而它本该付出的代价只有一条：中文 query 搜不到英文正文（与修之前一样）。
 * 这条测试守的就是「降级而不是崩」。
 *
 * ## 为什么「产物有脏条目」不在这里清洗
 *
 * `export_glossary.py` 才是清洗的地方，`parseGlossary` 只做**形状**校验。
 * 如果这里也清洗一遍，「产物有问题」就会在运行时被静默修好 —— 而产物是要被
 * 审查的东西（`test_export_glossary.py` 守它）。所以这里只丢「形状不合法」的，
 * 并且要证明它确实只丢这些。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultGlossaryPath, loadGlossary, parseGlossary } from './glossary-store.js';

const tempDirs: string[] = [];

function tempFile(content: string, name = 'glossary.json'): string {
  const dir = mkdtempSync(join(tmpdir(), 'starmap-glossary-'));
  tempDirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, content, 'utf8');
  return path;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('loadGlossary：文件不存在时降级而不是崩', () => {
  it('路径不存在 → entries 为空、loaded:false、error 里给出怎么生成', () => {
    const missing = join(tmpdir(), `starmap-nonexistent-${Date.now()}.json`);
    const loaded = loadGlossary(missing);
    expect(loaded.loaded).toBe(false);
    expect(loaded.entries).toEqual([]);
    expect(loaded.path).toBe(missing);
    // 错误信息必须能指导人怎么修，而不是只说「失败了」
    expect(loaded.error).toContain('export_glossary.py');
  });

  it('JSON 语法错误 → 降级，不抛错', () => {
    const path = tempFile('{ 这不是 JSON');
    const loaded = loadGlossary(path);
    expect(loaded.loaded).toBe(false);
    expect(loaded.entries).toEqual([]);
    expect(loaded.error).toContain('词表解析失败');
  });

  it('顶层不是数组 → 降级，不抛错', () => {
    const path = tempFile('{"zh":"探测器","en":["Detector"]}');
    const loaded = loadGlossary(path);
    expect(loaded.loaded).toBe(false);
    expect(loaded.error).toContain('顶层必须是数组');
  });

  it('空数组 → 视为未加载（「空词表」和「没有词表」后果一样）', () => {
    const path = tempFile('[]');
    const loaded = loadGlossary(path);
    expect(loaded.loaded).toBe(false);
    expect(loaded.error).toContain('词表为空');
  });

  it('正常文件 → loaded:true 且条目齐全', () => {
    const path = tempFile(
      JSON.stringify([
        { zh: '锗探测器', en: ['Germanium Detectors'], sources: ['knoll-4e-2010'] },
        { zh: '死时间', en: ['Dead Time'], sources: ['knoll-4e-2010'] },
      ]),
    );
    const loaded = loadGlossary(path);
    expect(loaded.loaded).toBe(true);
    expect(loaded.error).toBeNull();
    expect(loaded.entries).toEqual([
      { zh: '锗探测器', en: ['Germanium Detectors'] },
      { zh: '死时间', en: ['Dead Time'] },
    ]);
  });
});

describe('parseGlossary：只做形状校验，不清洗内容', () => {
  it('丢掉形状不合法的条目，保留合法的', () => {
    const entries = parseGlossary(
      JSON.stringify([
        { zh: '锗探测器', en: ['Germanium Detectors'] },
        { zh: '单', en: ['single char zh'] }, // zh 太短
        { zh: '死时间', en: [] }, // 没有英文
        { zh: '噪声', en: ['  ', 'Noise'] }, // 空白串被丢，剩下一条
        { zh: '缺字段' }, // 没有 en
        null,
        '不是对象',
        { zh: 42, en: ['number zh'] }, // zh 不是字符串
      ]),
    );
    expect(entries).toEqual([
      { zh: '锗探测器', en: ['Germanium Detectors'] },
      { zh: '噪声', en: ['Noise'] },
    ]);
  });

  it('不清洗业务内容：`未收录术语` 这类脏条目照样读进来（那是产物测试的事）', () => {
    // 这条是**故意的**：如果这里顺手过滤，「产物里有脏条目」就再也不会被发现。
    const entries = parseGlossary(
      JSON.stringify([{ zh: '未收录术语（Branching ratio）', en: ['Branching ratio'] }]),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.zh).toContain('未收录术语');
  });
});

describe('defaultGlossaryPath', () => {
  it('默认指向仓库根的 content/glossary.json', () => {
    // 从 apps/api/src/retrieval 往上找到 apps/api（有 package.json），再上两级
    const path = defaultGlossaryPath();
    expect(path.replace(/\\/g, '/')).toMatch(/\/content\/glossary\.json$/);
    expect(path.replace(/\\/g, '/')).not.toContain('/apps/api/content/');
  });

  it('`STARMAP_GLOSSARY_PATH` 覆盖默认路径（测试与特殊部署用）', () => {
    const before = process.env.STARMAP_GLOSSARY_PATH;
    try {
      process.env.STARMAP_GLOSSARY_PATH = 'C:/somewhere/else.json';
      expect(defaultGlossaryPath().replace(/\\/g, '/')).toBe('C:/somewhere/else.json');
    } finally {
      if (before === undefined) delete process.env.STARMAP_GLOSSARY_PATH;
      else process.env.STARMAP_GLOSSARY_PATH = before;
    }
  });

  it('真实产物能被默认路径读到，且条目数对得上（产物存在性守卫）', () => {
    const loaded = loadGlossary();
    expect(loaded.loaded).toBe(true);
    expect(loaded.entries.length).toBeGreaterThan(1000);
    // 抽查派单点名的那条：没有它，端到端验收就过不了
    expect(loaded.entries).toContainEqual({
      zh: '锗探测器',
      en: ['Germanium Detectors'],
    });
  });
});
