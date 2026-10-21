/**
 * `content/glossary.json` 的加载器。
 *
 * ## 为什么在 api 层读文件，而不是 engine
 *
 * `packages/engine` 是纯函数库（`.dependency-cruiser.cjs` 的 `engine-no-io`
 * 规则），`expandQuery` 只接受内存里的词表数组。读文件、解析、缓存、降级
 * 都是**部署环境的事**，属于 api 层。
 *
 * ## 为什么启动时读一次、之后不再读
 *
 * 词表是入库产物（`tools/ingest/export_glossary.py` 生成），运行期不会变。
 * 每次检索都 `readFileSync` 会让每次提问都多一次磁盘 IO 与 JSON.parse
 * （2000 条 / 约 200 KB），而它带来的唯一好处是「不用重启就能生效」——
 * 但重新生成词表的场景本来就是重跑入库脚本，那种时候重启是合理的。
 *
 * ## 文件不存在时为什么降级而不是抛错
 *
 * 全新 clone 还没跑过 ingest 时没有 `content/glossary.json`。此时抛错会让
 * **整个 API 起不来**，包括那些与检索无关的页面（看板、图谱、技能库）。
 * 降级成「不扩展」的后果只是「英文语料暂时搜不到中文 query」，与修之前一样，
 * 且日志里有明确的 warn 指向怎么生成。
 *
 * ## 路径解析
 *
 * 与 `skill-scanner.ts` 的 `defaultSkillsDir()` 同一个思路：从本模块位置往上
 * 找带 `package.json` 的目录（`src/retrieval` 与 `dist/retrieval` 都能落到
 * `apps/api`），再往上两级到仓库根，拼 `content/glossary.json`。
 * `STARMAP_GLOSSARY_PATH` 可以覆盖（测试与特殊部署用）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GlossaryEntry } from '@starmap/engine';

/** 词表文件路径。`STARMAP_GLOSSARY_PATH` 优先。 */
export function defaultGlossaryPath(): string {
  const override = process.env.STARMAP_GLOSSARY_PATH;
  if (override && override.trim().length > 0) return resolve(override);

  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i += 1) {
    if (existsSync(join(dir, 'package.json'))) {
      // dir = apps/api → 仓库根是上两级
      return join(dir, '..', '..', 'content', 'glossary.json');
    }
    dir = dirname(dir);
  }

  // 找不到包根就退回相对 import.meta.url 的老路径：宁可指错也不抛错
  return fileURLToPath(new URL('../../../content/glossary.json', import.meta.url));
}

export interface LoadedGlossary {
  /** 词表；文件不存在或格式不对时为空数组 */
  entries: GlossaryEntry[];
  /** 实际读取的路径（日志与调试器用） */
  path: string;
  /** 是否真的加载到了内容 */
  loaded: boolean;
  /** 失败原因（`loaded === false` 时才有值） */
  error: string | null;
}

/**
 * 解析词表 JSON。单独导出是为了让测试能直接喂字符串，不必造文件。
 *
 * 只保留形状正确的条目：`zh` 是 ≥2 字符的字符串、`en` 是至少一条非空字符串的
 * 数组。**不做业务清洗** —— 清洗是 `export_glossary.py` 的责任，这里再做一遍
 * 会让「产物有问题」这件事在运行时被静默修好，而产物才是要审查的东西。
 */
export function parseGlossary(raw: string): GlossaryEntry[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('词表顶层必须是数组');

  const entries: GlossaryEntry[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const { zh, en } = item as { zh?: unknown; en?: unknown };
    if (typeof zh !== 'string' || zh.length < 2) continue;
    if (!Array.isArray(en)) continue;
    const english = en.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    if (english.length === 0) continue;
    entries.push({ zh, en: english });
  }
  return entries;
}

/** 读一次词表。文件不存在/解析失败都返回 `loaded:false` 而不是抛错。 */
export function loadGlossary(path: string = defaultGlossaryPath()): LoadedGlossary {
  if (!existsSync(path)) {
    return {
      entries: [],
      path,
      loaded: false,
      error: `词表文件不存在：${path}（跑 python tools/ingest/export_glossary.py 生成）`,
    };
  }
  try {
    const entries = parseGlossary(readFileSync(path, 'utf8'));
    if (entries.length === 0) {
      return { entries, path, loaded: false, error: `词表为空：${path}` };
    }
    return { entries, path, loaded: true, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { entries: [], path, loaded: false, error: `词表解析失败：${message}` };
  }
}
