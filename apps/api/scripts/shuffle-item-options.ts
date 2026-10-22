/**
 * 一次性回填：把 AI 生成关卡（`lv-ai-*`）的选项顺序重排，让正确答案不再
 * 挤在下标 0。
 *
 * ## 为什么需要回填
 *
 * `shuffleOptions()` 只在**新生成**时生效。库里已有的 44 道题是修复前生成的：
 * 37 道答案在下标 0，其中 5 道题 5/5 全是 0 —— 学生永远点第一个就能满分。
 * 对已经存在的关卡，只能就地重排。
 *
 * ## 为什么两级都要改
 *
 * 题目同时存两处：`app.level_items`（作答与判分读它）与 `app.levels.spec`
 * 的 `items[]`（关卡详情接口与门控读它）。只改一处会让界面显示的选项顺序与
 * 判分用的下标错位 —— 那是比不修更坏的结果。所以两处按同一个 item id 成对更新，
 * 且必须在同一事务里。
 *
 * ## 只动 AI 生成的题
 *
 * `lv-bool-laws` 是手写关卡，选项顺序可能是有意的（比如「以上都对」这类
 * 依赖位置的选项）。本脚本只处理 id 以 `lv-ai-` 开头的关卡。
 *
 * 用法：`cd apps/api && pnpm shuffle:items`（可加 `--dry-run` 只打印）
 */
import { Client } from 'pg';
import { shuffleOptions } from '../src/generation/level-assembly.js';

const DRY = process.argv.includes('--dry-run');

interface ItemRow {
  id: string;
  level_id: string;
  options: string[];
  answer: number;
}

async function main(): Promise<void> {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5432/starmap',
    options: '-c search_path=app,public',
  });
  await client.connect();

  try {
    const { rows } = await client.query<ItemRow>(
      `SELECT id, level_id, options, answer
         FROM level_items
        WHERE level_id LIKE 'lv-ai-%'
        ORDER BY level_id, id`,
    );
    console.log(`待处理：${rows.length} 道题（仅 lv-ai-*）`);
    if (rows.length === 0) return;

    const before = new Map<string, number>();
    const updates: { id: string; options: string[]; answer: number }[] = [];
    for (const row of rows) {
      const opts = row.options ?? [];
      if (opts.length < 2) continue;
      const out = shuffleOptions({ id: row.id, options: opts, answer: row.answer });
      before.set(row.id, row.answer);
      updates.push({ id: row.id, options: out.options, answer: out.answer });
    }
    const moved = updates.filter((u) => before.get(u.id) !== u.answer).length;
    console.log(`其中 ${moved} 道的答案下标发生变化`);

    if (DRY) {
      for (const u of updates.slice(0, 5)) {
        console.log(`  ${u.id}: ${before.get(u.id)} → ${u.answer}`);
      }
      console.log('（--dry-run，未写库）');
      return;
    }

    await client.query('BEGIN');
    for (const u of updates) {
      // 1) 关系表
      await client.query(`UPDATE level_items SET options = $2::jsonb, answer = $3::jsonb WHERE id = $1`, [
        u.id,
        JSON.stringify(u.options),
        JSON.stringify(u.answer),
      ]);
    }

    // 2) spec 里的 items[]：按 item id 成对替换 options/answer
    const levelIds = [...new Set(rows.map((r) => r.level_id))];
    for (const levelId of levelIds) {
      const { rows: lv } = await client.query<{ spec: Record<string, unknown> }>(
        'SELECT spec FROM levels WHERE id = $1',
        [levelId],
      );
      const spec = lv[0]?.spec;
      if (!spec || !Array.isArray(spec['items'])) continue;
      const byId = new Map(updates.map((u) => [u.id, u]));
      const items = spec['items'] as Record<string, unknown>[];
      let touched = 0;
      for (const item of items) {
        const id = typeof item['id'] === 'string' ? item['id'] : '';
        const u = byId.get(id);
        if (!u) continue;
        item['options'] = u.options;
        item['answer'] = u.answer;
        touched += 1;
      }
      if (touched > 0) {
        await client.query('UPDATE levels SET spec = $2::jsonb WHERE id = $1', [
          levelId,
          JSON.stringify(spec),
        ]);
        console.log(`  ${levelId}: spec.items 更新 ${touched} 道`);
      }
    }
    await client.query('COMMIT');

    // 复核：重新统计下标分布
    const { rows: dist } = await client.query<{ idx: string; n: string }>(
      `SELECT answer::text AS idx, count(*)::text AS n
         FROM level_items WHERE level_id LIKE 'lv-ai-%'
        GROUP BY 1 ORDER BY 1`,
    );
    console.log('回填后答案下标分布：', dist.map((d) => `${d.idx}:${d.n}`).join('  '));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  console.error('回填失败：', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
