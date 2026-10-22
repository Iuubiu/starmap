/**
 * 关卡的导出与导入（票 66）。
 *
 * ## 为什么要一个文件格式
 *
 * 关卡现在的唯一载体是库里的 `levels.spec`。这让「把这一关发给同事」「存档到
 * 版本库」「在另一台机器上复现一个 bug」都变成了数据库操作。`.level` 文件把
 * 一张关卡变成一份可以放进 git、可以贴进 issue 的文本。
 *
 * ## 格式的三个决定
 *
 * 1. **`format: 'starmap.level/1'` 是文件格式的版本**，与模板的 `version`、
 *    关卡的 `schemaVersion` 都不是一回事。三者混在一起会让「只是加了一段模板」
 *    变成一次文件格式迁移。
 * 2. **`items` 是摊平的题表，与 `spec.items` 内容相同**。看起来是冗余，但
 *    `spec` 是嵌套结构（题挂在步骤里、卡挂在步骤里），外部工具或人工审阅要
 *    先读懂嵌套才能列出题目。摊平一份是给「不是 StarMap 的读者」的。导入时
 *    会校验两者一致 —— 不一致说明文件被人手改坏了，宁可拒绝也不猜。
 * 3. **`source` 是内容出处**（哪本书、第几页），从 `spec.sources[0]` 派生。
 *    `page` 解析不出来就是 `null`，不猜。
 *
 * ## 导入为什么要换 id
 *
 * `level_items.id` 是**全局主键**，`levels.id` 也是。同一个文件从别人库里导进来，
 * 直接沿用原 id 会和原关卡撞主键；沿用 `spec.meta.id` 也会。所以导入必须重编
 * 一套 id。代价是「导出 → 导入 → 再导出」不可能逐字节相同（id 变了），
 * round-trip 的判据因此写成「**除 id 外**逐字节相同」，测试里按这个判据断言。
 *
 * 重编规则是确定性的（`suffix = shareHash 前 8 位`），所以同一个文件连导两次
 * 得到的是同一张关卡，而不是两张内容一样的关卡 —— 这也是 `share_hash` 那列
 * 存在的意义。
 */

import { createHash } from 'node:crypto';

import { z } from 'zod';
import { LevelItemSchema, type LevelItem, type LevelSpec } from '@starmap/shared';

/** 文件格式版本。整个文件不兼容时才升。 */
export const LEVEL_EXPORT_FORMAT = 'starmap.level/1';

/**
 * 导入时的**形状门**：只验「这是不是一个 starmap.level/1 文件」，不验关卡内容。
 *
 * 为什么不能直接用契约里的 `LevelExportFileSchema` 做这一道：它内嵌了
 * `LevelSpecSchema`，而后者带跨字段 `superRefine`（步骤引用、答案下标、池归属…）。
 * 用它来 parse，内容错误会以「shape 不合法」的身份冒出来，端点只能返回 400 ——
 * 可「文件是 .level 文件、只是关卡内容写错了」应该是 422，且 details 必须是
 * `validateLevelSpec` 那套字段级路径（前端据此定位到哪一段哪一题）。
 *
 * 所以分成两道门：这一道只管信封（format / exportedAt / source / items 是不是数组），
 * 内容交给 `validateLevelSpec`。`spec` 与 `items` 在这里故意留成 unknown。
 */
export const ImportEnvelopeSchema = z.object({
  format: z.literal(LEVEL_EXPORT_FORMAT),
  exportedAt: z.string(),
  source: z.object({
    title: z.string(),
    page: z.number().int().min(0).nullable(),
  }),
  spec: z.unknown(),
  // 摊平题表按 `LevelItemSchema` 逐个验：它是纯对象 schema，没有跨字段 refine，
  // 所以「题目字段写错」仍是形状问题（400），不会被误报成内容问题。
  items: z.array(LevelItemSchema),
});

export type ImportEnvelope = z.infer<typeof ImportEnvelopeSchema>;

/** 导出文件里的内容出处。`page` 解析不出来就是 null，不猜。 */
export interface LevelExportSource {
  title: string;
  page: number | null;
}

/** 导出文件体。字段顺序即序列化顺序（导出幂等要求它稳定）。 */
export interface LevelExportFile {
  format: typeof LEVEL_EXPORT_FORMAT;
  exportedAt: string;
  source: LevelExportSource;
  spec: LevelSpec;
  items: LevelItem[];
}

/**
 * 稳定序列化：对象键递归排序，数组保持原序。
 *
 * 两个用途：① `share_hash` 必须与键顺序无关（同一份内容从不同路径构造出来要
 * 得到同一个 hash）；② 导出幂等 —— 同一个关卡连按两次导出，除 `exportedAt`
 * 外必须逐字节相同，而这只有在序列化稳定时才成立。
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);
  return `{${entries.join(',')}}`;
}

/**
 * 内容指纹：`sha256(spec + items)` 的稳定序列化。
 *
 * 不含 `exportedAt`、不含 `source`（出处是元信息，同一份关卡换了引用页仍然是
 * 同一份内容），也不含 id（id 在导入时会被重编 —— 若 hash 含 id，同一份内容
 * 从两个库导进来会得到两个 hash，去重就失效了）。
 *
 * 但 `spec.meta.id` 在 spec 里，所以计算前先把它剥掉。
 */
export function computeShareHash(spec: LevelSpec, items: readonly LevelItem[]): string {
  const { meta, ...rest } = spec;
  const { id: _levelId, ...metaRest } = meta;
  return createHash('sha256')
    .update(stableStringify({ spec: { meta: metaRest, ...rest }, items }))
    .digest('hex');
}

/**
 * 从 `spec.sources[0]` 派生出处。
 *
 * `locator` 是自由文本（「§2.1.2 逻辑代数基本定律（表 2.1.1）p.34」），只认两种
 * 明确写法：`p.34` / `p34` 与 `第34页`。认不出就是 `null` —— 猜一个页码比没有
 * 页码更糟，它会被当成事实引用。
 */
export function deriveExportSource(spec: LevelSpec): LevelExportSource {
  const first = spec.sources[0];
  const title = first?.ref ?? spec.meta.title;
  const locator = first?.locator ?? '';
  const match = /p\.?\s*(\d+)/i.exec(locator) ?? /第\s*(\d+)\s*页/.exec(locator);
  const page = match?.[1] === undefined ? null : Number(match[1]);
  return { title, page: Number.isFinite(page) && page !== null ? page : null };
}

/** 组装一份导出文件。`exportedAt` 由调用方给（测试要能固定它）。 */
export function buildExportFile(spec: LevelSpec, exportedAt: string): LevelExportFile {
  return {
    format: LEVEL_EXPORT_FORMAT,
    exportedAt,
    source: deriveExportSource(spec),
    spec,
    // 摊平的题表：给不是 StarMap 的读者看。内容必须与 spec.items 一致。
    items: spec.items.map((item) => ({ ...item })),
  };
}

/**
 * 重编 id：给每个 id 加上 `--<suffix>` 后缀。
 *
 * 步骤、卡片、题目三类 id 都要重编（`level_items.id` 是全局主键），引用它们的
 * 地方（`step.cardIds` / `step.itemIds`）必须同步。用后缀而不是「重新编号」：
 * 后缀保留了原 id 的可读前缀，出问题时还能看出「这是从哪一关导进来的」。
 */
export function remapSpecIds(
  spec: LevelSpec,
  newLevelId: string,
  suffix: string,
): LevelSpec {
  const tag = (id: string): string => (id.endsWith(`--${suffix}`) ? id : `${id}--${suffix}`);

  return {
    ...spec,
    meta: { ...spec.meta, id: newLevelId },
    cards: spec.cards.map((card) => ({ ...card, id: tag(card.id) })),
    items: spec.items.map((item) => ({ ...item, id: tag(item.id) })),
    steps: spec.steps.map((step) => ({
      ...step,
      id: tag(step.id),
      cardIds: step.cardIds.map(tag),
      itemIds: step.itemIds.map(tag),
    })),
  };
}

/**
 * 从 shareHash 派生导入后的关卡 id。
 *
 * 确定性是幂等的前提：同一个文件连导两次必须落到同一张关卡上。取 12 位十六
 * 进制（48 bit），碰撞概率远低于「同一个库里出现两份相同内容」这件事本身。
 */
export function importedLevelId(shareHash: string): string {
  return `lv-import-${shareHash.slice(0, 12)}`;
}

/** 导入时重编 id 用的后缀。与 `importedLevelId` 同源，便于从题目 id 反查关卡。 */
export function importedIdSuffix(shareHash: string): string {
  return shareHash.slice(0, 8);
}
