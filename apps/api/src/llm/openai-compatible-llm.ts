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

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {
    this.id = `openai-compatible:${model}`;
  }

  async complete(options: LlmCompleteOptions): Promise<LlmResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.3,
    };
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    if (options.schema) body.response_format = { type: 'json_object' };

    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
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
