import { describe, expect, it, vi, afterEach } from 'vitest';
import { OpenAiCompatibleLlm } from './openai-compatible-llm.js';

/**
 * 流式解析的单测。
 *
 * 为什么值得单独测：`stream()` 里三处容易错的地方（分片不等于行、`[DONE]` 结束、
 * `final` 与 `complete()` 同形）在真实上游上只会偶发暴露——网络刚好把
 * `data: {...}` 切在中间时才会吞字。等到线上偶发丢字再查，成本高得多。
 * 这里用三段**故意切在行中间**的字节流把它钉死。
 */

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function delta(content?: string, reasoning?: string, model?: string): string {
  const d: Record<string, unknown> = {};
  if (content !== undefined) d.content = content;
  if (reasoning !== undefined) d.reasoning_content = reasoning;
  return `data: ${JSON.stringify({ model, choices: [{ delta: d }] })}\n\n`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAiCompatibleLlm.stream', () => {
  it('把分片跨行切开也能拼回完整文本，并返回与 complete() 同形的 final', async () => {
    const model = 'deepseek-v4.1-flash';
    const body = [
      delta('布尔', undefined, model),
      delta('代数的'),
      delta('吸收律'),
      'data: [DONE]\n\n',
    ].join('');

    // 关键：在第 17 个字符处切开，正好落在 `data: {...}` 的中间
    const pieces = [body.slice(0, 17), body.slice(17, 41), body.slice(41)];
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(pieces)));

    const llm = new OpenAiCompatibleLlm('https://example.test/v1', 'k', model);
    const deltas: string[] = [];
    const it = llm.stream({ messages: [{ role: 'user', content: '讲一下吸收律' }] });
    let step = await it.next();
    while (!step.done) {
      deltas.push(step.value.text);
      step = await it.next();
    }

    expect(deltas.join('')).toBe('布尔代数的吸收律');
    const final = step.value.final;
    expect(final.text).toBe('布尔代数的吸收律');
    expect(final.model).toBe(model);
    expect(typeof final.latencyMs).toBe('number');
    // 与 complete() 一致：没有 schema 时 parsed 必须是 null（不是 undefined）
    expect(final.parsed).toBeNull();
    // 三个 delta 一片不少
    expect(deltas.length).toBe(3);
  });

  it('reasoning_content 只进 final，不作为可见 token 吐出', async () => {
    const body = [
      delta(undefined, '先想一下'),
      delta('结论是 1'),
      'data: [DONE]\n\n',
    ].join('');
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([body])));

    const llm = new OpenAiCompatibleLlm('https://example.test/v1', 'k', 'm');
    const it = llm.stream({ messages: [{ role: 'user', content: 'x' }] });
    const visible: string[] = [];
    let step = await it.next();
    while (!step.done) {
      visible.push(step.value.text);
      step = await it.next();
    }

    expect(visible.join('')).toBe('结论是 1');
    expect(step.value.final.reasoning).toBe('先想一下');
  });

  it('没有 [DONE] 时按流结束收尾，不抛错也不丢已收到的文本', async () => {
    const body = delta('只有半段');
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([body])));

    const llm = new OpenAiCompatibleLlm('https://example.test/v1', 'k', 'm');
    const it = llm.stream({ messages: [{ role: 'user', content: 'x' }] });
    const out: string[] = [];
    let step = await it.next();
    while (!step.done) {
      out.push(step.value.text);
      step = await it.next();
    }
    expect(out.join('')).toBe('只有半段');
  });

  it('非 2xx 抛出带状态码的错误（与 complete() 的错误口径一致）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream boom', { status: 503 })),
    );
    const llm = new OpenAiCompatibleLlm('https://example.test/v1', 'k', 'm');
    const it = llm.stream({ messages: [{ role: 'user', content: 'x' }] });
    await expect(it.next()).rejects.toThrow(/503/);
  });
});
