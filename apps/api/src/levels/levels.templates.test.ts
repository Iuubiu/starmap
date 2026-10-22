import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  fillLevelTemplate,
  validateLevelSpec,
  type LevelSpec,
  type LevelTemplate,
} from '@starmap/shared';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../db/database.service.js';
import { ScriptedLlm } from '../llm/scripted-llm.js';
import { LLM_PORT } from '../llm/llm.port.js';
import { createTestSchema, type TestSchema } from '../../test/test-schema.js';
import { assertMatchesContract } from '../../test/contract.js';
import { LEVEL_TEMPLATES, findLevelTemplate } from './level-templates.js';
import { computeShareHash, stableStringify } from './levels.export.js';

/**
 * 票 66：关卡模板与导入导出。
 *
 * 这一套与 `levels.controller.test.ts` 分开，因为两者的前提不同：那一套要种一份
 * 完整的手写关卡（用来验播放器与校验器的字段级错误），这一套只需要一个知识点
 * 和一张最小关卡（用来验模板填充与文件往返）。
 */
describe('关卡模板与导入导出（集成）', () => {
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

    // 自己的最小数据：id 全部带 `tpl` 前缀，避开其它套件的固定断言。
    await db.query(`INSERT INTO subjects (id, name) VALUES ('subj-tpl', '测试学科')`);
    await db.query(
      `INSERT INTO modules (id, subject_id, name, tier, ordinal)
       VALUES ('mod-tpl', 'subj-tpl', '测试模块', 'A', 1)`,
    );
    await db.query(
      `INSERT INTO knowledge_points (id, module_id, parent_id, name, is_leaf, depth, ordinal)
       VALUES ('kp-tpl', 'mod-tpl', NULL, '模板测试知识点', true, 0, 1)`,
    );
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await schema?.drop();
  });

  // -------------------------------------------------------------------------
  // 验收 1：三个内置模板
  // -------------------------------------------------------------------------

  it('GET /api/v1/level-templates 返回三个模板，segments 与 slots 都能被枚举', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/level-templates').expect(200);
    assertMatchesContract('/api/v1/level-templates', 'get', 200, res.body);

    const templates = res.body.templates as LevelTemplate[];
    expect(templates.map((t) => t.templateId)).toEqual(['teaching', 'practice', 'review']);

    for (const template of templates) {
      // 每个模板都能被 shared 的 schema 读回去 —— 这是「前端能枚举」的实际含义：
      // 不是「JSON 里有这个字段」，而是「按契约解析不炸」。
      expect(() => findLevelTemplate(template.templateId)).not.toThrow();
      expect(template.segments.length).toBeGreaterThan(0);
      expect(template.slots.length).toBeGreaterThan(0);

      // 槽位必须与段对得上：段说几张卡几道题，槽位就得有几个。
      for (const segment of template.segments) {
        const cards = template.slots.filter(
          (s) => s.segmentKind === segment.kind && s.kind === 'card',
        );
        const items = template.slots.filter(
          (s) => s.segmentKind === segment.kind && s.kind === 'item',
        );
        expect(cards.length).toBe(segment.cardCount);
        expect(items.length).toBe(segment.itemCount);
      }

      // 每个段都要说清「为什么存在」—— 没有 purpose 的段就是摆设。
      for (const segment of template.segments) expect(segment.purpose.length).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // 验收 2：三档预览差异
  // -------------------------------------------------------------------------

  it('POST /level-templates/{id}/preview 返回未持久化的草稿，且三档下段数可辨', async () => {
    const counts: number[] = [];
    for (const tier of ['P1', 'P2', 'P3'] as const) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/level-templates/teaching/preview')
        .send({ microKpId: 'kp-tpl', tier })
        .expect(200);
      assertMatchesContract(
        '/api/v1/level-templates/{templateId}/preview',
        'post',
        200,
        res.body,
      );

      expect(res.body.persisted).toBe(false);
      expect(res.body.tier).toBe(tier);

      const spec = res.body.spec as LevelSpec;
      // 草稿必须能通过校验器 —— 模板拼出非法关卡属于服务端 bug，不该等到落库后
      // 才在学习者眼前炸。
      const validated = validateLevelSpec(spec);
      if (!validated.ok) {
        throw new Error(
          `${tier} 档草稿不合法：\n${validated.issues.map((i) => `${i.path}: ${i.message}`).join('\n')}`,
        );
      }
      expect(spec.meta.tier).toBe(tier);
      expect(spec.meta.author).toBe('system');
      counts.push(spec.steps.length);
    }

    // P1 七段全走、P2 去掉「进一步讲解」、P3 连深究也去掉 —— 差异发生在骨架上。
    expect(counts).toEqual([7, 6, 5]);
    // 三档必须两两不同，否则「按档位填模板」就是空话。
    expect(new Set(counts).size).toBe(3);
  });

  it('预览不落库：连查三次关卡表都查不到草稿 id', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/level-templates/practice/preview')
      .send({ microKpId: 'kp-tpl', tier: 'P2' })
      .expect(200);

    // 草稿 id 是确定性的（`<kp>--<template>--<tier>`），所以直接按它查即可。
    const rows = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM levels WHERE id LIKE 'kp-tpl--%'`,
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('预览：模板不存在 404、缺 microKpId 400', async () => {
    const notFound = await request(app.getHttpServer())
      .post('/api/v1/level-templates/没有这个模板/preview')
      .send({ microKpId: 'kp-tpl' })
      .expect(404);
    expect(notFound.body.code).toBe('NOT_FOUND');

    const badRequest = await request(app.getHttpServer())
      .post('/api/v1/level-templates/teaching/preview')
      .send({})
      .expect(400);
    expect(badRequest.body.code).toBe('VALIDATION_FAILED');
    expect((badRequest.body.details as { path: string }[])[0]?.path).toBe('microKpId');
  });

  // -------------------------------------------------------------------------
  // 验收 3 / 4：导出幂等与导入 round-trip
  // -------------------------------------------------------------------------

  it('POST /levels/{id}/export 幂等：连按两次除 exportedAt 外字节相同', async () => {
    const spec = templateSpec('teaching', 'P1');
    await insertLevel('lv-tpl-export', spec);

    const first = await request(app.getHttpServer())
      .post('/api/v1/levels/lv-tpl-export/export')
      .expect(200);
    assertMatchesContract('/api/v1/levels/{levelId}/export', 'post', 200, first.body);

    const second = await request(app.getHttpServer())
      .post('/api/v1/levels/lv-tpl-export/export')
      .expect(200);

    // 稳定序列化：对象键排序，所以两次导出的字节差异只可能来自时间戳。
    const stripTime = (body: Record<string, unknown>): string =>
      stableStringify({ ...body, exportedAt: '<time>' });
    expect(stripTime(second.body as Record<string, unknown>)).toBe(
      stripTime(first.body as Record<string, unknown>),
    );

    // 摊平题表与 spec.items 内容一致（刻意的冗余，导入时会校验）。
    const body = first.body as { format: string; items: unknown[]; spec: LevelSpec };
    expect(body.format).toBe('starmap.level/1');
    expect(body.items.length).toBe(body.spec.items.length);
  });

  it('导出的文件原样导回：新 id、origin=imported、内容除 id 外一致', async () => {
    const exported = await request(app.getHttpServer())
      .post('/api/v1/levels/lv-tpl-export/export')
      .expect(200);

    const imported = await request(app.getHttpServer())
      .post('/api/v1/levels/import')
      .send(exported.body)
      .expect(201);
    assertMatchesContract('/api/v1/levels/import', 'post', 201, imported.body);

    const importedId = imported.body.levelId as string;
    expect(imported.body.created).toBe(true);
    expect(importedId).not.toBe('lv-tpl-export');
    expect(importedId).toMatch(/^lv-import-[0-9a-f]{12}$/);

    const rows = await db.query<{ origin: string; share_hash: string; spec: LevelSpec }>(
      `SELECT origin, share_hash, spec FROM levels WHERE id = $1`,
      [importedId],
    );
    expect(rows[0]?.origin).toBe('imported');
    expect(rows[0]?.share_hash).toBe(imported.body.shareHash);

    // round-trip 的判据：**除 id 外**内容一致。id 必然变（全局主键，沿用会撞车），
    // 所以剥掉 id 再比。
    const stripIds = (value: unknown): unknown => {
      const clone = JSON.parse(JSON.stringify(value)) as LevelSpec;
      return {
        ...clone,
        meta: { ...clone.meta, id: '<id>' },
        cards: clone.cards.map((c) => ({ ...c, id: '<id>' })),
        items: clone.items.map((i) => ({ ...i, id: '<id>' })),
        steps: clone.steps.map((s) => ({
          ...s,
          id: '<id>',
          cardIds: s.cardIds.map(() => '<id>'),
          itemIds: s.itemIds.map(() => '<id>'),
        })),
      };
    };
    const original = (exported.body as { spec: LevelSpec }).spec;
    expect(stripIds(rows[0]?.spec)).toEqual(stripIds(original));

    // 题目行也落库了，且池子映射与 market 的写路径一致（core → quiz）。
    const itemRows = await db.query<{ pool: string }>(
      `SELECT pool FROM level_items WHERE level_id = $1`,
      [importedId],
    );
    expect(itemRows.length).toBe(original.items.length);
    for (const row of itemRows) expect(['quiz', 'practice']).toContain(row.pool);
  });

  it('同一个文件连导两次：第二次返回已有那张（created=false），不新建', async () => {
    const exported = await request(app.getHttpServer())
      .post('/api/v1/levels/lv-tpl-export/export')
      .expect(200);

    const first = await request(app.getHttpServer())
      .post('/api/v1/levels/import')
      .send(exported.body)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/api/v1/levels/import')
      .send(exported.body)
      .expect(201);

    expect(second.body.levelId).toBe(first.body.levelId);
    expect(second.body.shareHash).toBe(first.body.shareHash);
    // 第一次可能是本次新建，也可能是上一个用例建的 —— 关键是第二次一定不是新建。
    expect(second.body.created).toBe(false);

    const rows = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM levels WHERE share_hash = $1`,
      [first.body.shareHash],
    );
    expect(rows[0]?.count).toBe('1');
  });

  // -------------------------------------------------------------------------
  // 验收 4 的反面：非法输入被拒
  // -------------------------------------------------------------------------

  it('导入：format 不对返回 400，且 details 指到 format 字段', async () => {
    const exported = await request(app.getHttpServer())
      .post('/api/v1/levels/lv-tpl-export/export')
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/api/v1/levels/import')
      .send({ ...(exported.body as Record<string, unknown>), format: 'starmap.level/2' })
      .expect(400);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    const details = res.body.details as { path: string }[];
    expect(details.some((d) => d.path === 'format')).toBe(true);
    assertMatchesContract('/api/v1/levels/import', 'post', 400, res.body);
  });

  it('导入：关卡内容不合法返回 422，且路径细到 steps[i].itemIds[j]', async () => {
    const exported = await request(app.getHttpServer())
      .post('/api/v1/levels/lv-tpl-export/export')
      .expect(200);

    const body = exported.body as { spec: LevelSpec };
    // 把判定段指向一道不存在的题：形状完全合法（仍是合法 JSON、items 表也没动），
    // 只有跨字段不变量能发现它 —— 这正是 422 而不是 400 的场景。
    const broken: LevelSpec = {
      ...body.spec,
      steps: body.spec.steps.map((step) =>
        step.kind === 'quiz'
          ? { ...step, itemIds: ['i-不存在的题目', ...step.itemIds] }
          : step,
      ),
    };

    const res = await request(app.getHttpServer())
      .post('/api/v1/levels/import')
      .send({ ...(exported.body as Record<string, unknown>), spec: broken })
      .expect(422);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    const details = res.body.details as { path: string; message: string }[];
    expect(details.length).toBeGreaterThan(0);
    expect(details.some((d) => /^steps\.\d+\.itemIds\.\d+$/.test(d.path))).toBe(true);
    assertMatchesContract('/api/v1/levels/import', 'post', 422, res.body);
  });

  it('导入：摊平题表与 spec.items 不一致返回 422（文件被手改坏了）', async () => {
    const exported = await request(app.getHttpServer())
      .post('/api/v1/levels/lv-tpl-export/export')
      .expect(200);

    const body = exported.body as { items: { stem: string }[] };
    const tampered = body.items.map((item, index) =>
      index === 0 ? { ...item, stem: '被手改过的题干' } : item,
    );

    const res = await request(app.getHttpServer())
      .post('/api/v1/levels/import')
      .send({ ...(exported.body as Record<string, unknown>), items: tampered })
      .expect(422);

    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect((res.body.details as { path: string }[])[0]?.path).toBe('items');
  });

  it('导出不存在的关卡返回 404', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/levels/没有这个关卡/export')
      .expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toContain('关卡不存在');
  });

  // -------------------------------------------------------------------------
  // 纯函数层：share_hash 与导出无关字段
  // -------------------------------------------------------------------------

  it('share_hash 与 id、exportedAt、source 无关（同一内容必同 hash）', () => {
    const spec = templateSpec('practice', 'P2');
    const base = computeShareHash(spec, spec.items);

    const renamed: LevelSpec = { ...spec, meta: { ...spec.meta, id: '换了个 id' } };
    expect(computeShareHash(renamed, renamed.items)).toBe(base);

    // 题干变了必须换 hash —— 否则两个内容不同的关卡会被当成同一份去重掉。
    const changedItems = spec.items.map((item, index) =>
      index === 0 ? { ...item, stem: `${item.stem}（改）` } : item,
    );
    expect(computeShareHash({ ...spec, items: changedItems }, changedItems)).not.toBe(base);
  });

  // -------------------------------------------------------------------------
  // 辅助
  // -------------------------------------------------------------------------

  /** 用模板直接填一份 spec（不走 HTTP），供纯函数与导出用例使用。 */
  function templateSpec(templateId: string, tier: 'P1' | 'P2' | 'P3'): LevelSpec {
    const template = findLevelTemplate(templateId);
    if (!template) throw new Error(`内置模板缺失: ${templateId}`);
    const draft = fillLevelTemplate(template, { microKpId: 'kp-tpl', microKpName: '模板测试知识点', tier });
    const validated = validateLevelSpec(draft);
    if (!validated.ok) {
      throw new Error(
        `模板 ${templateId} 填出的草稿不合法：\n${validated.issues
          .map((i) => `${i.path}: ${i.message}`)
          .join('\n')}`,
      );
    }
    return validated.spec;
  }

  async function insertLevel(levelId: string, spec: LevelSpec): Promise<void> {
    await db.query(
      `INSERT INTO levels (id, micro_kp_id, title, kind, ordinal, spec)
       VALUES ($1, 'kp-tpl', $2, 'teach', 1, $3::jsonb)`,
      [levelId, spec.meta.title, JSON.stringify(spec)],
    );
    for (const item of spec.items) {
      await db.query(
        `INSERT INTO level_items
           (id, level_id, stem, options, answer, explain_correct, explain_wrong,
            misconception_tags, source_ref, variant_group, pool)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8::text[], $9, $10, $11)`,
        [
          item.id,
          levelId,
          item.stem,
          JSON.stringify(item.options),
          JSON.stringify(item.answer),
          item.explainCorrect,
          item.explainWrong,
          item.misconceptionTags,
          item.sourceRef,
          item.variantGroup,
          item.pool === 'practice' ? 'practice' : 'quiz',
        ],
      );
    }
  }
});

describe('内置模板自身的结构约束', () => {
  it('教学模板的 reteach 档位是 deepen 的子集（没有深究就不能有进一步讲解）', () => {
    const teaching = LEVEL_TEMPLATES.find((t) => t.templateId === 'teaching');
    if (!teaching) throw new Error('内置教学模板缺失');

    const deepen = teaching.segments.find((s) => s.kind === 'deepen');
    const reteach = teaching.segments.find((s) => s.kind === 'reteach');
    if (!deepen || !reteach) throw new Error('教学模板缺少深究或进一步讲解段');

    for (const tier of reteach.tiers) {
      expect(deepen.tiers).toContain(tier);
    }
  });

  it('模板 id 稳定（levels.template_id 会留下引用，改名等于断链）', () => {
    expect(LEVEL_TEMPLATES.map((t) => t.templateId)).toEqual(['teaching', 'practice', 'review']);
    expect(LEVEL_TEMPLATES.map((t) => t.version)).toEqual([1, 1, 1]);
  });
});
