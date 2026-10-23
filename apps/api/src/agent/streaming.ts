import type { LlmMessage, LlmPort, LlmResult } from '../llm/llm.port.js';
import { initialVisibleState, takeVisibleDelta } from './visible-stream.js';

/**
 * 流式钩子。两个回调都可选：只想要事件流而不想逐字，就只给 `onStage`。
 *
 * `onStage` 的 `detail` 是写给人看的一句短话（"检索命中 30 段，放行 6 段"），
 * 不是日志——它最终会出现在界面的阶段行里，所以要求可读、不含 id。
 */
export interface TurnStreamHooks {
  onStage?: (stage: 'skills' | 'retrieval' | 'decision' | 'model', detail: string) => void;
  onToken?: (text: string) => void;
}

/**
 * 流式跑一次 plan 生成，把 `visibleResponse` 的已确定部分逐段吐给调用方。
 *
 * 为什么改走 `stream` 而不是继续 `complete`：只有逐 token 到达，界面才可能
 * 「像 chat 模型一样涌现」。但 plan 的结构化不能被牺牲 —— 所以这里做的是
 * 「流式收原文，同时增量解析出可见正文」，最终仍返回与 `complete()` 同形的
 * `LlmResult`，后续的 schema 校验、重试、落库逻辑一行都不用改。
 *
 * 为什么放在类外：它只需要「一个 LlmPort + 一段 messages」，不需要服务的任何
 * 私有状态。做成纯函数就能直接喂 `ScriptedLlm` 单测，不必起 Nest 容器。
 *
 * 注意故意**不传 schema**：流式下一旦要求 json mode，上游会把整个 JSON
 * 压成一行吐，反倒不利于增量解析；结构化交给收尾时的 `tryParse`。
 */
export async function completeStreamingWith(
  llm: LlmPort,
  messages: LlmMessage[],
  hooks: TurnStreamHooks,
): Promise<LlmResult> {
  let raw = '';
  const state = initialVisibleState();
  const iterator = llm.stream({ messages, temperature: 0.4 });
  let step = await iterator.next();
  while (!step.done) {
    raw += step.value.text;
    const delta = takeVisibleDelta(raw, state);
    if (delta) hooks.onToken?.(delta);
    step = await iterator.next();
  }
  const final = step.value.final;
  // 与 complete() 对齐：schema 缺失时 parsed 交给调用方 tryParse 原始文本
  return { ...final, parsed: final.parsed ?? tryParseLoose(raw) };
}

/** 与 turn.service 里的 tryParse 同口径：先剥代码围栏，再 JSON.parse */
function tryParseLoose(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}
