import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { collectFiles, validateFile } from './validate-cli.js';

/**
 * 校验器 CLI 的测试。
 *
 * 票 04 验收 1 的判据是「非法关卡被拒绝并给出**字段级**错误信息」，所以这里
 * 断言的正是 CLI 输出的 `prettyPath`（`steps[2].itemIds[0]` 这种），而不是
 * 「跑完没崩」。写关卡的人看到的就是这一行。
 */
const realSpecPath = join(process.cwd(), '..', '..', 'content', 'levels', 'lv-bool-laws.spec.json');
const realSpec = JSON.parse(readFileSync(realSpecPath, 'utf8')) as Record<string, any>;

const scratch = mkdtempSync(join(tmpdir(), 'lv-validate-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function writeSpec(name: string, mutate: (spec: any) => void): string {
  const copy = structuredClone(realSpec);
  mutate(copy);
  const path = join(scratch, name);
  writeFileSync(path, JSON.stringify(copy, null, 2), 'utf8');
  return path;
}

describe('关卡校验器 CLI', () => {
  it('手写关卡通过校验（作者改完内容就能自查）', () => {
    const result = validateFile(realSpecPath);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('引用不存在的题 → 路径精确到 steps[2].itemIds[0]', () => {
    const path = writeSpec('missing-item.spec.json', (spec) => {
      spec.steps[2].itemIds[0] = 'i-typo';
    });
    const result = validateFile(path);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.prettyPath)).toContain('steps[2].itemIds[0]');
    expect(result.issues.find((i) => i.prettyPath === 'steps[2].itemIds[0]')?.message).toContain(
      'i-typo',
    );
  });

  it('缺预写反馈 → 路径落到 items[1].explainWrong，且提示是中文', () => {
    const path = writeSpec('empty-feedback.spec.json', (spec) => {
      spec.items[1].explainWrong = '';
    });
    const result = validateFile(path);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((entry) => entry.prettyPath === 'items[1].explainWrong');
    expect(issue).toBeDefined();
    // D10 全中文：给作者看的提示不能是一句英文
    expect(issue?.message).toMatch(/[\u4e00-\u9fa5]/);
    expect(issue?.message).toContain('至少要 1 个字符');
  });

  it('七段顺序错乱 → 指到具体的那一段', () => {
    const path = writeSpec('bad-order.spec.json', (spec) => {
      const swapped = spec.steps[4];
      spec.steps[4] = spec.steps[5];
      spec.steps[5] = swapped;
    });
    const result = validateFile(path);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => /^steps\[\d+\]\.kind$/.test(issue.prettyPath))).toBe(true);
  });

  it('不是 JSON → 报「不是合法的 JSON」而不是崩掉', () => {
    const path = join(scratch, 'broken.spec.json');
    writeFileSync(path, '{ 这不是 JSON', 'utf8');
    const result = validateFile(path);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.message).toContain('不是合法的 JSON');
    expect(result.issues[0]?.prettyPath).toBe('（根）');
  });

  it('目录只收 .json，单文件不看扩展名（人点名的就验）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lv-dir-'));
    writeFileSync(join(dir, 'a.json'), '{}', 'utf8');
    writeFileSync(join(dir, 'b.txt'), '{}', 'utf8');
    const files = collectFiles([dir]).map((file) => file.replaceAll('\\', '/'));
    expect(files.some((file) => file.endsWith('a.json'))).toBe(true);
    expect(files.some((file) => file.endsWith('b.txt'))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('路径不存在时抛错，而不是静默当成「零个文件，全部通过」', () => {
    expect(() => collectFiles([join(scratch, '根本不存在')])).toThrow(/路径不存在/);
  });
});
