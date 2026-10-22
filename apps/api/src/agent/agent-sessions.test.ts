import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../db/database.service.js';
import { ScriptedLlm } from '../llm/scripted-llm.js';
import { LLM_PORT } from '../llm/llm.port.js';
import { createTestSchema, type TestSchema } from '../../test/test-schema.js';
import { assertMatchesContract } from '../../test/contract.js';
import { SUMMARY_MAX_CHARS, summarizeUtterance } from './turn.service.js';

/**
 * 票 76「学习记录」的会话列表：`GET /api/v1/agent/sessions`。
 *
 * ## 这里钉住三件容易错的事
 *
 * 1. **排序按最近活动**。按 `session_id` 或按创建时间排，都会让「昨天聊到
 *    一半、今天接着聊」的会话沉下去 —— 学生找的永远是「我最近那次」。
 * 2. **首句取 `ordinal` 最小那一轮，不是 `created_at` 最早那一轮**。两者在
 *    正常路径上一致，但重试/回填会让时间戳乱序；`ordinal` 才是「第几句」的
 *    权威。这一条只能靠**故意造乱序数据**测出来。
 * 3. **空库返回 `{sessions: []}`**，不是 404。没有会话是合法状态。
 *
 * 另外用 `assertMatchesContract` 校验响应真的符合契约 —— 手写 DTO 容易漏字段。
 */

let app: INestApplication;
let schema: TestSchema;
let db: DatabaseService;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LLM_PORT)
    .useValue(new ScriptedLlm([{ text: '{"visibleResponse":"假的","cardKind":"graph_focus"}' }]))
    .compile();
  app = moduleRef.createNestApplication();
  db = app.get(DatabaseService);
  schema = await createTestSchema();
  await db.useSchema(schema.name);
  await app.init();
}, 120_000);

afterAll(async () => {
  await app.close();
  await schema.drop();
});

let seq = 0;

/** 直接写 `agent_turns`：这些用例不关心模型，只关心读列表的 SQL。 */
async function insertTurn(input: {
  sessionId: string;
  ordinal: number;
  utterance: string;
  createdAt: string;
}): Promise<void> {
  seq += 1;
  await db.query('INSERT INTO sessions (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [
    input.sessionId,
  ]);
  await db.query(
    `INSERT INTO agent_turns
       (id, session_id, ordinal, utterance, visible_response, visible_response_kind,
        artifact_kind, card_title, created_at)
     VALUES ($1, $2, $3, $4, $5, 'statement', 'graph_focus', $6, $7)`,
    [
      `t-${String(seq)}`,
      input.sessionId,
      input.ordinal,
      input.utterance,
      '假的回复',
      '图谱',
      input.createdAt,
    ],
  );
}

async function list(limit?: number): Promise<Record<string, unknown>> {
  const res = await request(app.getHttpServer())
    .get('/api/v1/agent/sessions')
    .query(limit === undefined ? {} : { limit: String(limit) });
  expect(res.status).toBe(200);
  assertMatchesContract('/api/v1/agent/sessions', 'get', 200, res.body);
  return res.body as Record<string, unknown>;
}

describe('会话列表', () => {
  it('按最近活动倒序，空库返回空数组而不是 404', async () => {
    const empty = await list();
    expect(empty).toEqual({ sessions: [] });

    await insertTurn({
      sessionId: 'ses-old',
      ordinal: 1,
      utterance: '早一点的会话',
      createdAt: '2026-10-01T08:00:00.000Z',
    });
    await insertTurn({
      sessionId: 'ses-new',
      ordinal: 1,
      utterance: '最近的会话',
      createdAt: '2026-10-20T09:00:00.000Z',
    });
    // 旧会话今天又聊了一轮 → 它应该排到前面。
    await insertTurn({
      sessionId: 'ses-old',
      ordinal: 2,
      utterance: '今天接着聊',
      createdAt: '2026-10-21T10:00:00.000Z',
    });

    const body = await list();
    const sessions = body.sessions as { sessionId: string; lastActivityAt: string }[];
    expect(sessions.map((s) => s.sessionId)).toEqual(['ses-old', 'ses-new']);

    const limited = await list(1);
    expect((limited.sessions as unknown[]).length).toBe(1);
  });

  it('首句取 ordinal 最小那轮，而不是 created_at 最早那轮', async () => {
    // 第 1 轮的时间戳故意比第 2 轮晚 —— 模拟「重试/回填导致时间乱序」。
    await insertTurn({
      sessionId: 'ses-shuffled',
      ordinal: 1,
      utterance: '真正的第一句（ordinal=1）',
      createdAt: '2026-10-22T12:00:00.000Z',
    });
    await insertTurn({
      sessionId: 'ses-shuffled',
      ordinal: 2,
      utterance: '第二句，但时间更早',
      createdAt: '2026-10-22T11:00:00.000Z',
    });

    const body = await list();
    const sessions = body.sessions as { sessionId: string; firstUtterance: string; turnCount: number }[];
    const target = sessions.find((s) => s.sessionId === 'ses-shuffled');
    expect(target?.firstUtterance).toBe('真正的第一句（ordinal=1）');
    expect(target?.turnCount).toBe(2);
  });

  it('首句摘要超过 60 个字符时截断并补省略号', () => {
    expect(summarizeUtterance('短句')).toBe('短句');
    const long = '啊'.repeat(SUMMARY_MAX_CHARS + 5);
    expect(Array.from(summarizeUtterance(long)).length).toBe(SUMMARY_MAX_CHARS + 1);
    expect(summarizeUtterance(long).endsWith('…')).toBe(true);
    // 换行/连续空白压成单空格，避免列表里出现一条高矮不一的摘要。
    expect(summarizeUtterance('第一行\n\n第二行')).toBe('第一行 第二行');
    // emoji 按码点算，不会被劈成两半。
    const emoji = '🙂'.repeat(SUMMARY_MAX_CHARS + 1);
    expect(Array.from(summarizeUtterance(emoji)).every((ch) => ch !== '\uFFFD')).toBe(true);
  });
});
