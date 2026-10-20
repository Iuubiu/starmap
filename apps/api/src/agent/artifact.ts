import { z } from 'zod';
import {
  AgentArtifactSchema,
  type AgentArtifact,
  type AgentCardAction,
} from '@starmap/api-contract';

/**
 * 模型原始输出 → 契约里的产物卡。
 *
 * ## 三层处理，顺序不能换
 *
 * 1. **剥离内部字段**（`stripInternalFields`）——在 parse 之前。
 *    模型有时会把推理过程塞进 `reasoning` / `thinking` / `answerKey` 之类的键。
 *    如果先 parse，这些键会被契约的 `additionalProperties: false` 挡下来
 *    （zod 的 object 默认剥离未知键，但 `.$strict()` 会报错），于是整轮降级；
 *    而它们本该只是「不该展示」，不是「整张卡作废」。所以先删键再校验。
 *    **这一步是票 08「内部推理字段在展示前被剥离，不得进 DOM」的实现点。**
 *
 * 2. **按 kind 校验**（`AgentArtifactSchema`）——四种卡之一，字段不全会失败。
 *
 * 3. **补运行时字段**（`hydrate`）——`cardId` / `createdAt` / `actions` 这些
 *    是服务端生成的事实，不该由模型编。模型给了也覆盖掉。
 *
 * ## 为什么剥离要递归
 *
 * 内部字段经常出现在嵌套位置：`artifact.level.reasoning`、
 * `artifact.neighbors[0]._debug`。只删顶层等于没删。
 */

/**
 * 绝不进响应、绝不进 DOM 的键。
 *
 * 命名有三类来源，都收在这里：
 * - 模型自发的推理键（reasoning / thinking / thought / chain_of_thought）；
 * - 我们要求它「先想再答」时可能用的（scratch / scratchpad / work）；
 * - 答案类（answer / answerKey / solution / finalAnswer / expected）——
 *   这些在出题校验里是合法数据，但**产物卡里没有它们的容身之处**，
 *   出现了就说明模型在泄露，删掉比展示安全。
 */
const INTERNAL_KEYS: ReadonlySet<string> = new Set([
  'reasoning',
  'thinking',
  'thought',
  'thoughts',
  'chain_of_thought',
  'chainofthought',
  'scratch',
  'scratchpad',
  'work',
  'internal',
  'debug',
  'raw',
  'raw_output',
  'answer',
  'answerkey',
  'answer_key',
  'solution',
  'finalanswer',
  'final_answer',
  'expected',
  'expectedvalue',
  'expected_value',
  'correct',
  'iscorrect',
  'explanation',
]);

/** 任何以下划线开头的键都视为内部字段（`_debug`、`_trace` 之类）。 */
function isInternalKey(key: string): boolean {
  return key.startsWith('_') || INTERNAL_KEYS.has(key.toLowerCase());
}

/**
 * 递归剥离内部字段。
 *
 * 数组保持长度与顺序（删元素会改变语义，删键不会）。
 * 返回新对象，不修改入参 —— 调用方可能还要用原始值写日志。
 */
export function stripInternalFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripInternalFields(item));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isInternalKey(key)) continue;
      out[key] = stripInternalFields(child);
    }
    return out;
  }
  return value;
}

/** 剥离后仍出现在文本里的内部字段痕迹（用于测试断言「没进 DOM」）。 */
export function findLeakedInternalKeys(value: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        if (isInternalKey(key)) found.push(path === '' ? key : `${path}.${key}`);
        walk(child, path === '' ? key : `${path}.${key}`);
      }
    }
  };
  walk(value, '');
  return found;
}

/** 校验结果。失败时不抛错——调用方要靠它决定「重试」还是「降级」。 */
export type ArtifactParseResult =
  | { ok: true; artifact: AgentArtifact }
  | { ok: false; issues: string[] };

/** 把 zod 的 issue 压成一行行可读的中文（日志与降级卡都用它）。 */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });
}

/**
 * 按契约校验一张卡。
 *
 * `hydrate` 之前调用：模型必须给出 kind 与业务字段，但**不必**给出
 * cardId/createdAt（服务端补）。所以这里先补占位值再校验，校验完由
 * 调用方覆盖成真值。
 */
export function parseArtifact(raw: unknown): ArtifactParseResult {
  const stripped = stripInternalFields(raw);
  if (stripped === null || typeof stripped !== 'object' || Array.isArray(stripped)) {
    return { ok: false, issues: ['产物卡必须是一个对象'] };
  }

  const withScaffold = {
    cardId: 'pending',
    createdAt: 'pending',
    ...(stripped as Record<string, unknown>),
  };

  const parsed = AgentArtifactSchema.safeParse(withScaffold);
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) };
  return { ok: true, artifact: parsed.data };
}

/**
 * 覆盖服务端事实字段。
 *
 * 为什么覆盖而不是信任模型：
 * - `cardId` 必须是唯一键（回看、依据查询都靠它），模型会重复给同一个；
 * - `createdAt` 必须是服务端时间，否则时间线排序会跟着模型的幻觉走；
 * - `actions` 由卡的种类决定，模型多给一个「retry」在关卡卡上就是错的。
 */
export function hydrateArtifact(
  artifact: AgentArtifact,
  facts: { cardId: string; createdAt: string; actions?: AgentCardAction[] },
): AgentArtifact {
  const base = { ...artifact, cardId: facts.cardId, createdAt: facts.createdAt };
  if (artifact.kind === 'probe_form') {
    return {
      ...base,
      kind: 'probe_form',
      actions: facts.actions ?? artifact.actions,
    } as AgentArtifact;
  }
  return base as AgentArtifact;
}

/**
 * 卡片标题：产物卡有名字（票 08 验收）。
 *
 * 模型给的 title 优先；没给时按 kind + 定位信息生成一个可读的中文名，
 * 让「回看列表」里不会出现一串无标题条目。
 */
export function fallbackTitle(artifact: AgentArtifact): string {
  switch (artifact.kind) {
    case 'level_card':
      return `关卡：${artifact.title}`;
    case 'graph_focus':
      return `图谱：${artifact.name}`;
    case 'progress_change':
      return `进度：${artifact.name}`;
    case 'probe_form':
      return `追问：${artifact.question}`;
    default:
      return '学习记录';
  }
}

/** 产物卡默认动作（票 08 点名的两类：再试一次 / 看依据）。 */
export function defaultActions(kind: AgentArtifact['kind']): AgentCardAction[] {
  if (kind === 'probe_form') {
    return [
      { kind: 'retry', label: '再问一次', enabled: true },
      { kind: 'show_evidence', label: '看依据', enabled: true },
    ];
  }
  return [
    { kind: 'retry', label: '再来一张', enabled: true },
    { kind: 'show_evidence', label: '看依据', enabled: true },
  ];
}
