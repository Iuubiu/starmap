import { describe, expect, it } from 'vitest';
import { containsNul } from './nul-byte.guard.js';

/**
 * 只测纯函数部分。整条链路的验证在 `nul-byte.e2e.test.ts`（需要真启 AppModule
 * 才有 Guard 执行环境），这里守的是「什么算含 NUL」这个判据本身。
 */
describe('containsNul', () => {
  it('普通字符串不含 NUL', () => {
    expect(containsNul('kp-bool')).toBe(false);
    expect(containsNul('')).toBe(false);
  });

  it('字符串里的 U+0000 命中', () => {
    expect(containsNul('kp\u0000bool')).toBe(true);
    expect(containsNul('\u0000')).toBe(true);
  });

  it('数组元素里的 NUL 命中（microKpIds 是数组）', () => {
    expect(containsNul(['kp-a', 'kp\u0000b'])).toBe(true);
    expect(containsNul(['kp-a', 'kp-b'])).toBe(false);
  });

  it('嵌套对象里的 NUL 命中', () => {
    expect(containsNul({ items: [{ answer: 'a\u0000' }] })).toBe(true);
    expect(containsNul({ items: [{ answer: 'a' }] })).toBe(false);
  });

  it('undefined / null / 数字 / 布尔不命中且不抛', () => {
    expect(containsNul(undefined)).toBe(false);
    expect(containsNul(null)).toBe(false);
    expect(containsNul(42)).toBe(false);
    expect(containsNul(true)).toBe(false);
  });

  it('非普通对象不递归（避免枚举 Buffer/Date 的内部结构）', () => {
    // Date 没有自有可枚举属性，但更重要的是不该把任意对象当容器爬
    expect(containsNul(new Date())).toBe(false);
    expect(containsNul(Buffer.from('a\u0000b'))).toBe(false);
  });

  it('环状对象不会无限递归', () => {
    const cyclic: Record<string, unknown> = { a: 'ok' };
    cyclic.self = cyclic;
    expect(() => containsNul(cyclic)).not.toThrow();
    expect(containsNul(cyclic)).toBe(false);
  });

  it('超过深度上限的 NUL 不命中（上限的存在是为了不让恶意 body 拖死守卫）', () => {
    let deep: unknown = 'a\u0000b';
    for (let i = 0; i < 10; i += 1) deep = { nested: deep };
    expect(containsNul(deep)).toBe(false);
  });
});
