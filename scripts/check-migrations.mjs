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
 * 编号是**泳道分区**而不是序号。中间的空号是有意留的，将来每条泳道还要
 * 往里插。检查连续会在每次插号时误报，误报几次之后这个门就会被人加
 * `|| true` 绕过 —— 那时它连真问题也拦不住了。
 *
 * 分区表（**新迁移按自己泳道的号段取，不要抢别人的号**）：
 *
 * | 号段 | 归属 | 现状 |
 * | --- | --- | --- |
 * | 0001-0009 | 共享面（integrator） | 0001 初始化 / 0002 内容归属 / 0003 图谱与复验 |
 * | 0010-0019 | 关卡与掌握度（level-dev） | 0010 布尔代数教学关 |
 * | 0020-0029 | 智能体与检索（agent-dev） | 0020 回合 / 0021 追问 / 0022 技能注册 |
 * | 0030-0039 | 内容与图谱（content-dev） | 尚未使用 |
 * | 0040-0049 | 自制关卡与市场（authoring-dev） | 0040 关卡市场 |
 *
 * 撞号检查（下面的 `numbering`）只能事后发现，分区表让人在写文件之前就
 * 选对号 —— 两者不重复，前者是兜底。
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

/** 某个列还在不在。 */
const COLUMN_EXISTS_SQL = `
  SELECT count(*)::int AS n
  FROM information_schema.columns
  WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
`;

/** 某个表当前有多少行。用于判断「内容迁移的 down 到底删没删东西」。 */
async function totalRows(client, schema) {
  const tables = (await client.query(LEFTOVER_SQL, [schema])).rows
    .map((r) => r.table_name)
    .filter((t) => t !== 'schema_migrations');
  let total = 0;
  for (const t of tables) {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${schema}."${t}"`);
    total += rows[0].n;
  }
  return total;
}

/**
 * 每个文件「它建了什么」——表、索引、列。回滚时逐个来问这些东西还在不在。
 *
 * 用「这个文件建的对象」而不是「schema 里还剩几张表」作为判据，是因为后者
 * 会被 `0001_init.down.sql` 的 `DROP SCHEMA ... CASCADE` 一次性抹平：只要
 * 0001 的 down 跑了，前面任何泳道的 down 少删了什么都看不出来。本脚本的
 * 第一版正是这么写的，往 `0022` 的 down 里写「什么都不做」它照样报绿。
 */
function createdObjectsOf(sql) {
  const objects = [];
  for (const m of sql.matchAll(
    /CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+(IF\s+NOT\s+EXISTS\s+)?(?:app\.)?([a-z_0-9]+)/gi,
  )) {
    objects.push({ kind: m[2].toLowerCase(), name: m[4] });
  }
  for (const m of sql.matchAll(
    /ALTER\s+TABLE\s+(?:ONLY\s+)?app\.([a-z_0-9]+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_0-9]+)/gi,
  )) {
    // 注意可选前缀 `IF NOT EXISTS` 必须显式吃掉：用非贪婪 `[^;]*?` 去接列名
    // 会把 `IF` 抓成列名，于是检查在查一个不存在的列、永远「已删除」。
    objects.push({ kind: 'column', table: m[1], name: m[2] });
  }
  return objects;
}

/** 这个上行文件写了 INSERT 吗（内容迁移的判据）。 */
function hasInsert(sql) {
  return /^\s*INSERT\s+INTO/im.test(sql) || /\bINSERT\s+INTO\b/i.test(sql);
}

/**
 * 上行文件改过哪些列的默认值。
 *
 * 这一类改动 `createdObjectsOf` 完全看不见：它既没有 CREATE 也没有 ADD COLUMN，
 * 只是把某一列的 DEFAULT 拿掉或换掉。`0004_drop_stale_seed_level.sql` 正是
 * 这种形状（`DELETE` 两行 + `ALTER COLUMN spec DROP DEFAULT`），于是探针实测
 * 出一个盲区：**把它的 down 写成只有一行注释，检查照样报绿。**
 *
 * 判据取「down 跑完之后，这一列的默认值和 down 跑之前不一样」。因为 down 的
 * 职责就是撤销 up 做过的改动 —— 值没变就说明它什么都没做。这对 SET 和 DROP
 * 两个方向都成立，也不需要读懂 DEFAULT 表达式是什么。
 */
function alteredDefaultsOf(sql) {
  const out = [];
  for (const m of sql.matchAll(
    /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:app\.)?([a-z_0-9]+)\s+ALTER\s+COLUMN\s+([a-z_0-9]+)\s+(SET\s+DEFAULT|DROP\s+DEFAULT)/gi,
  )) {
    out.push({ table: m[1], column: m[2], action: /drop/i.test(m[3]) ? 'drop' : 'set' });
  }
  return out;
}

/** 某一列当前的默认值表达式；列不存在返回 `undefined`，「没有默认值」返回 `null`。 */
const COLUMN_DEFAULT_SQL = `
  SELECT column_default
  FROM information_schema.columns
  WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
`;

async function columnDefault(client, schema, table, column) {
  const { rows } = await client.query(COLUMN_DEFAULT_SQL, [schema, table, column]);
  return rows.length ? rows[0].column_default : undefined;
}

async function objectExists(client, schema, obj) {
  if (obj.kind === 'column') {
    const { rows } = await client.query(COLUMN_EXISTS_SQL, [schema, obj.table, obj.name]);
    return rows[0].n > 0;
  }
  if (obj.kind === 'table') {
    const { rows } = await client.query(LEFTOVER_SQL, [schema]);
    return rows.some((r) => r.table_name === obj.name);
  }
  const { rows } = await client.query(LEFTOVER_INDEX_SQL, [schema]);
  return rows.some((r) => r.indexname === obj.name);
}

async function checkRoundTrip(client) {
  const schema = `mig_check_${randomBytes(6).toString('hex')}`;
  const failures = [];
  /**
   * 每个迁移「被动态核对了几件事」。
   *
   * 存在的理由：某个迁移只删数据、down 又有意不恢复（`0005_drop_stale_seed_mastery`
   * 就是这样），它在对象 / 默认值 / 行数三类判据里都是 0 件，于是一个都没被验过，
   * 而总结句写的是「N 个迁移逐个 up → down」—— 读起来像每个都被验了。计数为 0
   * 的文件必须在输出里单独点名，否则这句总结比事实强。
   */
  const checksByFile = new Map();
  const bump = (file) => checksByFile.set(file, (checksByFile.get(file) ?? 0) + 1);
  const unverified = () => upFiles.filter((f) => (checksByFile.get(f) ?? 0) === 0);

  // 一次性 schema 里先建好版本表：`0010` 用 `to_regclass('app.schema_migrations')`
  // 判断「这是真实库还是临时 schema」，没有版本表它就直接 RETURN、什么都不插。
  // 不建的话，0010 的回滚会变成「删 0 行」—— 通过，但什么都没验到。
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(
    `CREATE TABLE ${schema}.schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
  );

  try {
    const byFile = new Map();
    for (const file of upFiles) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      try {
        await client.query(redirectSchema(sql, schema));
      } catch (err) {
        failures.push(`上行 ${file} 执行失败：${err.message}`);
        return { failures, checkedObjects: 0, unverified: unverified() };
      }
      byFile.set(file, {
        objects: createdObjectsOf(sql),
        defaults: alteredDefaultsOf(sql),
        inserted: hasInsert(sql),
      });
    }

    let checkedObjects = 0;

    // 倒序回滚，与 `migrate.ts` 的 down 行为一致（它 `[...files].reverse()`）。
    // **每回滚一个就问一次**，而不是全滚完再统一看残留 —— 理由见
    // `createdObjectsOf` 的注释。
    for (const file of [...upFiles].reverse()) {
      const downName = file.replace(/\.sql$/, '.down.sql');
      const downPath = join(migrationsDir, downName);
      if (!existsSync(downPath)) {
        failures.push(`缺少下行脚本：${downName}`);
        continue;
      }

      const before = (await client.query(LEFTOVER_SQL, [schema])).rows.length;
      const rowsBefore = await totalRows(client, schema);
      // 记下 up 之后这些列的默认值，down 跑完再比。
      const meta = byFile.get(file);
      const defaultsBefore = new Map();
      for (const d of meta.defaults) {
        defaultsBefore.set(`${d.table}.${d.column}`, await columnDefault(client, schema, d.table, d.column));
      }

      try {
        await client.query(redirectSchema(readFileSync(downPath, 'utf8'), schema));
      } catch (err) {
        failures.push(`下行 ${downName} 执行失败：${err.message}`);
        continue;
      }

      // 默认值类改动：down 之后值必须和 down 之前不同，否则它什么都没撤销。
      // 这类改动看不到对象，`createdObjectsOf` 和内容迁移判据都漏掉它 ——
      // 0004 就是这样漏的（探针：把 down 写成只有注释，照样报绿）。
      for (const d of meta.defaults) {
        checkedObjects += 1;
        bump(file);
        const key = `${d.table}.${d.column}`;
        const after = await columnDefault(client, schema, d.table, d.column);
        if (after === undefined) {
          failures.push(
            `下行 ${downName} 之后 ${key} 这一列不存在了（up 只改了它的默认值，不该删列）`,
          );
        } else if (after === defaultsBefore.get(key)) {
          failures.push(
            `下行 ${downName} 没有改变 ${key} 的默认值（up 改了它，down 里找不到对应的 SET/DROP DEFAULT）——` +
              `前后都是 ${JSON.stringify(after)}`,
          );
        }
      }

      // 结构迁移：它建的每个对象都应该没了。
      for (const obj of meta.objects) {
        checkedObjects += 1;
        bump(file);
        if (await objectExists(client, schema, obj)) {
          const what =
            obj.kind === 'column' ? `${obj.table}.${obj.name}（列）` : `${obj.name}（${obj.kind}）`;
          failures.push(`下行 ${downName} 没有删除 ${what} —— 该迁移的 up 建了它，down 里找不到对应的 DROP/ALTER`);
        }
      }

      // 内容迁移（只有 INSERT、没有 DDL）：down 至少要让某些行消失。
      // 判据取「整个 schema 的总行数减少了」而不是解析 DELETE 的键值：
      // 键值在 up 里是字面量、在 down 里可能用不同写法表达同一批行，读文件
      // 比对会变成「两种等价写法被判不一致」，而真的没删是绝对不能放过的。
      if (meta.objects.length === 0 && meta.inserted) {
        const rowsAfter = await totalRows(client, schema);
        checkedObjects += 1;
        bump(file);
        if (rowsAfter >= rowsBefore) {
          failures.push(
            `下行 ${downName} 没有删掉任何行（回滚前后总行数 ${rowsBefore} → ${rowsAfter}）——` +
              `这是内容迁移，回滚脚本应当移除它插入的数据`,
          );
        }
      }

      // 0001 的 down 会把整个 schema 删掉，之后的循环没必要再问。
      const schemaGone = (await client.query(LEFTOVER_SQL, [schema])).rows.length === 0
        && (await client.query(
          `SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name = $1`,
          [schema],
        )).rows[0].n === 0;
      if (schemaGone) {
        void before;
        return { failures, checkedObjects, unverified: unverified() };
      }
    }

    const tables = (await client.query(LEFTOVER_SQL, [schema])).rows
      .map((r) => r.table_name)
      .filter((t) => t !== 'schema_migrations');
    const indexes = (await client.query(LEFTOVER_INDEX_SQL, [schema])).rows.map((r) => r.indexname);
    if (tables.length) failures.push(`全部回滚后仍残留业务表：${tables.join(', ')}`);
    if (indexes.length) failures.push(`全部回滚后仍残留索引：${indexes.join(', ')}`);

    return { failures, checkedObjects, unverified: unverified() };
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
    const { failures, checkedObjects, unverified = [] } = await checkRoundTrip(client);
    if (failures.length) {
      record('roundtrip', '下行脚本真的能回滚（up → down → 无残留）', 'failed', failures.join('\n'));
    } else {
      // 「N 个迁移逐个核对」这句话不能比事实强：只删数据、down 有意不回填的迁移，
      // 动态核对能从它身上看见的东西是 0 件。点名，让读者知道少的是哪几本。
      //
      // 已交代的已知盲区：`0005_drop_stale_seed_mastery.sql` 没有可动态核对的改动
      //（它只删数据，down 有意不回填）—— 这是**正确**的写法（删数据不该回填），
      // 但本脚本对它无能为力。这条只能人工确认一次；看输出就别以为是检查漏了。
      // 将来再加同类迁移，它的文件名会落进 `unverified` 里自动被点名，不用回来改代码。
      const verifiedCount = upFiles.length - unverified.length;
      const caveat = unverified.length
        ? `；另有 ${unverified.length} 个迁移没有可动态核对的改动（${unverified.join('、')}）` +
          `—— 通常是只删数据的迁移、down 有意不回填。这类迁移这条检查无从下手，只能人工确认一次`
        : '';
      record(
        'roundtrip',
        '下行脚本真的能回滚（up → down → 无残留）',
        'passed',
        `${upFiles.length} 个迁移在一次性 schema 上逐个 up → down，` +
          `其中 ${verifiedCount} 个有可动态核对的改动，共核对了 ${checkedObjects} 个` +
          `「up 建了什么」，回滚后全部消失、无残留表、无残留索引${caveat}`,
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
