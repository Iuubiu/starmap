/**
 * 关卡的导入与导出（票 66）。
 *
 * 纯逻辑（文件形状、hash、id 重编）在 `levels.export.ts`；这一层只做两件需要
 * 数据库的事：读一张关卡拼成文件、把一份文件写进库。
 *
 * ## 为什么导入必须在一个事务里
 *
 * 一次导入写 `levels` 一行 + `level_items` N 行。分两次写会让「关卡行在、题目
 * 只有一半」成为一个可能状态 —— 那一刻的关卡在播放器里是坏的，而且看起来像是
 * 内容作者的错。这与 `market.service.ts` 的 `inTransaction` 是同一个判断。
 *
 * ## 为什么导入前要按 share_hash 查一次
 *
 * 幂等的落点。同一个文件连导两次：第一次新建，第二次返回已有那张（`created:
 * false`）。只靠 `ON CONFLICT` 做不到 —— 关卡 id 是从 hash 派生的，冲突时
 * `DO UPDATE` 会把已有的关卡内容覆盖掉，而用户期待的是「它已经在了」。
 * 所以先查后写，`ON CONFLICT DO NOTHING` 兜住并发窗口。
 */

import { Injectable, Inject } from '@nestjs/common';

import { validateLevelSpec, type LevelItem, type LevelSpec } from '@starmap/shared';
import type { LevelExportFileView } from '@starmap/api-contract';

import { DatabaseService } from '../db/database.service.js';
import {
  buildExportFile,
  computeShareHash,
  importedIdSuffix,
  importedLevelId,
  remapSpecIds,
} from './levels.export.js';

/** 行形状用 type：`DatabaseService.query<T>` 要求 `T extends Record<string, unknown>`。 */
type LevelRow = {
  id: string;
  micro_kp_id: string;
  title: string;
  kind: string;
  ordinal: number;
  spec: unknown;
};

type ExistingImportRow = { id: string };

/** 导入结果。`created=false` 表示同一份内容已经在库里，返回的是已有那张。 */
export interface ImportOutcome {
  levelId: string;
  created: boolean;
  shareHash: string;
  itemCount: number;
}

/** `levels.kind` 的取值域是 ('teach','quiz','mixed')，与 spec 的 type 不是一回事。 */
function kindForType(type: LevelSpec['meta']['type']): 'teach' | 'quiz' {
  return type === 'teaching' ? 'teach' : 'quiz';
}

@Injectable()
export class LevelsTransferService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /**
   * 导出一张关卡。
   *
   * `exportedAt` 由调用方传（默认 `db.now()`），因为「同一个关卡连按两次导出，
   * 除 `exportedAt` 外字节相同」这条验收要求时间戳是唯一变量 —— 测试要能固定它。
   */
  async exportLevel(levelId: string, exportedAt?: string): Promise<LevelExportFileView> {
    const rows = await this.db.query<LevelRow>(
      `SELECT id, micro_kp_id, title, kind, ordinal, spec
         FROM levels
        WHERE id = $1`,
      [levelId],
    );
    const row = rows[0];
    if (!row) return this.missing(levelId);

    // 库里存了坏 spec 是服务端数据问题：导出会把它传播出去，所以先校验。
    const validated = validateLevelSpec(row.spec);
    if (!validated.ok) {
      // 这里不抛 HTTP 异常 —— 服务层不依赖 @nestjs/common 的响应形状，
      // 由控制器把 `issues` 转成 500 + details（与 GET /levels/:id 一致）。
      throw Object.assign(new Error(`关卡规范不合法: ${levelId}`), {
        code: 'INVALID_SPEC',
        details: validated.issues,
      });
    }

    const at = exportedAt ?? (await this.db.now());
    return buildExportFile(validated.spec, at);
  }

  /**
   * 导入一份文件。
   *
   * 三步：校验 → 算指纹 → 查重后写入。校验用 shared 的 `validateLevelSpec`
   * （与作者保存、AI 生成同一个真源），所以错误路径也是同一套 `{path,message,code}`。
   *
   * 校验**在**事务之前：非法文件不该开事务，也不该留下任何痕迹。
   */
  async importLevel(file: LevelExportFileView): Promise<ImportOutcome> {
    const validated = validateLevelSpec(file.spec);
    if (!validated.ok) {
      throw Object.assign(new Error('导入的关卡规范不合法'), {
        code: 'INVALID_SPEC',
        details: validated.issues,
      });
    }
    const spec = validated.spec;

    // 文件里摊平的 `items` 必须与 `spec.items` 一致。不一致说明有人手改坏了
    // 文件（改了题却忘了改 spec），这时「信哪一份」没有正确答案 —— 拒绝。
    const mismatch = describeItemsMismatch(spec.items, file.items);
    if (mismatch !== null) {
      throw Object.assign(new Error(mismatch), {
        code: 'INVALID_SPEC',
        details: [{ path: 'items', message: mismatch, code: 'custom' }],
      });
    }

    const shareHash = computeShareHash(spec, spec.items);

    // 幂等：同一份内容已经在了就返回已有那张，不覆盖、不新建。
    const existing = await this.db.query<ExistingImportRow>(
      `SELECT id
         FROM levels
        WHERE share_hash = $1 AND origin = 'imported'
        LIMIT 1`,
      [shareHash],
    );
    const already = existing[0];
    if (already) {
      return { levelId: already.id, created: false, shareHash, itemCount: spec.items.length };
    }

    const levelId = importedLevelId(shareHash);
    const suffix = importedIdSuffix(shareHash);
    const imported = remapSpecIds(spec, levelId, suffix);
    const ordinal = await this.nextOrdinal(imported.meta.microKpId);

    await this.inTransaction(async (run) => {
      // `ON CONFLICT (id) DO NOTHING` 而不是 DO UPDATE：并发导入同一份文件时，
      // 后到的那次什么都不做，然后由下面的「读回来」判断 created。用 DO UPDATE
      // 会把先到那次刚写的内容再覆盖一遍（虽然内容相同，但 updated_at 之类会动，
      // 更重要的是掩盖了「这是重复导入」这个事实）。
      const inserted = await run(
        `INSERT INTO levels (id, micro_kp_id, title, kind, ordinal, spec, template_id, origin, share_hash)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, NULL, 'imported', $7)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          levelId,
          imported.meta.microKpId,
          imported.meta.title,
          kindForType(imported.meta.type),
          ordinal,
          JSON.stringify(imported),
          shareHash,
        ],
      );

      // 没有 RETURNING 行 = 有人抢先插了同一 id。题目行归先到的那次，本次不写。
      if (inserted.length === 0) return;

      for (const item of imported.items) {
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
            // 表里的取值域是 ('quiz','practice')，spec 里是 ('core','practice')。
            // 与 market.service.ts 的映射必须一致，否则同一道题在两条写路径里
            // 会落到不同的池子，复验抽题时会「有时抽得到、有时抽不到」。
            item.pool === 'practice' ? 'practice' : 'quiz',
          ],
        );
      }
    });

    // 事务里可能被别人抢先插入（DO NOTHING 分支），所以 created 以「这一行是不是
    // 本次写的」为准 —— 再查一次 share_hash 看命中的是不是我们想写的那张。
    const after = await this.db.query<ExistingImportRow>(
      `SELECT id FROM levels WHERE share_hash = $1 AND origin = 'imported' LIMIT 1`,
      [shareHash],
    );
    const finalId = after[0]?.id ?? levelId;
    return {
      levelId: finalId,
      created: finalId === levelId,
      shareHash,
      itemCount: imported.items.length,
    };
  }

  private missing(levelId: string): never {
    throw Object.assign(new Error(`关卡不存在: ${levelId}`), { code: 'NOT_FOUND' });
  }

  private async nextOrdinal(microKpId: string): Promise<number> {
    const rows = await this.db.query<{ next: number }>(
      `SELECT COALESCE(MAX(ordinal), 0) + 1 AS next FROM levels WHERE micro_kp_id = $1`,
      [microKpId],
    );
    return Number(rows[0]?.next ?? 1);
  }

  /**
   * 事务原语。`DatabaseService` 只管连接池与 search_path，不暴露事务，
   * 所以这里直接用底层连接 —— 与 `market.service.ts#inTransaction` 同形。
   */
  private async inTransaction(
    body: (run: (sql: string, params: readonly unknown[]) => Promise<unknown[]>) => Promise<void>,
  ): Promise<void> {
    const client = await this.db.connection.connect();
    try {
      await client.query('BEGIN');
      await body(async (sql, params) => {
        const result = await client.query(sql, params as unknown[]);
        return result.rows as unknown[];
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

/**
 * 摊平题表与 `spec.items` 的一致性检查。返回 `null` 表示一致。
 *
 * 只比「同 id 的题内容是否相同」与「id 集合是否相同」，不比顺序：摊平表是给人
 * 读的，重排一下不该算错。真正会被手改坏的是内容（改了题干忘了改 spec），
 * 那正是这条要拦的。
 */
function describeItemsMismatch(
  specItems: readonly LevelItem[],
  fileItems: readonly LevelItem[],
): string | null {
  if (specItems.length !== fileItems.length) {
    return `文件里的 items 有 ${fileItems.length} 道，spec.items 有 ${specItems.length} 道，两者必须一致`;
  }
  const byId = new Map(fileItems.map((item) => [item.id, item]));
  for (const item of specItems) {
    const flat = byId.get(item.id);
    if (!flat) return `文件里的 items 缺少题目 ${item.id}（spec.items 里有）`;
    // 逐字段比：题干、选项、答案、两条反馈、变式组、池、来源。
    const same =
      flat.stem === item.stem &&
      flat.answer === item.answer &&
      flat.explainCorrect === item.explainCorrect &&
      flat.explainWrong === item.explainWrong &&
      flat.variantGroup === item.variantGroup &&
      flat.pool === item.pool &&
      flat.sourceRef === item.sourceRef &&
      JSON.stringify(flat.options) === JSON.stringify(item.options);
    if (!same) {
      return `题目 ${item.id} 在 items 与 spec.items 里的内容不一致（文件被手改过？）`;
    }
  }
  return null;
}
