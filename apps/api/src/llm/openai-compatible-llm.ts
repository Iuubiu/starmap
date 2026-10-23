import type { LlmCompleteOptions, LlmDelta, LlmPort, LlmResult, LlmStreamResult } from './llm.port.js';

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

  /**
   * 流式调用的**空闲**超时毫秒，`LLM_STREAM_IDLE_MS` 可改。
   *
   * 为什么不复用上面那个 45 秒：流式下「总时长」没有意义——一个正经的长回答
   * 可以吐 3 分钟，只要它一直在吐字就不该被打断。要看的是「多久没吐新东西」：
   * 30 秒没有任何 chunk 才认定上游死了。这两个数服务于不同的事实，
   * 混成一个会让长回答被从中间砍断（那比慢更糟：学生拿到半句话）。
   */
  private readonly streamIdleMs: number;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 45_000),
    streamIdleMs = Number(process.env.LLM_STREAM_IDLE_MS ?? 30_000),
  ) {
    this.id = `openai-compatible:${model}`;
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 45_000;
    this.streamIdleMs = Number.isFinite(streamIdleMs) && streamIdleMs > 0 ? streamIdleMs : 30_000;
  }

  private endpoint(): string {
    return `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
    };
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

    const t0 = Date.now();
    const res = await fetch(this.endpoint(), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.any(signals),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM 请求失败 ${res.status}: ${text.slice(0, 500)}`);
    }

    const json = (await res.json()) as CompletionJson;

    const text = json.choices?.[0]?.message?.content ?? '';
    const reasoning = json.choices?.[0]?.message?.reasoning_content;
    let parsed: unknown = null;
    if (options.schema) {
      parsed = safeJsonParse(text);
    }

    return {
      text,
      parsed,
      ...(json.model ? { model: json.model } : {}),
      latencyMs: Date.now() - t0,
      ...(reasoning ? { reasoning } : {}),
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

  /**
   * 逐字流。与 `complete()` 走同一个端点，只是 `stream: true`。
   *
   * 三个容易写错的地方，都在实测里踩过：
   *
   * 1. **超时必须是「空闲」而不是「总时长」**：见 `streamIdleMs` 的注释。
   *    这里用一个自建的 `AbortController`，每收到一个 chunk 就 `clearTimeout` +
   *    重新计时；调用方的 `options.signal` 也要并进去（客户端一断开就停，别继续烧钱）。
   *
   * 2. **网络分片不等于行边界**：`ReadableStream` 的 chunk 可能把一个 `data: {...}`
   *    从中间切开。所以用文本解码器累积到 `buffer`，按换行切，最后一段留在 buffer 里
   *    等下一片——丢掉它就会偶发地吞掉半个 token。
   *
   * 3. **`final` 必须与 `complete()` 同形**：调用方（`turn.service`）拿 `final` 去
   *    做 schema 校验、掌握度计算、落库，与走 `complete()` 的那条路完全一致。
   *    流式只多了一个「边收边吐」，不该在结果形状上分叉，否则两条路的差异
   *    会变成只有流式才出现的 bug。
   */
  async *stream(options: LlmCompleteOptions): AsyncGenerator<LlmDelta, LlmStreamResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.3,
      stream: true,
    };
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    // 注意：这里**不**设 response_format。实测 JSON 模式下上游仍可能吐中文解释，
    // 而流式下解析不完整 JSON 毫无意义——结构化的事留给 final 之后做。
    // 反过来说，走流式的调用点不该指望「边收边 parse」，这是已知限制，不是遗漏。

    const abort = new AbortController();
    const signals = [abort.signal];
    if (options.signal) signals.push(options.signal);

    let idleTimer: NodeJS.Timeout | undefined;
    const resetIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => abort.abort(), this.streamIdleMs);
    };

    const t0 = Date.now();
    let text = '';
    let reasoning = '';
    let model = this.model;
    let usage: LlmResult['usage'];
    let sawDone = false;

    try {
      resetIdle();
      const res = await fetch(this.endpoint(), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.any(signals),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`LLM 流式请求失败 ${res.status}: ${detail.slice(0, 500)}`);
      }
      if (!res.body) throw new Error('LLM 流式响应没有 body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdle();
        buffer += decoder.decode(value, { stream: true });

        // 按换行切；最后一段（可能不完整）留在 buffer 里等下一片。
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith('data:')) continue; // 注释行/心跳/空行
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') {
            sawDone = true;
            break;
          }
          const parsed = safeJsonParse(payload) as StreamChunk | null;
          if (!parsed) continue; // 半个 JSON 之类，跳过而不是崩
          if (parsed.model) model = parsed.model;
          if (parsed.usage) {
            usage = {
              promptTokens: parsed.usage.prompt_tokens,
              completionTokens: parsed.usage.completion_tokens,
            };
          }
          const delta = parsed.choices?.[0]?.delta;
          const piece = delta?.content;
          const think = delta?.reasoning_content;
          if (think) reasoning += think;
          if (piece) {
            text += piece;
            yield { text: piece };
          }
        }
        if (sawDone) break;
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
    }

    let parsedResult: unknown = null;
    if (options.schema) parsedResult = safeJsonParse(text);

    return {
      final: {
        text,
        parsed: parsedResult,
        model,
        latencyMs: Date.now() - t0,
        ...(reasoning ? { reasoning } : {}),
        ...(usage ? { usage } : {}),
      },
    };
  }
}

interface CompletionJson {
  model?: string;
  choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

interface StreamChunk {
  model?: string;
  choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
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
