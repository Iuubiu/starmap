import type { LlmCompleteOptions, LlmDelta, LlmPort, LlmResult, LlmStreamResult } from './llm.port.js';

export interface ScriptedReply {
  /** 精确匹配用户最后一条消息；不匹配时用 fallback */
  whenUserSays?: string;
  text: string;
  /** 模拟超时：抛错而不是返回 */
  timeoutMs?: number;
  /** 模拟 5xx */
  fail?: boolean;
}

/**
 * 脚本化假模型（测试接缝 2 的默认实现）。
 * 测试里不许打真实模型——这是「零费用测试」的执行点。
 */
export class ScriptedLlm implements LlmPort {
  readonly id = 'scripted';
  public readonly calls: LlmCompleteOptions[] = [];

  constructor(private readonly replies: ScriptedReply[] = []) {}

  async complete(options: LlmCompleteOptions): Promise<LlmResult> {
    this.calls.push(options);
    const lastUser = [...options.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const hit =
      this.replies.find((r) => r.whenUserSays !== undefined && lastUser.includes(r.whenUserSays)) ??
      this.replies.find((r) => r.whenUserSays === undefined);

    if (!hit) throw new Error(`脚本化假模型没有匹配的回复: ${lastUser.slice(0, 80)}`);
    if (hit.fail) throw new Error('上游不可用（脚本模拟）');
    if (hit.timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, hit.timeoutMs));
      throw new Error('超时（脚本模拟）');
    }

    return { text: hit.text, parsed: options.schema ? tryParse(hit.text) : null };
  }

  /**
   * 逐字流的假实现：把同一段文本按固定宽度切片吐出。
   *
   * 为什么要 `await Promise.resolve()`：不加的话整个流会在一个微任务里跑完，
   * 前端根本观察不到「逐字」，那流式路径的测试就等于没测。
   * 切片宽度取 7 是随手定的：既不是 1（碎片太多、断言噪音大），
   * 也不至于把整段一口吐完。
   */
  async *stream(options: LlmCompleteOptions): AsyncGenerator<LlmDelta, LlmStreamResult> {
    const result = await this.complete(options);
    const size = 7;
    for (let i = 0; i < result.text.length; i += size) {
      await Promise.resolve();
      yield { text: result.text.slice(i, i + size) };
    }
    return { final: result };
  }
}

function tryParse(text: string): unknown {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text.trim());
  try {
    return JSON.parse(fenced?.[1] ?? text);
  } catch {
    return null;
  }
}
