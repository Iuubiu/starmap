/**
 * Persona 加载与区分度自检。
 *
 * 用 fs 读 JSON 而不是 `import ... with { type: 'json' }`：
 * ① 这个包同时被 node 原生运行（`node src/layer1/index.ts`）、vitest 和
 *    Playwright 加载，三者对 import attributes 的支持不完全一致；
 * ② 报告工具需要在**运行期**列出可用 persona（`--persona p2`），目录扫描
 *    比静态 import 表更不容易漏。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPersonaCoherence, PersonaSchema, type Persona } from './schema.ts';

export const personasDir = dirname(fileURLToPath(import.meta.url));

/* 不用参数属性（`constructor(readonly file: string)`）：erasableSyntaxOnly
   会拒绝它，因为 node 的类型剥离不会把它展开成赋值语句。 */
export class PersonaConfigError extends Error {
  readonly file: string;
  readonly problems: readonly string[];

  constructor(file: string, problems: readonly string[]) {
    super(`persona 配置无效：${file}\n  - ${problems.join('\n  - ')}`);
    this.name = 'PersonaConfigError';
    this.file = file;
    this.problems = problems;
  }
}

/** 目录里所有 persona 配置文件名（按文件名排序，保证 P1→P3 顺序稳定）。 */
export function listPersonaFiles(dir: string = personasDir): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

/**
 * 读一个 persona 并校验。校验失败抛 `PersonaConfigError`，带**逐条**问题，
 * 而不是笼统的 "invalid config" —— 配置错误要能直接抄进 issue。
 */
export function loadPersona(file: string, dir: string = personasDir): Persona {
  const fullPath = join(dir, file);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(fullPath, 'utf8')) as unknown;
  } catch (error) {
    throw new PersonaConfigError(file, [`JSON 解析失败：${(error as Error).message}`]);
  }

  const parsed = PersonaSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '<root>'}：${issue.message}`,
    );
    throw new PersonaConfigError(file, problems);
  }

  const coherence = checkPersonaCoherence(parsed.data);
  if (coherence.length > 0) {
    throw new PersonaConfigError(file, coherence);
  }

  /* 文件名与 id 不一致时，报告里的 persona_id 和命令行参数会对不上，
     是最容易在跑完 20 分钟后才发现的那种错。 */
  const expectedId = basename(file, '.json');
  if (parsed.data.id !== expectedId) {
    throw new PersonaConfigError(file, [
      `id="${parsed.data.id}" 与文件名 "${expectedId}" 不一致（报告按 id 索引，命令行按文件名）`,
    ]);
  }

  return parsed.data;
}

/** 加载目录下全部 persona，并断言三档齐全、tier 不重复。 */
export function loadAllPersonas(dir: string = personasDir): Persona[] {
  const personas = listPersonaFiles(dir).map((file) => loadPersona(file, dir));
  if (personas.length === 0) {
    throw new PersonaConfigError(dir, ['目录下没有任何 persona JSON']);
  }

  const tiers = new Set<string>();
  const ids = new Set<string>();
  for (const persona of personas) {
    if (tiers.has(persona.tier)) {
      throw new PersonaConfigError(persona.id, [`tier ${persona.tier} 重复，三档必须一一对应`]);
    }
    if (ids.has(persona.id)) {
      throw new PersonaConfigError(persona.id, ['id 重复']);
    }
    tiers.add(persona.tier);
    ids.add(persona.id);
  }

  return personas;
}

/** 区分度自检用的三个维度。 */
export const DISTINCTIVENESS_DIMENSIONS = [
  'firstTurnLengthChars',
  'probeToleranceRounds',
  'terminologyDensity',
] as const;

export type DistinctivenessDimension = (typeof DISTINCTIVENESS_DIMENSIONS)[number];

/** 票 20 的硬阈值：三项两两相对差不得小于 20%。 */
export const MIN_RELATIVE_GAP = 0.2;

/**
 * 两两相对差：`|a-b| / max(|a|,|b|)`。
 *
 * 为什么用 max 做分母而不是均值：(3,1) 用均值算得 100%，用 max 算得 67%，
 * 都很宽松；真正危险的是 0.05 vs 0.06 这种"看着设了但没差别"的值，两种
 * 算法都能抓出来。选 max 是因为它对小数值更严格、且不会被负数/零搞出
 * 除零（分母取 max，只有两者都是 0 才为 0，此时差也是 0，正确判失败）。
 */
export function relativeGap(a: number, b: number): number {
  const denominator = Math.max(Math.abs(a), Math.abs(b));
  if (denominator === 0) return 0;
  return Math.abs(a - b) / denominator;
}

export interface DistinctivenessViolation {
  dimension: DistinctivenessDimension;
  pair: [string, string];
  values: [number, number];
  gap: number;
}

/**
 * 区分度自检：三项维度上，任意两个 persona 的相对差都必须 ≥20%。
 *
 * 为什么要跑这个：LLM 扮演的三档人格会**坍缩**（NN/g 的 mode collapse）——
 * 提示词里写着"零基础"和"专家"，生成出来的第一句话却是同一个长度、同一个
 * 用词。坍缩之后评估仍然会产出漂亮的报告，只是三档数据其实是同一档跑了
 * 三遍。这条检查是唯一能在跑完之前发现它的手段。
 */
export function checkDistinctiveness(personas: readonly Persona[]): DistinctivenessViolation[] {
  const violations: DistinctivenessViolation[] = [];

  for (const dimension of DISTINCTIVENESS_DIMENSIONS) {
    for (let i = 0; i < personas.length; i += 1) {
      for (let j = i + 1; j < personas.length; j += 1) {
        const left = personas[i];
        const right = personas[j];
        if (!left || !right) continue;
        const a = left.distinctiveness[dimension];
        const b = right.distinctiveness[dimension];
        const gap = relativeGap(a, b);
        if (gap < MIN_RELATIVE_GAP) {
          violations.push({
            dimension,
            pair: [left.id, right.id],
            values: [a, b],
            gap,
          });
        }
      }
    }
  }

  return violations;
}

export { checkPersonaCoherence };
export type { Persona };
