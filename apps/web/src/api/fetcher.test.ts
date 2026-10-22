import { afterEach, describe, expect, it, vi } from 'vitest';
import { customFetch, mergeHeaders } from './fetcher';

/**
 * 这些测试守的是一个**在单测里看不出来、只有在真实浏览器 + 真实后端才爆**的缺陷。
 *
 * 2026-10-21 的实测（Playwright + 真 Vite 代理 + 真 Nest）：
 *
 * | 请求头 | 后端 |
 * | --- | --- |
 * | `{ 'content-type', 'Content-Type' }` 两个键 | **400** `expected object, received undefined` |
 * | 只有任一个（大小写都行） | 200 |
 * | 完全没有 Content-Type | 400 |
 *
 * 原因：对象字面量的键区分大小写，两个键在 `fetch` 里被归一化成同一个头，
 * 值拼成 `application/json, application/json`；Express body-parser 按 media type
 * 精确匹配，匹配不上就**静默跳过解析**，`req.body` 变成 undefined。
 *
 * 所以这里的断言不是「头里包含 application/json」（那样 `'application/json,
 * application/json'` 也能过），而是**逐字相等**。
 *
 * 注意这些用例刻意用 `vi.stubGlobal('fetch')` 截获，而不是交给 MSW：MSW 在 fetch
 * 层之下拦截，恰恰看不见「fetch 把两个键合并成什么」——这正是当初漏掉的原因。
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const captureFetch = () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
};

const contentTypeOf = (init: RequestInit): string | null =>
  new Headers(init.headers).get('content-type');

describe('请求头合并', () => {
  it('Orval 自带 Content-Type 时，最终只有一个值，不会被拼成两份', () => {
    // Orval 生成的写操作长这样：headers: { 'Content-Type': 'application/json' }
    const merged = mergeHeaders({ 'Content-Type': 'application/json' });

    expect(merged.get('content-type')).toBe('application/json');
    // 上面这句靠 Headers 大小写不敏感就能过；真正要守的是「没有第二个值」。
    expect(merged.get('content-type')?.split(',').length).toBe(1);
  });

  it('调用方没给头时补上 application/json', () => {
    expect(mergeHeaders(undefined).get('content-type')).toBe('application/json');
  });

  it('调用方给了其它头时原样保留', () => {
    const merged = mergeHeaders({ 'X-Trace-Id': 'abc', Accept: 'application/json' });
    expect(merged.get('x-trace-id')).toBe('abc');
    expect(merged.get('accept')).toBe('application/json');
    expect(merged.get('content-type')).toBe('application/json');
  });

  it('调用方显式指定别的 media type 时不被覆盖', () => {
    // 万一将来有上传端点：不能强行改回 JSON
    const merged = mergeHeaders({ 'content-type': 'application/octet-stream' });
    expect(merged.get('content-type')).toBe('application/octet-stream');
  });
});

describe('customFetch 发给 fetch 的头', () => {
  it('写操作的真实 content-type 逐字等于 application/json', async () => {
    const calls = captureFetch();

    // 复刻 Orval 生成的 toggleSkill / createAgentTurn 的调用形状
    await customFetch('/api/v1/agent/skills/x', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    expect(calls).toHaveLength(1);
    expect(contentTypeOf(calls[0]!.init)).toBe('application/json');
  });

  it('请求体原样带过去，没有被吞掉', async () => {
    const calls = captureFetch();

    await customFetch('/api/v1/agent/turns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1', utterance: '你好' }),
    });

    expect(calls[0]!.init.body).toBe(JSON.stringify({ sessionId: 's1', utterance: '你好' }));
  });

  it('GET 也带 content-type，不影响读取', async () => {
    const calls = captureFetch();
    await customFetch('/api/v1/agent/skills');
    expect(contentTypeOf(calls[0]!.init)).toBe('application/json');
  });
});
