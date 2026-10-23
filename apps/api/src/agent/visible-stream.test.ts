import { describe, expect, it } from 'vitest';
import { initialVisibleState, takeVisibleDelta } from './visible-stream.js';

/**
 * `visibleResponse` 增量提取的测试。
 *
 * 这套测试的形状是**按真实 SSE 分片喂**：每一帧传「累积到现在的原始文本」，
 * 断言「这一帧新增的正文」。所以断言的粒度就是学生屏幕上看到的粒度——
 * 中途多吐一个字、少吐一个字都会被抓住，而不是等到最后拼一次才比。
 */

const RAW = '{"visibleResponse":"吸收律说的是 A+AB=A。","artifact":{"kind":"level_card"}}';

describe('takeVisibleDelta', () => {
  it('marker 还没到时不吐任何东西', () => {
    const state = initialVisibleState();
    expect(takeVisibleDelta('{"visib', state)).toBe('');
    expect(takeVisibleDelta('{"visibleResponse"', state)).toBe('');
    expect(takeVisibleDelta('{"visibleResponse":', state)).toBe('');
    expect(state.emitted).toBe('');
  });

  it('逐帧累加，每帧只吐新增部分，最终拼成完整可见正文', () => {
    const state = initialVisibleState();
    const frames: string[] = [];
    // 每 5 个字符一帧：故意不按 JSON 结构切
    for (let i = 5; i <= RAW.length; i += 5) {
      frames.push(takeVisibleDelta(RAW.slice(0, i), state));
    }
    frames.push(takeVisibleDelta(RAW, state));
    expect(frames.join('')).toBe('吸收律说的是 A+AB=A。');
    expect(state.emitted).toBe('吸收律说的是 A+AB=A。');
  });

  it('切在 \\u 转义中间时，不会把半截转义当正文吐出去', () => {
    const state = initialVisibleState();
    const raw = '{"visibleResponse":"第一\\u4e2d\\u6587"';
    // 切在 `\u4e` 之后（还没到四位）
    const partial = '{"visibleResponse":"第一\\u4e';
    expect(takeVisibleDelta(partial, state)).toBe('第一');
    // 补齐成完整转义后才出现「中」
    expect(takeVisibleDelta('{"visibleResponse":"第一\\u4e2d', state)).toBe('中');
    expect(takeVisibleDelta(raw, state)).toBe('文');
  });

  it('切在转义引号（\\"）中间时不会提前结束字符串', () => {
    const state = initialVisibleState();
    // 这一帧只收到「他说」加一个孤立反斜线：正文「他说」是确定的，该吐；
    // 反斜线本身含义未定，留到下一帧。提前把它当正文发出去，
    // 屏幕上就会多一个永远擦不掉的字符。
    expect(takeVisibleDelta('{"visibleResponse":"他说\\', state)).toBe('他说');
    // 第二帧补齐成 \" —— 这是一个**转义引号**，字符串还没结束；
     // 上一帧已吐出「他说」，所以本帧只新增那一个引号。
    expect(takeVisibleDelta('{"visibleResponse":"他说\\"', state)).toBe('"');
  });

  it('字符串结束后继续追加的 JSON 不会污染可见正文', () => {
    const state = initialVisibleState();
    takeVisibleDelta(RAW, state);
    const more = `${RAW},"tail":"这一句不该出现"}`;
    expect(takeVisibleDelta(more, state)).toBe('');
    expect(state.emitted).toBe('吸收律说的是 A+AB=A。');
  });

  it('转义换行按真实换行吐出（不是字面量的反斜线 n）', () => {
    const state = initialVisibleState();
    const delta = takeVisibleDelta('{"visibleResponse":"第一行\\n第二行"}', state);
    expect(delta).toBe('第一行\n第二行');
    expect(delta.includes('\\n')).toBe(false);
  });
});
