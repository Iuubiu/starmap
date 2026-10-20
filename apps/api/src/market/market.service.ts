import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  MarketSaveLevelRequestSchema,
  type MarketDraftItem,
  type MarketDraftResponse,
  type MarketLevelDetailResponse,
  type MarketLevelListResponse,
  type MarketLevelSummary,
  type MarketSaveLevelRequest,
  type MarketSaveLevelResponse,
  type MarketSpecIssue,
} from '@starmap/api-contract';
import { validateLevelSpec, type LevelSpec } from '@starmap/shared';
import { DatabaseService } from '../db/database.service.js';

/**
 * 关卡市场的写读逻辑。
 *
 * 归属泳道：authoring-dev（票 14）。
 *
 * ## 这里的唯一一条硬规则
 *
 * **保存前必须过 `validateLevelSpec()`**（`@starmap/shared`），且这是唯一的
 * 规则集。播放器（票 04）、内容入库、市场保存三处共用它：如果市场另写一套
 * 宽松校验，就会造出「市场里存得下、播放器打不开」的关卡 —— 那比拒绝保存
 * 糟糕得多，因为错误发生在用户已经相信「保存成功」之后。
 *
 * ## 为什么这里没有「分发」
 *
 * spec.md:496 把「关卡市场的真实分发」列为 Out of Scope。所有写操作都只落
 * 本地 `levels` / `lvl_market` 两张表，没有 publish / share / visibility 概念。
 */

/**
 * 行形状一律写成 `type`：`DatabaseService.query<T>` 的约束是
 * `T extends Record<string, unknown>`，interface 没有隐式索引签名，会在泛型
 * 约束处报 TS2344。
 */
type LevelRow = {
  id: string;
  micro_kp_id: string;
  title: string;
  kind: string;
  ordinal: number;
  spec: unknown;
  micro_kp_name: string | null;
  saved_at: Date | null;
  tags: string[] | null;
};

type AttemptRow = {
  item_id: string;
  correct: boolean;
  created_at: Date;
  stem: string;
  options: unknown;
  answer: unknown;
  explain_correct: string;
  explain_wrong: string;
  misconception_tags: string[] | null;
  source_ref: string | null;
  variant_group: string;
  pool: string;
  level_id: string;
};

/** `levels.kind` 的取值域（数据库 CHECK 也是这三个） */
const LEVEL_KINDS = new Set(['teach', 'quiz', 'mixed']);

/**
 * `level.spec.json` 的 `meta.type` → `levels.kind`。
 *
 * 两套词表是历史遗留（kind 先有，type 是票 04 引入的），但映射必须写在一处：
 * 播放器读 kind 分支、市场读 type，两边各自推导迟早漂移成两种结果。
 */
function kindForType(type: string): 'teach' | 'quiz' {
  return type === 'teaching' ? 'teach' : 'quiz';
}

function authorOf(spec: unknown): MarketLevelSummary['author'] {
  // spec 可能不合法（历史行 `spec = '{}'`）。市场列表不该因为一行坏数据整个 500，
  // 所以这里做的是「尽力读出作者」，读不出就按 system 展示。真正的坏行会在
  // 播放器那边（GET /levels/:id）报出字段级错误，那是它该负责的地方。
  if (typeof spec !== 'object' || spec === null) return 'system';
  const meta = (spec as { meta?: unknown }).meta;
  if (typeof meta !== 'object' || meta === null) return 'system';
  const author = (meta as { author?: unknown }).author;
  return author === 'teacher' || author === 'self' || author === 'ai' ? author : 'system';
}

function itemCountOf(spec: unknown): number {
  if (typeof spec !== 'object' || spec === null) return 0;
  const items = (spec as { items?: unknown }).items;
  return Array.isArray(items) ? items.length : 0;
}

/** 里程碑 id 的稳定来源：同一个知识点重复打包得到同一 id，保存因此是幂等的。 */
function draftLevelId(microKpId: string): string {
  return `lv-self-${microKpId}`;
}

/** 市场登记行的 id。与 level_id 一一对应，重复保存不会换 id。 */
function marketRowId(levelId: string): string {
  return `lm-${levelId}`;
}

function toSummary(row: LevelRow): MarketLevelSummary {
  const kind = LEVEL_KINDS.has(row.kind) ? row.kind : 'teach';
  return {
    levelId: row.id,
    microKpId: row.micro_kp_id,
    microKpName: row.micro_kp_name ?? row.micro_kp_id,
    title: row.title,
    kind: kind as MarketLevelSummary['kind'],
    author: authorOf(row.spec),
    itemCount: itemCountOf(row.spec),
    savedAt: row.saved_at ? row.saved_at.toISOString() : null,
    tags: row.tags ?? [],
    origin: row.saved_at ? 'saved' : 'preset',
  };
}

@Injectable()
export class MarketService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** 预制关卡与自保存关卡放在同一个列表里：市场页是一屏，分组交给前端。 */
  async list(): Promise<MarketLevelListResponse> {
    const rows = await this.db.query<LevelRow>(
      `SELECT l.id, l.micro_kp_id, l.title, l.kind, l.ordinal, l.spec,
              kp.name AS micro_kp_name,
              m.saved_at AS saved_at,
              m.tags AS tags
         FROM levels l
         LEFT JOIN knowledge_points kp ON kp.id = l.micro_kp_id
         LEFT JOIN level_market m ON m.level_id = l.id
        ORDER BY m.saved_at DESC NULLS LAST, l.micro_kp_id, l.ordinal, l.id`,
    );
    return { items: rows.map(toSummary) };
  }

  /**
   * 单张关卡 + 完整 spec。
   *
   * 这里**不做** spec 校验：市场端点的职责是「把存进去的东西原样拿出来给编辑器」，
   * 坏 spec 也照样返回，用户才能看到自己保存的是什么并修好它。真正的把关点有两个：
   * 保存时（本文件 `save()`）与播放时（`LevelsController.get()`）。
   */
  async get(levelId: string): Promise<MarketLevelDetailResponse> {
    const row = await this.findOne(levelId);
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `关卡不存在: ${levelId}` });
    }
    return { level: toSummary(row), spec: row.spec };
  }

  private async findOne(levelId: string): Promise<LevelRow | undefined> {
    const rows = await this.db.query<LevelRow>(
      `SELECT l.id, l.micro_kp_id, l.title, l.kind, l.ordinal, l.spec,
              kp.name AS micro_kp_name,
              m.saved_at AS saved_at,
              m.tags AS tags
         FROM levels l
         LEFT JOIN knowledge_points kp ON kp.id = l.micro_kp_id
         LEFT JOIN level_market m ON m.level_id = l.id
        WHERE l.id = $1`,
      [levelId],
    );
    return rows[0];
  }

  /**
   * 把一个知识点的学习过程打包成关卡草稿（票 14 验收①）。
   *
   * 打包的不是「一段抽象的 spec」，而是**这段学习里真实发生的事**：
   *   - 做过的题（题干、当时对没对、原题带的错因标签）→ 草稿的 items
   *   - 看过的讲解卡 → 草稿的 cards
   *   - 这些内容出自哪些关卡 → `learning.sourceLevelIds`
   *
   * 返回值里的 `issues` 是**预期会有**的：草稿本来就允许不完整，缺什么由
   * `validateLevelSpec()` 逐条报出来，用户在编辑器里补完才允许保存。
   */
  async buildDraft(microKpId: string, sessionId?: string | null): Promise<MarketDraftResponse> {
    const kpRows = await this.db.query<{ id: string; name: string }>(
      `SELECT id, name FROM knowledge_points WHERE id = $1`,
      [microKpId],
    );
    const kp = kpRows[0];
    if (!kp) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `知识点不存在: ${microKpId}` });
    }

    // 会话过滤用的是时间窗而不是 session_id 列：attempts 表没有 session_id
    // （作答是「这一次点提交」的原子事实），sessions 记的是区间。用区间筛才是
    // 对已有数据的忠实读法，而不是给 attempts 补一列并指望历史数据有值。
    let window: { from: Date; to: Date } | null = null;
    if (sessionId) {
      const sessions = await this.db.query<{ started_at: Date; ended_at: Date | null }>(
        `SELECT started_at, ended_at FROM sessions WHERE id = $1`,
        [sessionId],
      );
      const session = sessions[0];
      if (!session) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: `学习会话不存在: ${sessionId}` });
      }
      window = { from: session.started_at, to: session.ended_at ?? new Date() };
    }

    const attempts = await this.db.query<AttemptRow>(
      `SELECT DISTINCT ON (a.item_id)
              a.item_id, a.correct, a.created_at, a.variant_group,
              li.stem, li.options, li.answer, li.explain_correct, li.explain_wrong,
              li.misconception_tags, li.source_ref, li.pool, li.level_id
         FROM attempts a
         JOIN level_items li ON li.id = a.item_id
        WHERE a.micro_kp_id = $1
          AND ($2::timestamptz IS NULL OR a.created_at >= $2)
          AND ($3::timestamptz IS NULL OR a.created_at <= $3)
        ORDER BY a.item_id, a.created_at DESC`,
      [microKpId, window?.from ?? null, window?.to ?? null],
    );

    // 同一道题多次作答时，上面只留最后一次 —— 「涉及哪些题」是题级事实，
    // 「对没对」取最近一次，否则同一道题的两次结果会让草稿的 correct 有歧义。
    const allAttemptRows = await this.db.query<{ total: string; correct: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE correct)::text AS correct
         FROM attempts
        WHERE micro_kp_id = $1
          AND ($2::timestamptz IS NULL OR created_at >= $2)
          AND ($3::timestamptz IS NULL OR created_at <= $3)`,
      [microKpId, window?.from ?? null, window?.to ?? null],
    );
    const attemptCount = Number(allAttemptRows[0]?.total ?? 0);
    const correctCount = Number(allAttemptRows[0]?.correct ?? 0);

    const levels = await this.db.query<{ id: string; spec: unknown }>(
      `SELECT id, spec FROM levels WHERE micro_kp_id = $1 ORDER BY ordinal, id`,
      [microKpId],
    );

    const levelId = draftLevelId(microKpId);
    // 错题排在前面：用户点「打包」时想看的多半是「我做错了什么」。
    const ordered = [...attempts].sort((a, b) => {
      if (a.correct !== b.correct) return a.correct ? 1 : -1;
      return a.created_at > b.created_at ? -1 : 1;
    });

    const items = ordered.map((row, index) => this.toLevelItem(row, levelId, index));
    const cards = collectCards(levels, ordered.map((a) => a.level_id));
    const sources = collectSources(items);

    const itemCount = Math.max(1, items.length);
    const passCount = Math.min(itemCount, Math.max(1, Math.ceil(items.length * 0.6)));

    const draft = {
      schemaVersion: 1,
      meta: {
        id: levelId,
        microKpId,
        title: `${kp.name}：我的学习关卡`,
        type: 'quiz' as const,
        tier: 'P1' as const,
        estimatedMinutes: Math.max(1, items.length * 2),
        author: 'self' as const,
        isEntry: false,
        nextLevelId: null,
      },
      sources,
      cards,
      steps: [
        {
          id: 's-quiz',
          kind: 'quiz' as const,
          title: '这段学习里做过的题',
          cardIds: [],
          itemIds: items.map((i) => i.id),
          requiredCorrect: 0,
        },
        ...(cards.length > 0
          ? [
              {
                id: 's-summary',
                kind: 'summary' as const,
                title: '复盘：这些讲解卡值得再看一遍',
                cardIds: cards.map((c) => c.id),
                itemIds: [],
                requiredCorrect: 0,
              },
            ]
          : []),
      ],
      items,
      gating: { mode: 'exit' as const, itemCount, passCount },
    };

    // 草稿必须自己先过一遍校验器：这样返回的 issues 与「用户点保存时会得到的
    // 错误」是同一份，不会出现「编辑器说没问题、保存说 422」。
    const validated = validateLevelSpec(draft);
    const issues: MarketSpecIssue[] = validated.ok ? [] : validated.issues;

    const draftItems: MarketDraftItem[] = ordered.map((row) => ({
      itemId: row.item_id,
      stem: row.stem,
      correct: row.correct,
      misconceptionTags: row.misconception_tags ?? [],
    }));

    return {
      spec: draft,
      issues,
      learning: {
        microKpId,
        microKpName: kp.name,
        attemptCount,
        correctCount,
        items: draftItems,
        cardIds: cards.map((c) => c.id),
        sourceLevelIds: [...new Set([...ordered.map((a) => a.level_id), ...levels.map((l) => l.id)])],
      },
    };
  }

  private toLevelItem(row: AttemptRow, levelId: string, index: number) {
    const options = Array.isArray(row.options)
      ? row.options.filter((o): o is string => typeof o === 'string')
      : [];
    // 答案在 level_items 里是 jsonb：数字（选项下标）或字符串（填空题）。
    const answer =
      typeof row.answer === 'number'
        ? row.answer
        : typeof row.answer === 'string' && row.answer.length > 0
          ? row.answer
          : 0;

    return {
      // 题目 id 必须跨关卡唯一：`level_items.id` 是主键，attempts 靠它做外键。
      // 用「新关卡 id + 原题序号」而不是沿用原题 id，是为了不把别的关卡的行
      // 抢过来（那会让原关卡在播放时找不到自己的题）。
      id: `${levelId}-i${index}`,
      kind: 'concept' as const,
      stem: row.stem,
      options,
      answer,
      variantGroup: row.variant_group,
      explainCorrect: row.explain_correct,
      explainWrong: row.explain_wrong,
      misconceptionTags: row.misconception_tags ?? [],
      sourceRef: row.source_ref,
      // 原题在判定池（表里叫 quiz）就仍然是 core；练习池的题保持 practice，
      // 草稿不会把练习池的题偷偷升进判定池。
      pool: row.pool === 'practice' ? ('practice' as const) : ('core' as const),
      hintLadder: [] as string[],
    };
  }

  /**
   * 保存自制关卡：**先过校验器，不通过不写库**（票 14 验收②）。
   *
   * 唯一的例外是覆盖自己保存过的同 id 关卡（`created=false`），那仍然是同一条
   * 记录被更新，不是新增非法数据。与系统预制关卡撞 id 直接 409 —— 让一个自制
   * 关卡顶掉内置教学关卡，是用户无法从界面上察觉的破坏。
   */
  async save(body: unknown): Promise<MarketSaveLevelResponse> {
    // 参数本身（spec 是否存在）与 spec 的合法性是两件事，分开报：
    // 请求体不成形是 400（客户端发错了东西），成型但关卡不合法才是 422
    // （客户端发对了、内容不达标）。混成一个码会让前端无法区分「我传错了」
    // 与「用户要改内容」——后者该渲染成字段级错误列表。
    const shape = MarketSaveLevelRequestSchema.safeParse(body);
    if (!shape.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '请求体不合法：spec 必须是关卡 JSON 对象',
        details: shape.error.issues,
      });
    }
    const request: MarketSaveLevelRequest = shape.data;

    const validated = validateLevelSpec(request.spec);
    if (!validated.ok) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: `关卡规范校验不通过（${validated.issues.length} 处），未写入关卡库`,
        details: validated.issues,
      });
    }
    const spec: LevelSpec = validated.spec;
    const levelId = spec.meta.id;

    const kpRows = await this.db.query<{ id: string }>(
      `SELECT id FROM knowledge_points WHERE id = $1`,
      [spec.meta.microKpId],
    );
    if (kpRows.length === 0) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: `关卡指向的知识点不存在: ${spec.meta.microKpId}`,
        details: [{ path: 'meta.microKpId', message: '知识点不存在', code: 'not_found' }],
      });
    }

    const existing = await this.findOwnership(levelId);
    if (existing && !existing.saved) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `关卡 id 与已有系统关卡冲突: ${levelId}，请修改 meta.id`,
        details: [{ path: 'meta.id', message: '该 id 已被系统预制关卡占用', code: 'conflict' }],
      });
    }

    // 题目 id 跨关卡共用一个主键空间。撞上别的关卡的行时不能覆盖 —— 那会把
    // 对方关卡的题抽走（它的 spec 还在，但作答记录再也对不上）。
    const itemIds = spec.items.map((item) => item.id);
    if (itemIds.length > 0) {
      const clashes = await this.db.query<{ id: string; level_id: string }>(
        `SELECT id, level_id FROM level_items WHERE id = ANY($1::text[]) AND level_id <> $2`,
        [itemIds, levelId],
      );
      if (clashes.length > 0) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: `题目 id 已被其他关卡占用: ${clashes.map((c) => c.id).join(', ')}`,
          details: clashes.map((c) => ({
            path: 'items',
            message: `题目 ${c.id} 属于关卡 ${c.level_id}`,
            code: 'conflict',
          })),
        });
      }
    }

    const kind = kindForType(spec.meta.type);
    const tags = request.tags ?? existing?.tags ?? [];
    const ordinal = existing ? existing.ordinal : await this.nextOrdinal(spec.meta.microKpId);

    await this.inTransaction(async (run) => {
      // 六列与 spec 保持一致（level-dev 的约定）：播放器按 id 读 spec，
      // 列表页按 title/kind/ordinal 排序，两边不能各说各话。
      await run(
        `INSERT INTO levels (id, micro_kp_id, title, kind, ordinal, spec)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           micro_kp_id = EXCLUDED.micro_kp_id,
           title       = EXCLUDED.title,
           kind        = EXCLUDED.kind,
           spec        = EXCLUDED.spec`,
        [levelId, spec.meta.microKpId, spec.meta.title, kind, ordinal, JSON.stringify(spec)],
      );

      // 题目同步进 level_items：作答记录（attempts.item_id）靠这张表做外键，
      // 只把题放在 spec 里会让「记录一次作答」无处落。先删后插 = 用 spec 覆盖
      // 这一关卡的题目集合，编辑时删掉的题不会留下孤儿行。
      await run(`DELETE FROM level_items WHERE level_id = $1`, [levelId]);
      for (const item of spec.items) {
        await run(
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
            // 表里的取值域是 ('quiz','practice')，spec 里是 ('core','practice')：
            // 表里的 quiz 对应 spec 的 core（参与判定的正式池）。
            item.pool === 'practice' ? 'practice' : 'quiz',
          ],
        );
      }

      await run(
        `INSERT INTO level_market (id, level_id, title, tags, saved_at)
         VALUES ($1, $2, $3, $4::text[], now())
         ON CONFLICT (level_id) DO UPDATE SET
           title    = EXCLUDED.title,
           tags     = EXCLUDED.tags,
           saved_at = EXCLUDED.saved_at`,
        [marketRowId(levelId), levelId, spec.meta.title, tags],
      );
    });

    const row = await this.findOne(levelId);
    if (!row) {
      // 上面刚写过，读不到说明并发删除或事务外的手工清理；当作服务端错误
      // 比谎报保存成功要好。
      throw new Error(`保存后读不到关卡行: ${levelId}`);
    }
    return { level: toSummary(row), created: !existing };
  }

  private async findOwnership(
    levelId: string,
  ): Promise<{ ordinal: number; saved: boolean; tags: string[] | null } | undefined> {
    const rows = await this.db.query<{ ordinal: number; saved_at: Date | null; tags: string[] | null }>(
      `SELECT l.ordinal,
              m.saved_at AS saved_at,
              m.tags AS tags
         FROM levels l
         LEFT JOIN level_market m ON m.level_id = l.id
        WHERE l.id = $1`,
      [levelId],
    );
    const row = rows[0];
    if (!row) return undefined;
    return { ordinal: row.ordinal, saved: row.saved_at !== null, tags: row.tags };
  }

  private async nextOrdinal(microKpId: string): Promise<number> {
    const rows = await this.db.query<{ next: number }>(
      `SELECT COALESCE(MAX(ordinal), 0) + 1 AS next FROM levels WHERE micro_kp_id = $1`,
      [microKpId],
    );
    return Number(rows[0]?.next ?? 1);
  }

  /**
   * 三条写语句必须同成同败。
   *
   * `DatabaseService` 没有暴露事务原语（它只管连接池与 search_path），所以这里
   * 直接用底层连接开事务。用 `db.query` 递增地执行会让「levels 写了、level_items
   * 只写了一半」成为可能状态 —— 那一刻的关卡在播放器里是坏的。
   */
  private async inTransaction(
    body: (run: (sql: string, params: readonly unknown[]) => Promise<unknown>) => Promise<void>,
  ): Promise<void> {
    const client = await this.db.connection.connect();
    try {
      await client.query('BEGIN');
      await body(async (sql, params) => {
        await client.query(sql, params as unknown[]);
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

/** 讲解卡：从该知识点已有各关卡的 spec 里收集，最多 4 张。 */
function collectCards(
  levels: readonly { id: string; spec: unknown }[],
  preferredLevelIds: readonly string[],
): LevelSpec['cards'] {
  const preferred = new Set(preferredLevelIds);
  const ordered = [...levels].sort((a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id)));
  const seen = new Set<string>();
  const cards: LevelSpec['cards'] = [];
  for (const level of ordered) {
    if (typeof level.spec !== 'object' || level.spec === null) continue;
    const raw = (level.spec as { cards?: unknown }).cards;
    if (!Array.isArray(raw)) continue;
    for (const card of raw) {
      if (typeof card !== 'object' || card === null) continue;
      const c = card as { id?: unknown; title?: unknown; body?: unknown; figureRef?: unknown };
      if (typeof c.id !== 'string' || typeof c.title !== 'string' || typeof c.body !== 'string') continue;
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      cards.push({
        id: c.id,
        title: c.title,
        body: c.body,
        figureRef: typeof c.figureRef === 'string' ? c.figureRef : null,
      });
      if (cards.length >= 4) return cards;
    }
  }
  return cards;
}

/** 草稿的来源清单：题目自带的 sourceRef 汇总，去重后作为 spec.sources。 */
function collectSources(items: readonly { sourceRef: string | null }[]): LevelSpec['sources'] {
  const refs = [...new Set(items.map((i) => i.sourceRef).filter((r): r is string => Boolean(r)))];
  return refs.map((ref) => ({ ref, locator: null }));
}
