import { describe, expect, it } from 'vitest';
import { AgentStreamEventSchema } from '@starmap/api-contract';

/**
 * 流式事件的契约测试。
 *
 * 为什么只测「形状」而不测具体内容：这四条事件是前后端唯一的通信协议，
 * 值可以变（阶段明细、token 文本），但**种类一旦飘移，前端就静默丢帧**。
 * 而静默丢帧在浏览器里没有报错、没有空白，只是「少了一句」——最难查的那种。
 */

describe('AgentStreamEventSchema', () => {
  it('stage 只接受四段之一', () => {
    for (const stage of ['skills', 'retrieval', 'decision', 'model'] as const) {
      expect(AgentStreamEventSchema.parse({ type: 'stage', stage, detail: '正在检索教材' })).toEqual({
        type: 'stage',
        stage,
        detail: '正在检索教材',
      });
    }
    expect(() =>
      AgentStreamEventSchema.parse({ type: 'stage', stage: 'thinking', detail: 'x' }),
    ).toThrow();
  });

  it('token 必须带 text（允许空串，但不能缺字段）', () => {
    expect(AgentStreamEventSchema.parse({ type: 'token', text: '' }).type).toBe('token');
    expect(() => AgentStreamEventSchema.parse({ type: 'token' })).toThrow();
  });

  it('done 携带的对象不受本 schema 约束，由 AgentTurnResponse 自己校验', () => {
    const parsed = AgentStreamEventSchema.parse({ type: 'done', response: { turnId: 't1' } });
    expect(parsed.type).toBe('done');
  });

  it('未知 type 被拒绝（而不是当作 done 放过去）', () => {
    expect(() => AgentStreamEventSchema.parse({ type: 'finish', text: 'x' })).toThrow();
  });
});
