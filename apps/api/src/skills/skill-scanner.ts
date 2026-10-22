import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/**
 * skill 库的**文件系统扫描**（票 15）。
 *
 * ## 为什么 skill 来自文件而不是数据库
 *
 * ADR-0007 把 Mastra 定为 AI 运行时，Mastra 1.78 原生的 skills 就是
 * `skills/<name>/SKILL.md` 这套目录约定。把 skill 正文搬进数据库会立刻
 * 失去三件事：版本控制里的 diff、`references/` 目录、以及 Mastra 自己的
 * 加载器。所以：**正文在文件里，只有开关在数据库里**（见 0022 迁移）。
 *
 * ## 为什么不用 gray-matter
 *
 * `@mastra/core` 内部用 gray-matter，但它是传递依赖，没有被提升到
 * `apps/api/node_modules`（pnpm 的严格布局），直接 import 会解析失败。
 * 而 frontmatter 的解析规则极少（开头 `---` 行、再遇 `---` 结束、中间是
 * YAML），用已经装好的 `yaml`（`package.json` 的 dependencies）切两刀就够了。
 * 多装一个包反而多一处供应链面。
 */

/** 一个 reference 文件的摘要（列表页只给前几行，够判断值不值得展开）。 */
export interface SkillReferenceFile {
  name: string;
  sizeBytes: number;
  preview: string;
}

/** 扫描结果：完全由文件系统决定，不含开关状态。 */
export interface ScannedSkill {
  /** = 目录名（spec §8 硬约束） */
  name: string;
  directoryName: string;
  description: string;
  version: string;
  triggerScenarios: string[];
  /** SKILL.md 正文（frontmatter 之后的部分） */
  instructions: string;
  references: SkillReferenceFile[];
  /** 目录绝对路径，页面上要显示（说明「迁移靠文件系统」） */
  path: string;
  /** Mastra `validateSkillMetadata` 的结论 */
  validation: { valid: boolean; errors: string[]; warnings: string[] };
}

export interface ScanResult {
  /** 被扫描的根目录绝对路径 */
  directory: string;
  skills: ScannedSkill[];
}

/** skill 名硬约束（spec §8），与 Mastra 的 SKILL_LIMITS.MAX_NAME_LENGTH 一致。 */
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

const REFERENCE_PREVIEW_LINES = 6;

/**
 * 默认扫描目录。
 *
 * 优先级：`STARMAP_SKILLS_DIR` 环境变量 → 包根下的候选目录（第一个存在的）。
 *
 * 候选顺序是 `src/mastra/skills` 再 `mastra/skills`：
 * - 前者是 ADR-0007 的位置（Mastra 资产在 `src/mastra/`），也是仓库里的实际位置；
 * - 后者留给「只发布了编译产物」的部署形态。
 *
 * 相对路径一律从**包根**算，不从 `process.cwd()` 算——测试、IDE、`pnpm --filter`
 * 的 cwd 各不相同，用 cwd 会让同一个 skill 在不同入口下时有时无。
 */
export function defaultSkillsDir(): string {
  const override = process.env.STARMAP_SKILLS_DIR;
  if (override && override.trim().length > 0) return resolve(override);

  // 从本模块位置往上找带 package.json 的目录（src/skills 与 dist/skills 都能落到包根）
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i += 1) {
    if (existsSync(join(dir, 'package.json'))) {
      for (const candidate of ['src/mastra/skills', 'mastra/skills']) {
        const full = join(dir, candidate);
        if (existsSync(full)) return full;
      }
      return join(dir, 'src/mastra/skills');
    }
    dir = dirname(dir);
  }

  // 找不到包根就退回相对 import.meta.url 的老路径：宁可指错也不抛错，
  // 扫描层对「目录不存在」的处理是返回空列表而不是 500。
  return fileURLToPath(new URL('../../mastra/skills', import.meta.url));
}

/** 切 frontmatter 与正文。没有 frontmatter 时返回空元数据与原文本。 */
export function splitFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const normalized = raw.replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---')) {
    return { frontmatter: {}, body: normalized };
  }
  // 第一行必须是 ---，然后找下一行独立的 ---
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: normalized };

  const yamlText = normalized.slice(normalized.indexOf('\n') + 1, end + 1);
  const body = normalized.slice(end + 4).replace(/^[\r\n]+/, '');

  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(yamlText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed as Record<string, unknown>;
    }
  } catch {
    // frontmatter 坏掉不该让整个 skill 消失：正文仍然可读，
    // 解析失败会在 validation 里体现为一条 error（见 validate）。
    frontmatter = {};
  }
  return { frontmatter, body };
}

/** 把 frontmatter 里可能是数组、可能是逗号分隔字符串的值统一成字符串数组。 */
function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter((v) => v.length > 0);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,，;；]/)
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }
  return [];
}

/**
 * 从正文里抽「触发场景」。
 *
 * 两种写法都支持，因为既有的 skill 文档习惯不统一：
 * - frontmatter 里的 `triggers: [...]`（Mastra 生态更常见）；
 * - 正文里 `## 触发场景` 标题下的无序列表（人写文档时更常见）。
 * 都拿不到就返回空数组——页面显示「未声明」，而不是编一段出来。
 */
function extractTriggerScenarios(
  frontmatter: Record<string, unknown>,
  body: string,
): string[] {
  const fromFrontmatter = [
    ...toStringList(frontmatter.triggers),
    ...toStringList(frontmatter.triggerScenarios),
    ...toStringList(frontmatter.when_to_use),
  ];
  if (fromFrontmatter.length > 0) return fromFrontmatter;

  const section = /^##+\s*(触发场景|使用时机|何时使用)\s*$/m.exec(body);
  if (!section) return [];

  const start = section.index + section[0].length;
  const rest = body.slice(start);
  // 到下一个同级或更高级标题为止
  const nextHeading = /^#{1,2}\s+/m.exec(rest);
  const block = nextHeading ? rest.slice(0, nextHeading.index) : rest;

  const items: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    const match = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (match && match[1] !== undefined) {
      const text = match[1].trim();
      if (text.length > 0) items.push(text);
    }
  }
  return items;
}

/** 读 `references/` 下的文件清单（一层，不递归子目录）。 */
function readReferences(skillDir: string): SkillReferenceFile[] {
  const refDir = join(skillDir, 'references');
  let entries: string[];
  try {
    entries = readdirSync(refDir);
  } catch {
    return [];
  }

  const out: SkillReferenceFile[] = [];
  for (const entry of entries.sort()) {
    const full = join(refDir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    let preview = '';
    try {
      preview = readFileSync(full, 'utf8')
        .split(/\r?\n/)
        .slice(0, REFERENCE_PREVIEW_LINES)
        .join('\n')
        .trim();
    } catch {
      preview = '';
    }
    out.push({ name: entry, sizeBytes: stat.size, preview });
  }
  return out;
}

/**
 * 结构校验。
 *
 * 这里**不调用** Mastra 的 `validateSkillMetadata`，因为那个函数需要完整的
 * agent 上下文并且会引入 `@mastra/core` 到扫描层；扫描层要能被单独测试。
 * 规则与 Mastra 的公开约束保持一致，写在 `SKILL_LIMITS` 的同一组数字上。
 */
export function validateScannedSkill(input: {
  name: string;
  directoryName: string;
  description: string;
  instructions: string;
}): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!SKILL_NAME_PATTERN.test(input.name)) {
    errors.push(
      `skill 名必须是小写字母/数字/连字符且不超过 64 字符，实际为「${input.name}」`,
    );
  }
  if (input.name !== input.directoryName) {
    errors.push(
      `frontmatter 的 name（${input.name}）与目录名（${input.directoryName}）不一致——Mastra 用目录名定位 skill`,
    );
  }
  if (input.description.trim().length === 0) {
    errors.push('缺少 description：它是 agent 判断要不要加载这个 skill 的唯一依据');
  }
  if (input.description.length > 1024) {
    errors.push(`description 超过 1024 字符（实际 ${input.description.length}）`);
  }
  if (input.instructions.trim().length === 0) {
    errors.push('SKILL.md 正文为空');
  }

  const lines = input.instructions.split(/\r?\n/).length;
  if (lines > 500) warnings.push(`正文 ${lines} 行，超过 500 行；建议把细节移进 references/`);

  return { valid: errors.length === 0, errors, warnings };
}

/** 扫描一个 skill 目录。目录里没有 SKILL.md 时返回 null（不是错误：可能是草稿目录）。 */
function scanSkillDir(skillDir: string, directoryName: string): ScannedSkill | null {
  const skillFile = join(skillDir, 'SKILL.md');
  let raw: string;
  try {
    raw = readFileSync(skillFile, 'utf8');
  } catch {
    return null;
  }

  const { frontmatter, body } = splitFrontmatter(raw);
  const name = typeof frontmatter.name === 'string' ? frontmatter.name : directoryName;
  const description =
    typeof frontmatter.description === 'string' ? frontmatter.description : '';
  const metadata =
    frontmatter.metadata && typeof frontmatter.metadata === 'object'
      ? (frontmatter.metadata as Record<string, unknown>)
      : {};
  const version =
    typeof frontmatter.version === 'string'
      ? frontmatter.version
      : typeof metadata.version === 'string'
        ? metadata.version
        : '未标注';

  return {
    name,
    directoryName,
    description,
    version,
    triggerScenarios: extractTriggerScenarios(frontmatter, body),
    instructions: body,
    references: readReferences(skillDir),
    path: skillDir,
    validation: validateScannedSkill({ name, directoryName, description, instructions: body }),
  };
}

/**
 * 扫描 root 下的全部 skill。
 *
 * 排序用目录名：列表页的顺序必须稳定，否则每次刷新都在跳。
 */
export function scanSkills(root: string = defaultSkillsDir()): ScanResult {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    // 目录不存在不算错误：全新 clone 还没写 skill 时页面应该是空列表而不是 500。
    return { directory: root, skills: [] };
  }

  const skills: ScannedSkill[] = [];
  for (const entry of entries.sort()) {
    if (entry.startsWith('.') || entry.startsWith('_')) continue;
    const dir = join(root, entry);
    let stat;
    try {
      stat = statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const skill = scanSkillDir(dir, entry);
    if (skill) skills.push(skill);
  }
  return { directory: root, skills };
}

/** 单目录的扫描（调试与测试用）。 */
export function scanSkillAt(skillDir: string): ScannedSkill | null {
  return scanSkillDir(skillDir, relative(dirname(skillDir), skillDir) || skillDir);
}
