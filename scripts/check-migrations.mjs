/**
 * 迁移一致性与可回滚检查。
 *
 * `pnpm verify` 里原来只有 typecheck / boundaries / test 三道门，迁移的
 * 「能不能退回去」不在任何一道门里。`apps/api/src/db/migrations.test.ts`
 * 守了几条静态不变量（配对文件、幂等写法），但它自己的注释就写着：
 *
 *     「真跑 up/down 的往返由 `pnpm db:rollback && pnpm db:migrate` 在 CI 里做」
 *
 * —— 而仓库里没有任何 CI，也没有人真的会去跑那条。于是「下行脚本写错了」
 * 这类错误要等到真的需要回滚的那天才暴露，那时是在生产上。
 *
 * 本脚本做三件事，按「坏了有多贵」排序：
 *
 *   1. **动态回滚**（最贵的那种错）：在一个一次性 schema 上真跑一遍
 *      up → down → 断言没有残留。这是唯一能抓住「down 少删了一张表 /
 *      删错了对象 / 顺序错了导致外键挡住」的手段，静态读文件都抓不到。
 *
 *   2. **编号撞车**：两个不同名字的迁移占同一个 NNNN。`migrate.ts` 按文件名
 *      排序执行、按文件名记录版本，同号两个文件不会报错，只会按字典序跑，
 *      而「谁先谁后」在这里是有语义的（后面的可能依赖前面的表）。
 *
 *   3. **配对缺失**：有 up 没 down。`migrations.test.ts` 已经守了这条，
 *      这里再做一遍不是为了重复计分，而是为了让本脚本单独跑时结论完整 ——
 *      一个检查器不该要求你先跑另一个检查器才有完整结论。
 *
 * ## 不检查编号连续
 *
 * 编号是**泳道分区**而不是序号：0001-0009 共享面、0010-0019 关卡、
 * 0020-0029 智能体、0040-0049 自制关卡。中间的空号是有意留的，将来每条
 * 泳道还要往里插。检查连续会在每次插号时误报，误报几次之后这个门就会
 * 被人加 `|| true` 绕过 —— 那时它连真问题也拦不住了。
 *
 * ## 为什么不复用 `apps/api/scripts/migrate.ts`
 *
 * 那个脚本操作的是**真实库的 app schema**：它 `CREATE SCHEMA IF NOT EXISTS app`、
 * 建 `app.schema_migrations`、按版本表跳过。检查器需要的是相反的行为 ——
 * 在一个用完就删的 schema 里，无视版本表，把每个文件都跑一遍。两者对
 * 「执行哪些文件、在哪个 schema、要不要记版本」的答案全都不同，共用一个
 * 实现只会让两边都长出开关。重复的是二十行 SQL 执行逻辑，换来的是
 * 「跑检查绝不会碰到真实库」这条结构性保证。
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// 目录可用环境变量覆盖：`scripts/check-migrations.probe.mjs` 拿一份故意写坏的
// 迁移副本跑本脚本，证明「回滚脚本什么都没删」这件事真的会红。一个从没红过的
// 检查无法区分「没问题」和「没检查」。
const migrationsDir =
  process.env.MIGRATIONS_DIR ?? join(root, 'apps', 'api', 'migrations');

/** 与 `apps/api/scripts/migrate.ts` 和 `database.service.ts` 保持同一个 fallback。 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap';

// pg 装在 apps/api 下，仓库根没有。用 createRequire 从那个 package 解析，
// 而不是给根 package.json 加一个只为检查脚本存在的依赖。
const requireApi = createRequire(join(root, 'apps', 'api', 'package.json'));

// ---------------------------------------------------------------------------
// 文件层：找出所有迁移、检查编号与配对（不需要数据库）
// ---------------------------------------------------------------------------

/** 上行迁移。`seed.sql` 不是迁移（它是演示数据，没有也不该有回滚脚本）。 */
function listUpMigrations() {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql') && !f.startsWith('seed'))
    .sort();
}

const upFiles = listUpMigrations();

/**
 * 从文件名取出编号与名字。命名不合法（没有 `NNNN_` 前缀）直接报错而不是
 * 跳过：`migrate.ts` 的 `upFiles()` 只过滤扩展名，一个叫 `add_index.sql`
 * 的文件会被它照常执行、并按 `add_index` 记进版本表，然后永远排在 0001
 * 前面跑（字典序）。这种文件必须在落盘那一刻就被拒绝。
 */
function parseMigrationName(file) {
  const m = /^(\d{4})_(.+)$/.exec(file.replace(/\.sql$/, ''));
  if (!m) return null;
  return { number: m[1], slug: m[2] };
}

const checks = [];

function record(id, title, status, detail) {
  checks.push({ id, title, status, detail });
}

// ---- 检查 1：文件名格式 + 编号撞车 --------------------------------------

{
  const malformed = upFiles.filter((f) => !parseMigrationName(f));
  const byNumber = new Map();
  for (const f of upFiles) {
    const parsed = parseMigrationName(f);
    if (!parsed) continue;
    byNumber.set(parsed.number, [...(byNumber.get(parsed.number) ?? []), f]);
  }
  const collided = [...byNumber.entries()].filter(([, files]) => files.length > 1);

  const problems = [];
  if (malformed.length) {
    problems.push(
      `文件名缺少 NNNN_ 前缀（migrate.ts 按文件名排序执行，这类文件会排到 0001 前面）：\n` +
        malformed.map((f) => `    ${f}`).join('\n'),
    );
  }
  if (collided.length) {
    problems.push(
      `同一编号被多个迁移占用（执行顺序退化成字典序，而顺序在这里有语义）：\n` +
        collided
          .map(([num, files]) => `    ${num} → ${files.join(' , ')}`)
          .join('\n') +
        `\n    编号是泳道分区：0001-0009 共享面 / 0010-0019 关卡 / 0020-0029 智能体 / 0040-0049 自制关卡。`,
    );
  }

  record(
    'numbering',
    '迁移编号：格式合法且不撞号',
    problems.length ? 'failed' : 'passed',
    problems.length ? problems.join('\n\n') : `${upFiles.length} 个迁移，编号无冲突`,
  );
}

// ---- 检查 2：配对 --------------------------------------------------------

{
  const missing = upFiles.filter(
    (f) => !existsSync(join(migrationsDir, f.replace(/\.sql$/, '.down.sql'))),
  );
  const orphanDown = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.down.sql'))
    .filter((f) => !existsSync(join(migrationsDir, f.replace(/\.down\.sql$/, '.sql'))));

  const problems = [];
  if (missing.length) {
    problems.push(
      `有上行迁移但没有配对的下行脚本：\n` + missing.map((f) => `    ${f}`).join('\n'),
    );
  }
  if (orphanDown.length) {
    problems.push(
      `有下行脚本但找不到对应的上行迁移（改名时漏了？）：\n` +
        orphanDown.map((f) => `    ${f}`).join('\n'),
    );
  }
  record(
    'pairing',
    '每个上行迁移都有配对的下行脚本',
    problems.length ? 'failed' : 'passed',
    problems.length ? problems.join('\n\n') : `${upFiles.length} 对 up/down 全部配对`,
  );
}

// ---------------------------------------------------------------------------
// 数据库层：在一次性 schema 上真跑 up → down
// ---------------------------------------------------------------------------

/**
 * 把迁移里的 `app.` 重定向到一次性 schema。
 *
 * 两个必须处理的点：
 *
 * 1. `app.xxx` 带点的形式是最常见的，直接 replaceAll。
 * 2. **裸 `app`（不带点）必须单独处理。** 当前只有一处：
 *    `0001_init.down.sql` 的 `DROP SCHEMA IF EXISTS app CASCADE;`。它是有意的
 *    （0001 建的是整个 app schema），但如果原样执行，检查会去删**真实库里
 *    的 app schema** —— 一次「跑个检查」就清空了开发库。这不是理论风险：
 *    本脚本第一版就差点这么干。
 *
 *    替换前先确认没有字符串字面量 `'app'` / `"app"`（当前零处）。有的话
 *    直接失败并要人来看，因为「引号里的 app」和「标识符 app」在 SQL 里
 *    是两种东西，正则替换分不清哪个该动。
 */
function redirectSchema(sql, schema) {
  const withoutComments = sql.replace(/--[^\n]*/g, '');
  const quoted = withoutComments.match(/'app'|"app"/g);
  if (quoted) {
    throw new Error(
      `迁移里出现引号包裹的 'app' 字面量（${quoted.length} 处），无法安全重定向到检查用 schema。` +
        `请人来看：字符串常量和标识符需要不同的处理。`,
    );
  }
  return sql.replaceAll('app.', `${schema}.`).replace(/(?<![\w.])app(?![\w.])/g, schema);
}

/** 一次性的业务表残留查询：排除检查用 schema 自己的记账表。 */
const LEFTOVER_SQL = `
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = $1
  ORDER BY table_name
`;

/** 索引残留单独查：`DROP TABLE` 不会自动删掉被人手工建在别处的索引。 */
const LEFTOVER_INDEX_SQL = `
  SELECT indexname
  FROM pg_indexes
  WHERE schemaname = $1
  ORDER BY indexname
`;

async function checkRoundTrip(client) {
  const schema = `mig_check_${randomBytes(6).toString('hex')}`;
  const failures = [];

  // 一次性 schema 里先建好版本表：`0010` 用 `to_regclass('app.schema_migrations')`
  // 判断「这是真实库还是临时 schema」，没有版本表它就直接 RETURN、什么都不插。
  // 不建的话，0010 的回滚会变成「删 0 行」—— 通过，但什么都没验到。
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(
    `CREATE TABLE ${schema}.schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
  );

  try {
    // 先把每个 up 的「它建了什么」记下来，down 之后再来看这些名字还在不在。
    // 光看「up 之后有几张表、down 之后是不是 0 张」不够：一张表建了又没删，
    // 但另一张表重复建（IF NOT EXISTS 不报错），总数可能仍然对得上。
    const createdObjects = [];

    for (const file of upFiles) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      try {
        await client.query(redirectSchema(sql, schema));
      } catch (err) {
        failures.push(`上行 ${file} 执行失败：${err.message}`);
        return { schema, failures, createdObjects };
      }
      for (const m of sql.matchAll(
        /CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:app\.)?([a-z_0-9]+)/gi,
      )) {
        createdObjects.push({ file, name: m[1] });
      }
      for (const m of sql.matchAll(/ALTER\s+TABLE\s+app\.([a-z_0-9]+)\s+ADD\s+COLUMN[^;]*?\b([a-z_0-9]+)\b/gi)) {
        createdObjects.push({ file, name: `${m[1]}.${m[2]}`, column: true });
      }
    }

    // 倒序回滚，与 `migrate.ts` 的 down 行为一致（它 `[...files].reverse()`）。
    for (const file of [...upFiles].reverse()) {
      const downPath = join(migrationsDir, file.replace(/\.sql$/, '.down.sql'));
      if (!existsSync(downPath)) {
        failures.push(`缺少下行脚本：${file.replace(/\.sql$/, '.down.sql')}`);
        continue;
      }
      const sql = readFileSync(downPath, 'utf8');
      try {
        await client.query(redirectSchema(sql, schema));
      } catch (err) {
        failures.push(`下行 ${file.replace(/\.sql$/, '.down.sql')} 执行失败：${err.message}`);
      }
    }

    const tables = (await client.query(LEFTOVER_SQL, [schema])).rows
      .map((r) => r.table_name)
      .filter((t) => t !== 'schema_migrations');
    const indexes = (await client.query(LEFTOVER_INDEX_SQL, [schema])).rows.map(
      (r) => r.indexname,
    );

    if (tables.length) {
      failures.push(`回滚后仍残留业务表：${tables.join(', ')}`);
    }
    if (indexes.length) {
      failures.push(`回滚后仍残留索引：${indexes.join(', ')}`);
    }

    return { schema, failures, createdObjects };
  } finally {
    // 无论成败都清掉。这里用 DROP SCHEMA ... CASCADE 是对的：整个 schema 是
    // 本函数现造的，删它不可能波及任何别人的东西。
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
}

async function runDatabaseCheck() {
  let Client;
  try {
    ({ Client } = requireApi('pg'));
  } catch {
    record(
      'roundtrip',
      '下行脚本真的能回滚（up → down → 无残留）',
      'skipped',
      '解析不到 pg（apps/api/node_modules 里没有）。跳过动态回滚验证 —— 这不是通过。',
    );
    return;
  }

  const client = new Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
  } catch (err) {
    record(
      'roundtrip',
      '下行脚本真的能回滚（up → down → 无残留）',
      'skipped',
      `连不上数据库（${DATABASE_URL}）：${err.message}\n` +
        `    → 先起库：pwsh -File scripts/db-up.ps1（或 docker compose --profile container up -d）\n` +
        `    跳过不等于通过：回滚脚本这次没有被验证过。`,
    );
    return;
  }

  try {
    const { failures, createdObjects } = await checkRoundTrip(client);
    if (failures.length) {
      record('roundtrip', '下行脚本真的能回滚（up → down → 无残留）', 'failed', failures.join('\n'));
    } else {
      record(
        'roundtrip',
        '下行脚本真的能回滚（up → down → 无残留）',
        'passed',
        `${upFiles.length} 个迁移在一次性 schema 上 up → down 往返成功，` +
          `建了 ${createdObjects.length} 个对象，回滚后无残留表、无残留索引`,
      );
    }
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

const SKIP = process.env.MIGRATIONS_SKIP_DB === '1';
if (SKIP) {
  record(
    'roundtrip',
    '下行脚本真的能回滚（up → down → 无残留）',
    'skipped',
    'MIGRATIONS_SKIP_DB=1，按要求跳过。跳过不等于通过。',
  );
} else {
  await runDatabaseCheck();
}

const ICON = { passed: '✓', failed: '✗', skipped: '·' };
for (const c of checks) {
  const line = `${ICON[c.status]} ${c.title}`;
  if (c.status === 'passed') console.log(`${line} — ${c.detail}`);
  else console.log(`${line}\n  ${c.detail}`);
}

const failed = checks.filter((c) => c.status === 'failed');
const skipped = checks.filter((c) => c.status === 'skipped');

console.log('');
if (failed.length) {
  console.error(`✗ 迁移检查失败（${failed.length} 项）`);
  process.exit(1);
}
if (skipped.length) {
  // 跳过不判红，但要在输出里留痕：一个从没被验证过的回滚脚本，和验证过的
  // 是两件事，不该因为「这次没连上库」而在报告里长得一样。
  console.log(`✓ 迁移检查通过（${checks.length - skipped.length} 项通过，${skipped.length} 项跳过）`);
  process.exit(0);
}
console.log(`✓ 迁移检查通过（${checks.length} 项）`);
