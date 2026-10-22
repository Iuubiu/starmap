import type { LlmCompleteOptions, LlmPort, LlmResult } from './llm.port.js';

/**
 * 真实实现：走 OpenAI 兼容的 /chat/completions。
 *
 * 两个端点的实测事实（不是猜测）：
 * - `d1api.xin` 与 `api.deepseek.com` 都**没有 embedding 模型**；
 *   一次 `/embeddings` 返回 503 `model_not_found`，另一次 404。
 * - 结构化输出不可靠：JSON 模式下模型仍可能夹中文解释。
 *   所以 `parsed` 失败不抛错，交给调用方降级（spec OQ8）。
 */
export class OpenAiCompatibleLlm implements LlmPort {
  readonly id: string;

  /**
   * 单次调用的超时毫秒，默认值可以用 `LLM_TIMEOUT_MS` 改。
   *
   * 为什么需要它：`fetch` 没有任何默认超时，上游一旦半天不回（d1api 这种中转会
   * 这样），请求就干挂着。实测 12 轮长对话里四轮等了 63–78 秒，其中一轮直接
   * 降级成「模型暂时不可用」—— 学生看到的是一个转 70 秒的 spinner。
   *
   * 为什么是 45 秒：慢但成功的轮次落在 63–78 秒，设 45 秒会把它们也判失败。
   * 这里不追求「尽量成功」，而是「不再无限等」：超过 45 秒的等待对学习者
   * 已经不是延迟，是卡死。要更宽由部署方调环境变量，不在代码里拍得更长。
   */
  private readonly timeoutMs: number;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 45_000),
  ) {
    this.id = `openai-compatible:${model}`;
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 45_000;
  }

  async complete(options: LlmCompleteOptions): Promise<LlmResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.3,
    };
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    if (options.schema) body.response_format = { type: 'json_object' };

    // 两个信号都要生效：调用方给的（客户端断开、上层取消）与本地超时。
    // `AbortSignal.any` 在 Node 20+ 可用；任一触发都让 fetch 抛 AbortError。
    const signals = [AbortSignal.timeout(this.timeoutMs)];
    if (options.signal) signals.push(options.signal);

    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any(signals),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM 请求失败 ${res.status}: ${text.slice(0, 500)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const text = json.choices?.[0]?.message?.content ?? '';
    let parsed: unknown = null;
    if (options.schema) {
      parsed = safeJsonParse(text);
    }

    return {
      text,
      parsed,
      ...(json.usage
        ? {
            usage: {
              promptTokens: json.usage.prompt_tokens,
              completionTokens: json.usage.completion_tokens,
            },
          }
        : {}),
    };
  }
}

/** 模型常在 JSON 外包一层 ```；剥掉再解析，仍失败返回 null */
export function safeJsonParse(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}
