/**
 * 展示时区边界（「用户看见的今天」）的单元测试。
 *
 * 这组用例钉的是本缺陷的**核心区分**：同一个绝对时刻，在 Asia/Shanghai 与
 * UTC 下属于不同的「天」。修复前 `dayStart()` 无视配置一律用 UTC 日界，于是
 * 上海凌晨 0–8 点这 8 小时里，看板把昨天下午的作答算进今天。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISPLAY_TIMEZONE,
  DISPLAY_TIMEZONE_ENV,
  resolveDisplayTimezone,
  startOfDisplayDay,
} from './display-timezone.js';

describe('展示时区边界', () => {
  it('默认是 Asia/Shanghai，未配置时也用这个值', () => {
    expect(DEFAULT_DISPLAY_TIMEZONE).toBe('Asia/Shanghai');
    expect(resolveDisplayTimezone(undefined)).toBe('Asia/Shanghai');
    expect(resolveDisplayTimezone('')).toBe('Asia/Shanghai');
    expect(resolveDisplayTimezone('   ')).toBe('Asia/Shanghai');
  });

  it('配置项优先于默认值，且不读连接会话（纯配置驱动）', () => {
    expect(resolveDisplayTimezone('UTC')).toBe('UTC');
    expect(resolveDisplayTimezone(' Europe/Berlin ')).toBe('Europe/Berlin');
  });

  it('非法时区抛错而不是静默回落到 UTC', () => {
    // 静默回落会让「今天」重新变成错的，且毫无迹象 —— 配置错了就要说配置错了。
    expect(() => resolveDisplayTimezone('Asia/Shangai')).toThrow(/不是合法的 IANA 时区/);
    expect(() => resolveDisplayTimezone('Asia/Shangai')).toThrow(new RegExp(DISPLAY_TIMEZONE_ENV));
  });

  it('上海本地零点 = 前一天 16:00Z（不是 UTC 零点）', () => {
    // 2026-10-22 04:17 +08 = 2026-10-21T20:17Z，本地「今天」是 10-22，
    // 它的零点在 UTC 里是 10-21T16:00Z。
    expect(startOfDisplayDay('2026-10-21T20:17:00.000Z', 'Asia/Shanghai')).toBe(
      '2026-10-21T16:00:00.000Z',
    );
  });

  it('同一时刻在上海与 UTC 下属于不同的「天」（这就是本缺陷）', () => {
    const at = '2026-10-21T20:17:00.000Z';
    const shanghai = startOfDisplayDay(at, 'Asia/Shanghai');
    const utc = startOfDisplayDay(at, 'UTC');
    expect(shanghai).toBe('2026-10-21T16:00:00.000Z');
    expect(utc).toBe('2026-10-21T00:00:00.000Z');
    // 上海日界比 UTC 日界晚 16 小时，两者必须能区分开。
    expect(Date.parse(shanghai) - Date.parse(utc)).toBe(16 * 3_600_000);
  });

  it('UTC 时区下退化为 UTC 日界（换配置不改代码）', () => {
    expect(startOfDisplayDay('2026-10-21T00:00:00.000Z', 'UTC')).toBe('2026-10-21T00:00:00.000Z');
    expect(startOfDisplayDay('2026-10-21T23:59:59.999Z', 'UTC')).toBe('2026-10-21T00:00:00.000Z');
  });

  it('本地零点整与前一毫秒分属两天', () => {
    // 上海 10-22 00:00:00 = 10-21T16:00Z
    expect(startOfDisplayDay('2026-10-21T16:00:00.000Z', 'Asia/Shanghai')).toBe(
      '2026-10-21T16:00:00.000Z',
    );
    expect(startOfDisplayDay('2026-10-21T15:59:59.999Z', 'Asia/Shanghai')).toBe(
      '2026-10-20T16:00:00.000Z',
    );
  });

  it('夏令时切换日仍算出正确的本地零点（Europe/Berlin）', () => {
    // 2026-03-29 是欧洲夏令时开始日：本地 02:00 跳到 03:00，当天只有 23 小时。
    // 3-29 本地零点 = 3-28T23:00Z（CET=+1）；3-30 本地零点 = 3-29T22:00Z（CEST=+2）。
    expect(startOfDisplayDay('2026-03-29T12:00:00.000Z', 'Europe/Berlin')).toBe(
      '2026-03-28T23:00:00.000Z',
    );
    expect(startOfDisplayDay('2026-03-30T12:00:00.000Z', 'Europe/Berlin')).toBe(
      '2026-03-29T22:00:00.000Z',
    );
  });

  it('负偏移时区（America/New_York）同样正确', () => {
    // 2026-10-22 12:00Z = 本地 08:00（EDT=UTC-4），本地零点 = 10-22T04:00Z。
    expect(startOfDisplayDay('2026-10-22T12:00:00.000Z', 'America/New_York')).toBe(
      '2026-10-22T04:00:00.000Z',
    );
  });

  it('坏时间戳抛错而不是猜一个值', () => {
    expect(() => startOfDisplayDay('昨天')).toThrow(/不是合法的时刻/);
  });
});
