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

interface GraphNodeBody {
  microKpId: string;
  name: string;
  state: string;
  percent: number | null;
  depth: number;
  moduleId: string;
  moduleName: string;
  moduleOrdinal: number;
  ordinal: number;
  reviewDueAt: string | null;
}

interface GraphEdgeBody {
  from: string;
  to: string;
  kind: string;
}

interface ContentGapBody {
  id: string;
  topic: string;
  reason: string;
  expectedRole: string;
  nearestKpIds: string[];
}

/**
 * 知识图谱端点。
 *
 * ## 这一套里最重要的用例是「快照行不算数」
 *
 * 历史上图谱端点直接 `LEFT JOIN mastery` 读 `ms.current` / `ms.state`，而掌握度
 * 端点是从 `attempts` 回放的。两者的分歧在「有缓存行、没有作答记录」时暴露成
 * 两个数：图谱说 proficient/0.9，掌握度说 unseen/null。
 *
 * 所以这里的种子刻意插**没有 attempts 支撑的 mastery 行**：如果实现又回去读
 * 快照，`无掌握度证据时图谱必须说 unseen/null` 那条会立刻红。插 attempts 的
 * 用例则在后面，用来断言「回放出来的数与掌握度接口一致」。
 */

describe('GraphController（集成）', () => {
  let app: INestApplication;
  let schema: TestSchema;

  beforeAll(async () => {
    schema = await createTestSchema();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PORT)
      .useValue(new ScriptedLlm([{ text: '假的' }]))
      .compile();

    app = moduleRef.createNestApplication();
    const db = app.get(DatabaseService);
    await db.useSchema(schema.name);
    await app.init();

    // 两个模块、三棵树、一个非叶父节点：验证「只返回叶节点」与
    // 「模块序 / 模块内序都带出来」（主线视图排序要用）。
    await db.query(
      `INSERT INTO ${schema.name}.subjects (id, name) VALUES ('nuclear', '核电子学')`,
    );
    await db.query(
      `INSERT INTO ${schema.name}.modules (id, subject_id, name, tier, ordinal)
       VALUES ('m-a', 'nuclear', '信号与噪声', 'A', 2),
              ('m-b', 'nuclear', '数字逻辑', 'D', 1)`,
    );
    await db.query(
      `INSERT INTO ${schema.name}.knowledge_points (id, module_id, parent_id, name, is_leaf, depth, ordinal)
       VALUES ('kp-nonleaf', 'm-a', NULL,      '前置放大器',       false, 0, 1),
              ('kp-noise',  'm-a', 'kp-nonleaf','电荷灵敏前放的噪声来源', true, 1, 1),
              ('kp-cmf',    'm-a', NULL,      '共模反馈',         true, 1, 2),
              ('kp-bool',   'm-b', NULL,      '布尔代数基本运算',   true, 1, 1)`,
    );
    await db.query(
      `INSERT INTO ${schema.name}.mastery
         (micro_kp_id, achieved, current, state, attempt_count, variant_count, evidence_sufficient)
       VALUES ('kp-noise', 0.62, 0.48, 'familiar', 9, 3, true),
              ('kp-bool',  0.91, 0.88, 'mastered', 6, 2, true)`,
    );
    // ⚠️ 上面两行是**没有 attempts 支撑的缓存行**，正是缺陷的复现条件。
    // 下面给 kp-noise 补真实作答，让「回放的数与掌握度接口一致」有东西可比。
    // kp-bool 刻意**不补**：它只存在于快照里，图谱必须报 unseen/null。
    await db.query(
      `INSERT INTO ${schema.name}.levels (id, micro_kp_id, title, kind, ordinal, spec)
       VALUES ('lv-a', 'kp-noise', '噪声来源关卡', 'quiz', 1, '{}'::jsonb)`,
    );
    for (let variant = 0; variant < 3; variant += 1) {
      await db.query(
        `INSERT INTO ${schema.name}.level_items
           (id, level_id, stem, options, answer, explain_correct, explain_wrong,
            variant_group, pool)
         VALUES ($1, 'lv-a', $2, '["甲","乙"]'::jsonb, '0'::jsonb, '对', '错', $3, 'practice')`,
        [`kp-noise-item-${variant}`, `第 ${variant} 个变式`, `vg-kp-noise-${variant}`],
      );
    }
    // 9 次作答 / 3 变式（凑到证据线以上），全对。
    for (let i = 0; i < 9; i += 1) {
      const variant = i % 3;
      await db.query(
        `INSERT INTO ${schema.name}.attempts
           (micro_kp_id, item_id, variant_group, correct, answer, knowledge_kind,
            counts_toward_mastery, created_at)
         VALUES ('kp-noise', $1, $2, true, '0'::jsonb, 'concept', true, $3::timestamptz)`,
        [`kp-noise-item-${variant}`, `vg-kp-noise-${variant}`, `2026-10-01 0${i}:00+00`],
      );
    }
    await db.query(
      `INSERT INTO ${schema.name}.kp_edges (from_id, to_id, kind, evidence)
       VALUES ('kp-noise', 'kp-cmf', 'prereq', '先看懂噪声才谈得上共模抑制'),
              ('kp-bool',  'kp-cmf', 'prereq', '布尔代数用于判断反馈极性')`,
    );
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await schema?.drop();
  });

  it('返回全部叶节点，非叶节点不进图（掌握度只挂在微知识点上）', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/graph').expect(200);
    const nodes = res.body.nodes as GraphNodeBody[];
    const ids = nodes.map((n) => n.microKpId).sort();
    expect(ids).toEqual(['kp-bool', 'kp-cmf', 'kp-noise']);
    expect(ids).not.toContain('kp-nonleaf');
  });

  it('一次返回全部先修边，方向保持 from → to', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/graph').expect(200);
    const edges = res.body.edges as GraphEdgeBody[];
    expect(edges).toEqual([
      { from: 'kp-bool', to: 'kp-cmf', kind: 'prereq' },
      { from: 'kp-noise', to: 'kp-cmf', kind: 'prereq' },
    ]);
  });

  it('带出模块名与两级序号，供线性主线排序', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/graph').expect(200);
    const byId = new Map((res.body.nodes as GraphNodeBody[]).map((n) => [n.microKpId, n]));

    const bool = byId.get('kp-bool');
    expect(bool?.moduleId).toBe('m-b');
    expect(bool?.moduleName).toBe('数字逻辑');
    expect(bool?.moduleOrdinal).toBe(1);
    expect(bool?.ordinal).toBe(1);
    expect(bool?.depth).toBe(1);

    // 同一模块内的两个点保留各自 ordinal，排序不靠 id 字典序碰巧对上
    expect(byId.get('kp-noise')?.moduleOrdinal).toBe(2);
    expect(byId.get('kp-noise')?.ordinal).toBe(1);
    expect(byId.get('kp-cmf')?.ordinal).toBe(2);
  });

  it('只有缓存行、没有作答证据 ⇒ unseen/null（快照不算数，这就是本票修掉的缺陷）', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/graph').expect(200);
    const byId = new Map((res.body.nodes as GraphNodeBody[]).map((n) => [n.microKpId, n]));

    // kp-bool 在 app.mastery 里写着 achieved 0.91 / current 0.88 / mastered，
    // 但 attempts 表里一条记录都没有。改回读快照列，这两条断言立刻红。
    const bool = byId.get('kp-bool');
    expect(bool?.state).toBe('unseen');
    expect(bool?.percent).toBeNull();

    // kp-cmf 连缓存行都没有：同样是 unseen/null（不是 0）。
    const cmf = byId.get('kp-cmf');
    expect(cmf?.state).toBe('unseen');
    expect(cmf?.percent).toBeNull();
  });

  it('有作答证据时，图谱的 percent 与 /api/v1/mastery/:id 的 current 逐位相等', async () => {
    const graph = await request(app.getHttpServer()).get('/api/v1/graph').expect(200);
    const noise = (graph.body.nodes as GraphNodeBody[]).find((n) => n.microKpId === 'kp-noise');
    const mastery = await request(app.getHttpServer())
      .get('/api/v1/mastery/kp-noise')
      .expect(200);

    // 两张表读的是同一批 attempts，必须给出同一个数；差一点都说明有一边在
    // 读缓存或用了不同的评估时刻。
    expect(noise?.percent).toBe(mastery.body.current);
    expect(noise?.state).toBe(mastery.body.state);
    expect(noise?.state).not.toBe('unseen');
    expect(noise?.percent).not.toBeNull();
  });

  it('reviewDueAt 默认 null；写了排期就原样带出（票 07 的读写分界）', async () => {
    const before = await request(app.getHttpServer()).get('/api/v1/graph').expect(200);
    for (const node of before.body.nodes as GraphNodeBody[]) {
      expect(node.reviewDueAt).toBeNull();
    }

    const db = app.get(DatabaseService);
    await db.query(
      `UPDATE ${schema.name}.mastery SET next_review_at = '2026-01-02T03:04:05Z'
       WHERE micro_kp_id = 'kp-bool'`,
    );

    const after = await request(app.getHttpServer()).get('/api/v1/graph').expect(200);
    const bool = (after.body.nodes as GraphNodeBody[]).find((n) => n.microKpId === 'kp-bool');
    expect(bool?.reviewDueAt).toBe('2026-01-02T03:04:05.000Z');
    // 未排期的点仍是 null（部分索引只管已排期的行）
    const cmf = (after.body.nodes as GraphNodeBody[]).find((n) => n.microKpId === 'kp-cmf');
    expect(cmf?.reviewDueAt).toBeNull();

    await db.query(
      `UPDATE ${schema.name}.mastery SET next_review_at = NULL WHERE micro_kp_id = 'kp-bool'`,
    );
  });

  it('响应满足契约（GraphResponse 的字段与枚举）', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/graph').expect(200);
    assertMatchesContract('/api/v1/graph', 'get', 200, res.body);
  });

  it('空库也返回合法形状而不是 null', async () => {
    // 用独立 schema 太贵，这里换个角度：删掉边，图仍要返回节点 + 空数组
    const db = app.get(DatabaseService);
    await db.query(`DELETE FROM ${schema.name}.kp_edges`);
    const res = await request(app.getHttpServer()).get('/api/v1/graph').expect(200);
    expect(res.body.edges).toEqual([]);
    expect((res.body.nodes as GraphNodeBody[]).length).toBe(3);
  });

  /**
   * 内容缺口（票 18 AC5）。
   *
   * 这三条断言的是**「缺口指到不存在的知识点」这个具体故障**，而不是
   * 「响应里有 contentGaps 字段」。后者只能证明字段存在，证明不了它有用：
   * 数组里填一堆 `kp-does-not-exist` 也照样能通过。
   *
   * 迁移 0060 里的 `nearest_kp_ids` 是执行迁移那一刻按名字解析出来的，
   * 知识点重导入后 id 会漂移 —— 所以这里必须真去 nodes 里查一遍。
   */
  describe('内容缺口', () => {
    /**
     * 迁移 0060 是「建表 + 种数据」同文件，`test-schema.ts` 的 `hasDdl` 会把
     * 整份文件放行 —— 所以这三条缺口在测试 schema 里**已经存在**，只是
     * `nearest_kp_ids` 全空（迁移执行时 `knowledge_points` 还是空的）。
     *
     * 这恰好是真实场景的一半：空数组合法、不能因为解析不到就过滤掉。
     * 下面先把它们指到本文件种的真节点上，再验「指得到」。
     */
    it('迁移自带的三条缺口已入 schema，且 nearestKpIds 为空时照常返回', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/graph').expect(200);
      const gaps = res.body.contentGaps as ContentGapBody[];
      expect(gaps.map((g) => g.id)).toEqual(['gap-digital-mca', 'gap-digital-pulse', 'gap-fpga']);
      // 空数组，不是被过滤掉、不是 null
      for (const gap of gaps) {
        expect(gap.nearestKpIds).toEqual([]);
        expect(gap.expectedRole).toBe('advanced');
        expect(gap.topic.length).toBeGreaterThan(0);
        expect(gap.reason.length).toBeGreaterThan(0);
      }
    });

    it('nearestKpIds 指向真节点时能在 nodes 里找到（防「指到不存在的知识点」）', async () => {
      const db = app.get(DatabaseService);
      await db.query(`
        UPDATE ${schema.name}.content_gaps SET nearest_kp_ids = ARRAY['kp-noise']
         WHERE id = 'gap-digital-mca';
        UPDATE ${schema.name}.content_gaps SET nearest_kp_ids = ARRAY['kp-cmf', 'kp-bool']
         WHERE id = 'gap-fpga';
        UPDATE ${schema.name}.content_gaps SET nearest_kp_ids = ARRAY['kp-bool']
         WHERE id = 'gap-digital-pulse';
      `);

      const res = await request(app.getHttpServer()).get('/api/v1/graph').expect(200);
      const gaps = res.body.contentGaps as ContentGapBody[];
      expect(gaps).toHaveLength(3);

      const nodeIds = new Set((res.body.nodes as GraphNodeBody[]).map((n) => n.microKpId));
      for (const gap of gaps) {
        expect(gap.nearestKpIds.length).toBeGreaterThan(0);
        for (const kpId of gap.nearestKpIds) {
          expect(nodeIds, `缺口 ${gap.id} 的 nearestKpIds 指向了不存在的节点 ${kpId}`).toContain(
            kpId,
          );
        }
      }
    });

    it('contentGaps 为空数组时也合法（删光后仍 200，不是 500）', async () => {
      const db = app.get(DatabaseService);
      await db.query(`DELETE FROM ${schema.name}.content_gaps`);

      const res = await request(app.getHttpServer()).get('/api/v1/graph').expect(200);
      // 空是**正常终态**（资源库补齐后缺口就该没了），不是功能没接通：
      // 既不能 404、也不能把字段省掉变成 undefined。
      expect(res.body.contentGaps).toEqual([]);
      expect((res.body.nodes as GraphNodeBody[]).length).toBe(3);
    });

    it('nearestKpIds 指向的节点已不在图里时，缺口照常返回（不过滤）', async () => {
      const db = app.get(DatabaseService);
      await db.query(`
        INSERT INTO ${schema.name}.content_gaps (id, topic, reason, expected_role, nearest_kp_ids)
        VALUES ('gap-orphan', '数字脉冲处理', '提示已失效但缺口仍存在。', 'advanced',
                ARRAY['kp-gone-after-reimport'])
      `);

      const res = await request(app.getHttpServer()).get('/api/v1/graph').expect(200);
      const gaps = res.body.contentGaps as ContentGapBody[];
      // 重导入后 id 漂移是真实场景。若实现「解析不到就过滤掉」，这里会空数组
      // —— 而那一刻恰恰是最需要告诉学习者「这里缺内容」的时候。
      expect(gaps.map((g) => g.id)).toContain('gap-orphan');
      expect(gaps.find((g) => g.id === 'gap-orphan')?.nearestKpIds).toEqual([
        'kp-gone-after-reimport',
      ]);

      await db.query(`DELETE FROM ${schema.name}.content_gaps WHERE id = 'gap-orphan'`);
    });
  });
});
