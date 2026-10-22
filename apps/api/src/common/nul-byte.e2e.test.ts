import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../db/database.service.js';
import { createTestSchema, type TestSchema } from '../../test/test-schema.js';

/**
 * NUL 字节守卫的接口级验证。
 *
 * ## 为什么必须有这一层测试
 *
 * 纯函数 `containsNul` 全绿只能证明「给它一个含 NUL 的字符串它认得出」，
 * 证不了守卫被装到了请求链路上。守卫是全局 `APP_GUARD`，一旦有人
 * 误删 `app.module.ts` 里那一行 provider，纯函数测试全绿而端点继续 500。
 *
 * ## 为什么断言的是 400 不是 404
 *
 * `%00` 不是「这个 id 不存在」，是「这个 id 不可能是合法 id」。返回 404 会让
 * 调用方去查数据，而它该查的是自己怎么把这个字符串造出来的。实测这六个端点
 * 在修之前**全部 500**（Postgres 拒绝 0x00，驱动抛 DatabaseError，被异常过滤器
 * 归到 INTERNAL），修复后全部 400。
 *
 * ## 反向验证（改代码时必须重跑）
 *
 * 删掉 `app.module.ts` 的 `{ provide: APP_GUARD, useClass: NulByteGuard }`
 * 之后本文件的用例必须全部变红。若仍然绿，说明守卫没被真正挂上。
 */

let app: INestApplication;
let schema: TestSchema;

beforeAll(async () => {
  schema = await createTestSchema();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  // 必须切到测试 schema：否则端点会去真实库查
  await app.get(DatabaseService).useSchema(schema.name);
  await app.init();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await schema?.drop();
});

describe('NUL 字节不会打穿到 Postgres', () => {
  /**
   * 六个真实端点。用 `%00` 而不是裸 `\u0000`：HTTP 层只传 URL，
   * 且这正是攻击面（Express 会把它解码进 `req.params`）。
   */
  const cases: Array<[string, string]> = [
    ['/api/v1/levels/lv-bool%00laws', '关卡详情'],
    ['/api/v1/nodes/kp-bool%00x', '知识点详情'],
    ['/api/v1/mastery/kp-bool%00x', '掌握度'],
    ['/api/v1/levels/lv-ai-x%00/video-clips', '关卡视频片段'],
    ['/api/v1/review/rounds/nope%00', '复验轮次'],
    ['/media/clips/BV1VE411e7UP_p9-c01%00.mp4', '媒体片段'],
  ];

  for (const [path, label] of cases) {
    it(`${label} ${path} 返回 400 而不是 500`, async () => {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.status).toBe(400);
      expect(res.status).not.toBe(500);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(String(res.body.message)).toContain('NUL');
    });
  }

  it('同一路径去掉 NUL 后不会因为守卫而失效（走正常业务分支）', async () => {
    // kp-bool 在 seed 里存在，去掉 NUL 后应该拿到 200 或业务 404，
    // 但绝不能是 400「含 NUL」—— 否则守卫把合法请求也拦了
    const res = await request(app.getHttpServer()).get('/api/v1/nodes/kp-bool');
    expect(res.status).not.toBe(400);
  });
});
