import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../db/database.service.js';
import { LLM_PORT, type LlmCompleteOptions, type LlmPort, type LlmResult } from '../llm/llm.port.js';
import { createTestSchema, type TestSchema } from '../../test/test-schema.js';

/**
 * 票 15 第 3 条验收的后半句：「**且行为相应改变**（有测试）」。
 *
 * ## 为什么这条要单独写
 *
 * 同目录的 `skills.controller.test.ts` 证明了「禁用后 system message 里没有它」。
 * 那证明的是**输入**变了，不是**行为**变了 —— 中间还隔着「模型读到输入、
 * 给出不同输出」这一跳，而这一跳恰恰是最容易被跳过的一跳（把开关做成一个
 * 只影响页面显示的字段，system message 不变，接口照样能返回 enabled:false）。
 *
 * 真正替模型做决定的不是我们，所以我们不去假装复现模型。这里做的是把
 * **模型换成一个会读 system message 的替身**：它看见 `socratic-tutor` 就按
 * 苏格拉底式追问回话，看不见就直接讲解。于是「同一个学生、同一句话、同一
 * 个知识点」，只因为开关不同，回来的卡片就不同 —— 这条链路上除了模型本身，
 * 每一段都是真的（DB 开关 → composeSystemMessage → TurnService → LlmPort →
 * 响应）。模型那一跳用替身，是因为在测试里打真模型既慢又不稳定，而它在这条
 * 链路上的角色就是「按收到的指示行事」。
 *
 * ## 负向断言必须配正向对照
 *
 * 「两次结果不同」有可能只是因为随机性（比如 cardId 不同）。所以断言的是
 * 两次 `visibleResponse` **具体不同**，并且各自对应的 system message 里
 * 那个 skill 的存在性也相反 —— 三件事同时成立才算证明。
 */

/** 会读 system message 的假模型：它的回答**取决于**有没有看见那个 skill。 */
class SkillAwareLlm implements LlmPort {
  readonly id = 'skill-aware';

  public readonly calls: LlmCompleteOptions[] = [];

  async complete(options: LlmCompleteOptions): Promise<LlmResult> {
    this.calls.push(options);
    const system = options.messages.find((m) => m.role === 'system')?.content ?? '';
    const sawSocratic = system.includes('socratic-tutor');

    // 看见追问 skill 就一次只问一个问题；没看见就直接讲解。
    const text = sawSocratic
      ? JSON.stringify({
          visibleResponse: '我们一步一步来。先看这个量的单位是什么？',
          cardKind: 'graph_focus',
          rationale: '按苏格拉底式追问，先确认概念与量纲。',
        })
      : JSON.stringify({
          visibleResponse: '这个知识点可以直接讲：先记住定义，再看两个例子。',
          cardKind: 'graph_focus',
          rationale: '没有可用的追问 skill，改用直接讲解。',
        });

    return { text, parsed: JSON.parse(text) };
  }
}

let app: INestApplication;
let schema: TestSchema;
let db: DatabaseService;

const llm = new SkillAwareLlm();

beforeAll(async () => {
  schema = await createTestSchema();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LLM_PORT)
    .useValue(llm)
    .compile();

  app = moduleRef.createNestApplication();
  db = app.get(DatabaseService);
  await db.useSchema(schema.name);
  await app.init();
}, 60_000);

afterAll(async () => {
  await app?.close();
  await schema?.drop();
});

interface TurnBody {
  visibleResponse: string;
  artifact: { kind: string } | null;
}

async function toggle(name: string, enabled: boolean): Promise<void> {
  await request(app.getHttpServer())
    .patch(`/api/v1/agent/skills/${name}`)
    .send({ enabled })
    .expect(200);
}

async function turn(sessionId: string): Promise<{ body: TurnBody; system: string }> {
  const before = llm.calls.length;
  const res = await request(app.getHttpServer())
    .post('/api/v1/agent/turns')
    .send({ sessionId, utterance: '我想学噪声', microKpId: null, tier: 'P1' })
    .expect(200);

  const call = llm.calls[before];
  expect(call).toBeDefined();

  return {
    body: res.body as TurnBody,
    system: call?.messages.find((m) => m.role === 'system')?.content ?? '',
  };
}

describe('禁用真的改变 agent 的行为，不只是改变页面显示', () => {
  it('同一个学生、同一句话：启用时被追问，禁用后变成直接讲解', async () => {
    await toggle('socratic-tutor', true);
    const enabled = await turn('ses-behavior-1');
    expect(enabled.system).toContain('socratic-tutor');
    expect(enabled.body.visibleResponse).toContain('单位是什么');

    await toggle('socratic-tutor', false);
    const disabled = await turn('ses-behavior-2');
    expect(disabled.system).not.toContain('socratic-tutor');
    expect(disabled.body.visibleResponse).toContain('直接讲');

    // 两次的回答必须不同 —— 而且不同的方向与 system message 的差异一致
    expect(disabled.body.visibleResponse).not.toBe(enabled.body.visibleResponse);

    await toggle('socratic-tutor', true);
  });

  it('对照：只关掉另一个 skill（question-author），追问行为不受影响', async () => {
    await toggle('question-author', false);
    const other = await turn('ses-behavior-3');

    // 关的不是它，行为必须保持原样。没有这条，「禁用任意 skill 都会变」也能过
    expect(other.system).toContain('socratic-tutor');
    expect(other.body.visibleResponse).toContain('单位是什么');

    await toggle('question-author', true);
  });

  it('两个都关掉时，模型既没有追问也没有出题指引', async () => {
    await toggle('socratic-tutor', false);
    await toggle('question-author', false);
    const none = await turn('ses-behavior-4');

    expect(none.system).not.toContain('socratic-tutor');
    expect(none.system).not.toContain('question-author');
    // 基础提示词仍然在（禁用 skill 不等于关掉智能体）
    expect(none.system).toContain('StarMap');
    expect(none.body.visibleResponse).toContain('直接讲');

    await toggle('socratic-tutor', true);
    await toggle('question-author', true);
  });
});
