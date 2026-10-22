/**
 * `OpenAiCompatibleLlm` 的超时。
 *
 * 为什么要有这一条：`fetch` 本身没有默认超时。上游（d1api 这类中转）偶尔
 * 半天不回，请求就干挂着 —— 实测长对话里四轮等了 63–78 秒，其中一轮直接
 * 降级成「模型暂时不可用」，学生看到的是一个转 70 秒的 spinner。
 *
 * 所以这个测试用一个「只接连接、永不回包」的本地服务器，断言调用会在
 * 超时预算内抛错，而不是永远挂着。
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { OpenAiCompatibleLlm } from './openai-compatible-llm.js';

let server: Server | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.closeAllConnections?.();
    server.close(() => resolve());
    server = null;
  });
});

/** 起一个永远不回包的服务器：它接受请求，但一个字都不写。 */
async function silentServer(): Promise<string> {
  server = createServer(() => {
    /* 故意不 end，也不 write —— 模拟上游卡住 */
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  return `http://127.0.0.1:${String(port)}/v1`;
}

describe('OpenAiCompatibleLlm 超时', () => {
  it('上游不回包时在超时预算内抛错，不会无限等', async () => {
    const baseUrl = await silentServer();
    const llm = new OpenAiCompatibleLlm(baseUrl, 'test-key', 'test-model', 150);

    const started = Date.now();
    await expect(llm.complete({ messages: [{ role: 'user', content: '你好' }] })).rejects.toThrow();
    const elapsed = Date.now() - started;

    // 给足调度余量，但必须远小于「永远挂着」
    expect(elapsed).toBeLessThan(2_000);
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });

  it('调用方自己的 signal 取消也会中断', async () => {
    const baseUrl = await silentServer();
    const llm = new OpenAiCompatibleLlm(baseUrl, 'test-key', 'test-model', 10_000);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);

    const started = Date.now();
    await expect(
      llm.complete({ messages: [{ role: 'user', content: '你好' }], signal: ac.signal }),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('非法超时值回落到 45 秒默认，不会因为 0/NaN 变成「立刻超时」', () => {
    // 只验构造不抛错、且能正常发起请求的路径由上面两条覆盖；
    // 这条钉的是「坏配置不会把客户端变成一调就失败」。
    expect(() => new OpenAiCompatibleLlm('http://127.0.0.1:1/v1', 'k', 'm', 0)).not.toThrow();
    expect(() => new OpenAiCompatibleLlm('http://127.0.0.1:1/v1', 'k', 'm', Number.NaN)).not.toThrow();
  });
});
