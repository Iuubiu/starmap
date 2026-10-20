import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { validateLevelSpec, prettyIssuePath, type LevelSpec } from '@starmap/shared';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../db/database.service.js';
import { ScriptedLlm } from '../llm/scripted-llm.js';
import { LLM_PORT } from '../llm/llm.port.js';
import { createTestSchema, type TestSchema } from '../../test/test-schema.js';
import { assertMatchesContract } from '../../test/contract.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const contentPath = join(repoRoot, 'content', 'levels', 'lv-bool-laws.spec.json');
const migrationPath = join(
  repoRoot,
  'apps',
  'api',
  'migrations',
  '0010_levels_teaching_bool.sql',
);

/**
 * 手写教学关卡有两份落盘：`content/levels/*.spec.json`（作者改这里）与
 * 迁移里的内联副本（`db:migrate` 灌进 `levels.spec`）。两份必须一致，
 * 否则「读了 content 却拷到旧关卡」这类漂移会静默存在很久。
 */
const contentSpec = JSON.parse(readFileSync(contentPath, 'utf8')) as LevelSpec;

function migrationJson(): unknown {
  const sql = readFileSync(migrationPath, 'utf8');
  const match = /\$levelspec\$([\s\S]*?)\$levelspec\$/.exec(sql);
  if (!match?.[1]) {
    throw new Error(`迁移 ${migrationPath} 里找不到 $levelspec$ … $levelspec$ 包裹的 JSON`);
  }
  return JSON.parse(match[1]);
}

describe('LevelsController（集成）', () => {
  let app: INestApplication;
  let schema: TestSchema;
  let db: DatabaseService;

  beforeAll(async () => {
    schema = await createTestSchema();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PORT)
      .useValue(new ScriptedLlm([{ text: '假的' }]))
      .compile();

    app = moduleRef.createNestApplication();
    db = app.get(DatabaseService);
    await db.useSchema(schema.name);
    await app.init();

    // 自己的最小数据：id 全部带 `lvtest` 前缀，避开其它套件的固定断言。
    // 迁移 0010 的数据段只在「版本化迁移器」下执行（测试 schema 是重放，
    // 版本表不存在），所以这里必须自己种。
    await db.query(`INSERT INTO subjects (id, name) VALUES ('subj-lvtest', '测试学科')`);
    await db.query(
      `INSERT INTO modules (id, subject_id, name, tier, ordinal)
       VALUES ('mod-lvtest', 'subj-lvtest', '测试模块', 'A', 1)`,
    );
    await db.query(
      `INSERT INTO knowledge_points (id, module_id, parent_id, name, is_leaf, depth, ordinal)
       VALUES ('kp-lvtest', 'mod-lvtest', NULL, '测试知识点', true, 0, 1)`,
    );
    await db.query(
      `INSERT INTO levels (id, micro_kp_id, title, kind, ordinal, spec)
       VALUES ('lv-lvtest', 'kp-lvtest', $1, 'teach', 1, $2::jsonb)`,
      [contentSpec.meta.title, JSON.stringify(contentSpec)],
    );
    // 一份坏数据（引用不存在的题目），用来验证 500 仍给字段级 details
    await db.query(
      `INSERT INTO levels (id, micro_kp_id, title, kind, ordinal, spec)
       VALUES ('lv-lvtest-broken', 'kp-lvtest', '坏关卡', 'teach', 2, $1::jsonb)`,
      [JSON.stringify({ ...contentSpec, steps: brokenSteps() })],
    );
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await schema?.drop();
  });

  it('GET /api/v1/levels/:id 返回完整 spec，且卡片与七段步骤都在', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/levels/lv-lvtest').expect(200);
    assertMatchesContract('/api/v1/levels/{levelId}', 'get', 200, res.body);

    expect(res.body.level.levelId).toBe('lv-lvtest');
    expect(res.body.level.microKpId).toBe('kp-lvtest');
    // itemCount 由 spec 推导，不是库里的列
    expect(res.body.level.itemCount).toBe(contentSpec.items.length);

    const spec = res.body.spec as LevelSpec;
    expect(spec.steps.map((s) => s.kind)).toEqual([
      'guide',
      'detail',
      'probe',
      'deepen',
      'reteach',
      'quiz',
      'summary',
    ]);
    expect(spec.cards.length).toBeGreaterThanOrEqual(6);
    expect(spec.items.length).toBeGreaterThanOrEqual(4);
  });

  it('每道题都带着预写反馈下发（前端作答后无需再请求）', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/levels/lv-lvtest').expect(200);
    const spec = res.body.spec as LevelSpec;
    for (const item of spec.items) {
      expect(item.explainCorrect.length).toBeGreaterThan(0);
      expect(item.explainWrong.length).toBeGreaterThan(0);
    }
    // 判断题必须有溯源，深究题（practice）不判分故允许无溯源
    const judgement = spec.items.filter((i) => i.pool === 'core');
    expect(judgement.length).toBeGreaterThan(0);
    for (const item of judgement) expect(item.sourceRef).not.toBeNull();
  });

  it('关卡不存在返回 404 与统一错误结构', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/levels/没有这个关卡').expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toContain('关卡不存在');
    expect(res.body.stack).toBeUndefined();
    assertMatchesContract('/api/v1/levels/{levelId}', 'get', 404, res.body);
  });

  it('库里存了坏 spec 时返回 500，且 details 是字段级路径', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/levels/lv-lvtest-broken')
      .expect(500);
    expect(res.body.code).toBe('INTERNAL');
    expect(res.body.message).toContain('关卡规范不合法');
    const details = res.body.details as { path: string; message: string }[];
    expect(Array.isArray(details)).toBe(true);
    expect(details.length).toBeGreaterThan(0);
    // 不是「校验失败」一句话，而是指到哪一步的哪一道题
    const first = details[0];
    expect(first?.path).toMatch(/^steps\.\d+\.itemIds\.\d+$/);
    expect(prettyIssuePath(first?.path ?? '')).toMatch(/^steps\[\d+\]\.itemIds\[\d+\]$/);
    assertMatchesContract('/api/v1/levels/{levelId}', 'get', 500, res.body);
  });
});

describe('手写关卡：content 与迁移不漂移', () => {
  it('迁移里内联的 spec 与 content/levels/*.spec.json 完全一致', () => {
    expect(migrationJson()).toEqual(contentSpec);
  });

  it('content 文件本身通过校验器（作者改了 JSON 但没跑校验会在这里炸）', () => {
    const result = validateLevelSpec(contentSpec);
    if (!result.ok) {
      throw new Error(
        `content/levels/lv-bool-laws.spec.json 不合法：\n` +
          result.issues.map((i) => `${prettyIssuePath(i.path)}: ${i.message}`).join('\n'),
      );
    }
    expect(result.ok).toBe(true);
  });
});

/** 把 quiz 步骤指向一道不存在的题目，制造一份「库里的坏数据」。 */
function brokenSteps(): unknown[] {
  const steps = contentSpec.steps.map((s) => ({ ...s }));
  const quiz = steps.find((s) => s.kind === 'quiz');
  if (!quiz) throw new Error('手写关卡缺少判定步骤，测试前提不成立');
  quiz.itemIds = ['i-不存在的题目', ...quiz.itemIds];
  return steps;
}
