/**
 * video 契约/控制器的最小验证：Range 解析。
 *
 * 不连数据库：这个套件守的是「纯逻辑与形状」，DB 语义在集成测试里验。
 *
 * ## 为什么 Range 解析要单测
 *
 * `<video>` 拖进度条时会发 `Range: bytes=<start>-`。解析错了有两种后果：返回
 * 整个文件（能播但拖不动，用户以为卡了），或 416（Safari 直接拒绝播放）。
 * 两种都不会在「点开能看」的冒烟测试里暴露，只有拖进度条才发现。
 */
import { describe, expect, it } from 'vitest';
import { parseRange } from './video.controller.js';

describe('parseRange', () => {
  it('解析 `bytes=0-` 为整个文件', () => {
    expect(parseRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('解析显式区间', () => {
    expect(parseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 });
  });

  it('右端点超出文件大小时夹到末尾', () => {
    // 浏览器有时会发超过文件长度的 end（它按预估大小算）
    expect(parseRange('bytes=900-99999', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('解析后缀区间 `bytes=-500`（最后 500 字节）', () => {
    expect(parseRange('bytes=-500', 1000)).toEqual({ start: 500, end: 999 });
  });

  it('后缀比文件大时从 0 开始', () => {
    expect(parseRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('起点越界返回 null（应回 416）', () => {
    expect(parseRange('bytes=1000-', 1000)).toBeNull();
  });

  it('起点大于终点返回 null', () => {
    expect(parseRange('bytes=500-100', 1000)).toBeNull();
  });

  it('多区间返回 null（不实现 multipart/byteranges）', () => {
    expect(parseRange('bytes=0-1,5-6', 1000)).toBeNull();
  });

  it('不认识的单位返回 null', () => {
    expect(parseRange('items=0-100', 1000)).toBeNull();
  });

  it('空区间返回 null', () => {
    expect(parseRange('bytes=-', 1000)).toBeNull();
  });
});
