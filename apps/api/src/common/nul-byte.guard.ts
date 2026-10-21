import { type CanActivate, type ExecutionContext, BadRequestException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/**
 * 拒绝含 NUL 字节（U+0000）的请求参数。
 *
 * ## 为什么需要这一层
 *
 * PostgreSQL 的文本协议不接受 0x00：驱动会抛
 * `DatabaseError: invalid byte sequence for encoding "UTF8": 0x00`。
 * 而 Express 会把 URL 里的 `%00` 原样解码进 `req.params`，于是**任何**把
 * 路径参数当 SQL 参数传下去的端点都会 500 —— 前端看到的是「服务器内部错误」，
 * 但实际原因是客户端发了一个本来就不存在的 id。
 *
 * 实测（2026-10-21，六个端点全部 500）：
 * `/api/v1/levels/lv-bool%00laws`、`/api/v1/nodes/kp-bool%00x`、
 * `/api/v1/mastery/kp-bool%00x`、`/api/v1/levels/lv-ai-x%00/video-clips`、
 * `/api/v1/review/rounds/nope%00`、`/media/clips/BV1VE411e7UP_p9-c01%00.mp4`。
 * 逐个端点加校验会在下一次新增端点时漏掉，所以放在这里 —— 这是所有路由
 * 都必经、且早于任何 DB 调用的唯一位置。
 *
 * ## 为什么是 400 而不是 404
 *
 * `%00` 不是「这个 id 不存在」，是「这个 id 不可能是合法 id」。任何合法
 * 的 clipId / microKpId 都是 `[a-z0-9-]`，不可能含 NUL。返回 404 会让
 * 调用方去检查数据是否存在，而它该检查的是自己如何构造出这个字符串。
 *
 * ## 为什么同时检查 body
 *
 * 同一个 NUL 也能从 JSON body 进来（`{"microKpIds":["a\u0000b"]}`），
 * 走的是完全相同的故障路径。只查 URL 会留下一个更容易触发的入口。
 */
@Injectable()
export class NulByteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const sources: Array<[string, unknown]> = [
      ['路径参数', req.params],
      ['查询字符串', req.query],
      ['请求体', req.body],
    ];
    for (const [label, value] of sources) {
      if (containsNul(value)) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: `请求参数包含非法字符（NUL 字节）：${label}`,
        });
      }
    }
    return true;
  }
}

/** 递归查找字符串里的 U+0000。深度上限防止环状 body 把守卫拖死。 */
export function containsNul(value: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (typeof value === 'string') return value.includes('\u0000');
  if (Array.isArray(value)) return value.some((v) => containsNul(v, depth + 1));
  // 只递归进**普通对象**：Buffer / Stream / Date 之类是请求体的实现细节，
  // 枚举它们的属性既没有意义，也可能把整个对象图拖进来。
  if (isPlainObject(value)) {
    return Object.values(value).some((v) => containsNul(v, depth + 1));
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
