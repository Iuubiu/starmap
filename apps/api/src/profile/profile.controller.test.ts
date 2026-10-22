import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../db/database.service.js';
import { ScriptedLlm } from '../llm/scripted-llm.js';
import { LLM_PORT } from '../llm/llm.port.js';
import { createTestSchema, type TestSchema } from '../../test/test-schema.js';
import { assertMatchesContract } from '../../test/contract.js';

/**
 * 票 78：学习者画像的接口级验收。
 *
 * ## 为什么每条用例都验契约
 *
 * 画像只有 GET/PATCH 两条路由，而它的形状很容易被「顺手多返回一个字段」
 * 改坏 —— 比如把 `answeredCount` 改成 `answered`，前端拿到 undefined 后
 * 显示「已填 0/6」，测试却全绿。`assertMatchesContract` 读的是
 * `openapi.yaml`，改契约不跑 `contract:gen` 会当场红。
 *
 * ## 这一票最容易做假的地方
 *
 * 1. **跳过的字段被默认值填上**。`{ "goal": null }` 必须原样写进 jsonb，
 *    读回来仍是 null。只断言「接口 200」的话，一个把 null 过滤掉的实现照样绿。
 * 2. **改一个字段顺手覆盖其它字段**。PATCH 是合并语义，断言的是其它字段原值
 *    不变 —— 这一条能挡住「先读、改一个、整份写回」在并发下的丢更新。
 * 3. **每次写入插一行**。单行表靠主键约束兜底；这里数行数，证明 upsert 生效。
 * 4. **没写过却报了 `updatedAt`**。空画像时 `updatedAt` 必须是 null，
 *    否则前端无法区分「没问过」与「刚问过但全跳过了」。
 */

let app: INestApplication;
let schema: TestSchema;
let db: DatabaseService;

beforeAll(async () => {
  schema = await createTestSchema();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LLM_PORT)
    .useValue(new ScriptedLlm([{ text: '假模型' }]))
    .compile();

  app = moduleRef.createNestApplication();
  db = app.get(DatabaseService);
  await db.useSchema(schema.name);
  await app.init();
});

afterAll(async () => {
  await app.close();
  await schema.drop();
});

beforeEach(async () => {
  await db.query('DELETE FROM learner_profile');
});

interface ProfileBody {
  profile: Record<string, unknown>;
  updatedAt: string | null;
  answeredCount: number;
}

describe('GET /api/v1/profile', () => {
  it('从没填过时返回全 null 的画像，updatedAt 是 null（不是「现在」）', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/profile').expect(200);
    const body = res.body as ProfileBody;

    expect(body.profile).toEqual({
      background: null,
      mathLevel: null,
      goal: null,
      weeklyHours: null,
      explanationDensity: null,
      priorCourses: null,
    });
    expect(body.updatedAt).toBeNull();
    expect(body.answeredCount).toBe(0);
    assertMatchesContract('/api/v1/profile', 'get', 200, body);
  });
});

describe('PATCH /api/v1/profile', () => {
  it('只提交一个字段：只改它，其它字段仍是 null', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/profile')
      .send({ background: 'graduate' })
      .expect(200);
    const body = res.body as ProfileBody;

    expect(body.profile.background).toBe('graduate');
    expect(body.profile.goal).toBeNull();
    expect(body.answeredCount).toBe(1);
    expect(body.updatedAt).not.toBeNull();
    assertMatchesContract('/api/v1/profile', 'patch', 200, body);

    const read = (await request(app.getHttpServer()).get('/api/v1/profile').expect(200))
      .body as ProfileBody;
    expect(read.profile).toEqual(body.profile);
    expect(read.updatedAt).toBe(body.updatedAt);
  });

  it('合并语义：改一个字段不会覆盖另一个字段', async () => {
    const server = app.getHttpServer();
    await request(server).patch('/api/v1/profile').send({ goal: 'exam' }).expect(200);
    await request(server).patch('/api/v1/profile').send({ weeklyHours: 8 }).expect(200);
    const body = (
      await request(server).patch('/api/v1/profile').send({ background: 'working' }).expect(200)
    ).body as ProfileBody;

    expect(body.profile).toMatchObject({ goal: 'exam', weeklyHours: 8, background: 'working' });
    expect(body.answeredCount).toBe(3);
  });

  it('跳过写 null：先答后跳过，字段变回 null 且其它字段不动', async () => {
    const server = app.getHttpServer();
    await request(server).patch('/api/v1/profile').send({ goal: 'research', weeklyHours: 4 }).expect(200);
    const body = (
      await request(server).patch('/api/v1/profile').send({ goal: null }).expect(200)
    ).body as ProfileBody;

    expect(body.profile.goal).toBeNull();
    expect(body.profile.weeklyHours).toBe(4);
    expect(body.answeredCount).toBe(1);
  });

  it('priorCourses 的「跳过」(null) 与「一门都没有」([]) 是两种值', async () => {
    const server = app.getHttpServer();
    await request(server).patch('/api/v1/profile').send({ priorCourses: [] }).expect(200);
    const empty = (await request(server).get('/api/v1/profile').expect(200)).body as ProfileBody;
    expect(empty.profile.priorCourses).toEqual([]);

    await request(server).patch('/api/v1/profile').send({ priorCourses: null }).expect(200);
    const skipped = (await request(server).get('/api/v1/profile').expect(200)).body as ProfileBody;
    expect(skipped.profile.priorCourses).toBeNull();
  });

  it('反复写入只有一行（单行表 + upsert）', async () => {
    const server = app.getHttpServer();
    for (const value of ['undergraduate', 'graduate', 'working']) {
      await request(server).patch('/api/v1/profile').send({ background: value }).expect(200);
    }
    const rows = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM learner_profile');
    expect(rows[0]!.count).toBe('1');
  });

  it('非法值被拒：400 且不落库', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/profile')
      .send({ background: 'professor' })
      .expect(400);
    expect((res.body as { code: string }).code).toBe('VALIDATION_FAILED');

    const rows = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM learner_profile');
    expect(rows[0]!.count).toBe('0');
  });

  it('空对象是合法的 no-op，不创建行也不报错', async () => {
    const body = (
      await request(app.getHttpServer()).patch('/api/v1/profile').send({}).expect(200)
    ).body as ProfileBody;
    expect(body.answeredCount).toBe(0);
    // 仍然是「没写过」，所以 updatedAt 保持 null。
    expect(body.updatedAt).toBeNull();
  });
});
