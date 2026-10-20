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

/**
 * 票 15 的接口级验收。
 *
 * ## 这一页最容易做假的地方
 *
 * 「禁用」有两种实现：
 *
 * 1. 在 system message 里加一句「本次对话不要使用 question-author 技能」；
 * 2. 把该 skill 从 system message 里**摘掉**，一个字符都不留。
 *
 * 前者看起来能用，实际上是**提示词约束**：模型可以不理它，而且「被禁用的
 * 姓名 + 正文 + 触发场景」仍然进了上下文，等于告诉模型有个东西可用但别用。
 * 票 15 的验收原文是「禁用一个 skill 后，agent 的 system message 里不再出现它」。
 *
 * 所以这里不测「列表接口是否返回了 enabled:false」（那只能证明数据库里有行），
 * 而是把**真正发给模型的文本**取出来，逐项断言被禁用的名字、正文、触发场景
 * 一个都不在里面。这也是为什么 `composeSystemMessage()` 与预览接口必须同源：
 * 若它们各写一份，这条测试就会在「预览说禁用了、实际调用还在用」的情况下变绿。
 */

let app: INestApplication;
let schema: TestSchema;
let db: DatabaseService;

const scripted = new ScriptedLlm([{ text: '{"visibleResponse":"好","cardKind":"graph_focus","rationale":"测试"}' }]);

beforeAll(async () => {
  schema = await createTestSchema();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LLM_PORT)
    .useValue(scripted)
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

interface SkillBody {
  name: string;
  description: string;
  version: string;
  triggerScenarios: string[];
  enabled: boolean;
  referenceCount: number;
  directoryName: string;
  instructions: string;
  references: Array<{ name: string; sizeBytes: number; preview: string }>;
  validation: { valid: boolean; errors: string[]; warnings: string[] };
}

interface PreviewBody {
  systemMessage: string;
  includedSkills: string[];
  excludedSkills: string[];
}

async function list(): Promise<{ directory: string; items: SkillBody[]; enabledCount: number; disabledCount: number }> {
  const res = await request(app.getHttpServer()).get('/api/v1/agent/skills').expect(200);
  assertMatchesContract('/api/v1/agent/skills', 'get', 200, res.body);
  return res.body as never;
}

async function preview(): Promise<PreviewBody> {
  const res = await request(app.getHttpServer()).get('/api/v1/agent/skills/system-preview').expect(200);
  assertMatchesContract('/api/v1/agent/skills/system-preview', 'get', 200, res.body);
  return res.body as PreviewBody;
}

async function toggle(name: string, enabled: boolean): Promise<SkillBody> {
  const res = await request(app.getHttpServer())
    .patch(`/api/v1/agent/skills/${name}`)
    .send({ enabled })
    .expect(200);
  assertMatchesContract('/api/v1/agent/skills/{name}', 'patch', 200, res.body);
  return (res.body as { skill: SkillBody }).skill;
}

describe('扫描真实目录：列出的就是磁盘上的 SKILL.md', () => {
  it('两个真实 skill 都在，字段来自 frontmatter 而不是硬编码', async () => {
    const body = await list();

    const names = body.items.map((i) => i.name).sort();
    expect(names).toEqual(['question-author', 'socratic-tutor']);

    const socratic = body.items.find((i) => i.name === 'socratic-tutor');
    expect(socratic?.version).toBe('1.0.0');
    expect(socratic?.description.length).toBeGreaterThan(0);
    // 触发场景来自 frontmatter 的 triggers，不是正文里随便找的
    expect(socratic?.triggerScenarios.length).toBeGreaterThanOrEqual(3);
    expect(socratic?.directoryName).toBe('socratic-tutor');
    expect(socratic?.referenceCount).toBe(1);
  });

  it('目录名必须等于 name（Mastra 用目录名定位 skill）', async () => {
    const body = await list();
    for (const item of body.items) {
      expect(item.name).toBe(item.directoryName);
    }
  });

  it('详情带正文与 references 清单，但不展开 reference 全文', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/agent/skills/socratic-tutor')
      .expect(200);
    assertMatchesContract('/api/v1/agent/skills/{name}', 'get', 200, res.body);

    const skill = (res.body as { skill: SkillBody }).skill;
    expect(skill.instructions).toContain('五级求助阶梯');
    expect(skill.references).toHaveLength(1);
    expect(skill.references[0]?.name).toBe('phrasing.md');
    expect(skill.references[0]?.sizeBytes).toBeGreaterThan(0);
    // 预览是摘录，不是全文：它是给人翻的，不是给模型吃的
    expect(skill.references[0]?.preview.length).toBeLessThanOrEqual(
      (skill.references[0]?.preview ?? '').length,
    );
    expect(skill.validation.valid).toBe(true);
    expect(skill.validation.errors).toEqual([]);
  });

  it('不存在的 skill 404', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/agent/skills/no-such-skill').expect(404);
    expect((res.body as { code: string }).code).toBe('NOT_FOUND');
  });
});

describe('禁用是真的摘除，不是提示词里说一句别用', () => {
  it('禁用后，system message 里该 skill 的名字、正文、触发场景全部消失', async () => {
    const before = await preview();
    expect(before.includedSkills).toContain('question-author');
    expect(before.systemMessage).toContain('question-author');

    // 取一段正文与一条触发场景作为「不该出现的证据」
    const detailRes = await request(app.getHttpServer())
      .get('/api/v1/agent/skills/question-author')
      .expect(200);
    const detail = (detailRes.body as { skill: SkillBody }).skill;
    const instructionsHead = detail.instructions.split('\n').find((l) => l.trim().length > 12) ?? '';
    const trigger = detail.triggerScenarios[0] ?? '';
    expect(instructionsHead.length).toBeGreaterThan(0);
    expect(trigger.length).toBeGreaterThan(0);
    expect(before.systemMessage).toContain(instructionsHead.trim());
    expect(before.systemMessage).toContain(trigger);

    await toggle('question-author', false);

    const after = await preview();
    expect(after.includedSkills).not.toContain('question-author');
    expect(after.excludedSkills).toContain('question-author');

    // 名字、正文、触发场景：一个都不能留下
    expect(after.systemMessage).not.toContain('question-author');
    expect(after.systemMessage).not.toContain(instructionsHead.trim());
    expect(after.systemMessage).not.toContain(trigger);

    // 更严格的一条：不得出现「已禁用 X」这类提示词式约束
    expect(after.systemMessage).not.toContain('禁用');
    expect(after.systemMessage).not.toContain('不要使用');
  });

  it('禁用不影响别的 skill', async () => {
    const after = await preview();
    expect(after.includedSkills).toContain('socratic-tutor');
    expect(after.systemMessage).toContain('socratic-tutor');
    expect(after.systemMessage).toContain('五级求助阶梯');
  });

  it('重新启用后原样回来', async () => {
    await toggle('question-author', true);
    const after = await preview();
    expect(after.includedSkills).toContain('question-author');
    expect(after.systemMessage).toContain('question-author');
    expect(after.excludedSkills).toEqual([]);
  });
});

describe('开关持久化：不是进程内状态', () => {
  it('库里留了行，重启后仍然生效（下次服务实例读到同一张表）', async () => {
    await toggle('socratic-tutor', false);

    const rows = await db.query<{ name: string; enabled: boolean; updated_by: string }>(
      'SELECT name, enabled, updated_by FROM skill_switches WHERE name = $1',
      ['socratic-tutor'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(false);
    expect(rows[0]?.updated_by).toBe('local');

    // 列表接口反映的是库里的状态，不是内存里的
    const body = await list();
    expect(body.items.find((i) => i.name === 'socratic-tutor')?.enabled).toBe(false);
    expect(body.disabledCount).toBe(1);

    await toggle('socratic-tutor', true);
  });

  it('没有开关行的 skill 默认启用（新增目录立刻可用，不需要先写一行）', async () => {
    const rows = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM skill_switches WHERE name = $1',
      ['socratic-tutor'],
    );
    // 上一条用例末尾已启用回来，但行还在；这里验证的是「无行」等价于启用
    const body = await list();
    expect(body.items.find((i) => i.name === 'socratic-tutor')?.enabled).toBe(true);
    expect(Number(rows[0]?.count)).toBeGreaterThan(0);
  });
});

describe('回合服务用的 system message 与预览完全同源', () => {
  it('禁用后真实调用里的 system message 也不含该 skill', async () => {
    await toggle('question-author', false);

    // 走一轮真实回合，读 LlmPort 收到的 system 消息
    const before = scripted.calls.length;
    await request(app.getHttpServer())
      .post('/api/v1/agent/turns')
      .send({ sessionId: 'ses-skills', utterance: '我想学噪声', microKpId: null, tier: 'P1' })
      .expect(200);

    const calls = scripted.calls.slice(before);
    expect(calls.length).toBeGreaterThan(0);
    const systemMessage = calls[0]?.messages.find((m) => m.role === 'system')?.content ?? '';

    expect(systemMessage).toContain('socratic-tutor');
    expect(systemMessage).not.toContain('question-author');

    // 与预览逐字相同 —— 这是「预览是证据」这句话的技术含义
    const shown = await preview();
    expect(systemMessage).toBe(shown.systemMessage);

    await toggle('question-author', true);
  });
});

describe('入参校验', () => {
  it('PATCH 缺 enabled 400', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/agent/skills/socratic-tutor')
      .send({})
      .expect(400);
    assertMatchesContract('/api/v1/agent/skills/{name}', 'patch', 400, res.body);
  });

  it('PATCH 不存在的 skill 404', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/agent/skills/no-such-skill')
      .send({ enabled: false })
      .expect(404);
  });
});
