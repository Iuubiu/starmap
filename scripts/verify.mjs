/**
 * `pnpm verify` —— 一条命令回答「现在能不能合并」。
 *
 * 之前它是 `typecheck && check:boundaries && test` 的裸 `&&` 链。四个问题：
 *
 *   1. **缺门**：契约漂移、迁移可回滚性、Python 内容管线都不在里面。前两项
 *      现在各有脚本了，不串进来等于没有。
 *   2. **失败信息没有主语**：`&&` 链在 pnpm 下挂掉时，最后一行往往是
 *      `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` 或子命令的退出码，人还得往回翻
 *      才知道是哪一段红的。这里每段开跑前先打印自己的名字，挂了就直接
 *      说「第 N 段 X 失败」，并跳过后面的段（后面的段在坏掉的前置上跑，
 *      输出了也是噪音）。
 *   3. **假绿无人识别**：`check:boundaries` 在 TypeScript 7 下会打
 *      `missing-tsc-transpiler` 警告（dependency-cruiser 只认 `<7.0.0`），
 *      而现在警告是无害的 —— 因为 `@swc/core` 这个替身还在。哪天它被移走，
 *      警告一模一样、`✔ no dependency violations found` 也一模一样，但那时
 *      才是「一个 TS 文件都没检查」。本脚本对这一点做结构化判定，见
 *      `analyzeBoundaries`。
 *   4. **红得没有主语**：单元测试段失败时，光看「19 failed」分不清是
 *      「有人刚写了测试、实现还没跟上」（TDD 正常进行中）、还是「实现被改
 *      坏了、测试抓住了」（真问题）、还是「环境问题」。本脚本**不试图自动
 *      判断这三者** —— 它判断不了，硬判只会给出一个会骗人的结论。它做的是
 *      把判断所需的事实摆出来：失败的测试文件改于几分钟前、它 import 的
 *      实现文件又改于何时。目的是让下一个看到红的人 5 秒内知道该去找谁，
 *      而不是去翻 git log。见 `diagnoseTestFailures`。
 *
 * 语义保持不变：**全绿才 exit 0**，任何一段红就 exit 非零。变的是输出——
 * 现在能看出是哪一段、为什么。
 */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 正常情况下的模块数在 300 上下（2026-10 实测 305）。这里取一个明显低于
 * 它、又明显高于「tsc 替身没了只剩几个 .mjs」的阈值。
 *
 * 为什么不记成精确基线：模块数本来就该随代码增长而变化，写死一个数会让
 * 这条守卫在每次正常新增文件时误报，误报三次之后它就会被绕过。守卫要拦的
 * 是数量级的变化，不是个位数。
 */
const MIN_PLAUSIBLE_MODULES = 100;

/** 「刚改过」的窗口。TDD 的红通常落在这个范围内，实现写完就绿了。 */
const RECENT_WINDOW_MS = 10 * 60 * 1000;

/**
 * `check:boundaries` 的输出判定。
 *
 * - 有违规：depcruise 自己会 exit 非零，这里不用再管。
 * - 退出码 0 且解析到模块数：正常。若此时仍带 `missing-tsc-transpiler`
 *   警告，说明替身还在、检查是真的，只把两个数打出来当心跳 ——
 *   这是**通过**，不是警告。
 * - 退出码 0 但解析不到模块数，或模块数低于阈值，**同时**带那条警告：
 *   判定为「transpiler 没了、检查是空转」→ 失败。
 * - 退出码 0、有警告、模块数正常：通过。今天就是这种状态。
 *
 * 反过来，如果哪天警告消失（dependency-cruiser 支持 TS 7 了），模块数
 * 校验依然生效 —— 判据是「输出里到底有几个模块」，不是「有没有那句话」。
 */
function analyzeBoundaries({ status, stdout }) {
  const m = /\((\d+) modules,\s*(\d+) dependencies cruised\)/.exec(stdout);
  const modules = m ? Number(m[1]) : null;
  const deps = m ? Number(m[2]) : null;
  const hasTranspilerWarning = /missing-tsc-transpiler/.test(stdout);

  if (status !== 0) return { ok: false, note: null };

  if (modules === null) {
    return {
      ok: false,
      note:
        '依赖边界检查输出里找不到「N modules, M dependencies cruised」，无法确认它真的解析了代码。\n' +
        '    → 输出格式可能变了，去看 scripts/verify.mjs 的 analyzeBoundaries。',
    };
  }

  if (hasTranspilerWarning && modules < MIN_PLAUSIBLE_MODULES) {
    return {
      ok: false,
      note:
        `依赖边界检查只解析到 ${modules} 个模块（正常 300 上下），同时输出了 missing-tsc-transpiler 警告。\n` +
        '    这两件事同时出现说明 TypeScript 源码根本没被检查 —— 那句「no dependency violations found」是空转。\n' +
        '    → 装回 TS ↔ dependency-cruiser 之间的替身（本仓库是 @swc/core），或升级 dependency-cruiser。',
    };
  }

  return {
    ok: true,
    note: `模块 ${modules} / 依赖 ${deps}${hasTranspilerWarning ? '（含既有的 missing-tsc-transpiler 警告，模块数正常故判定为有效检查）' : ''}`,
  };
}

/** `12:52` 这种短时间，用于一眼看出新旧。 */
function clockOf(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

const isRecent = (ms, now) => now - ms < RECENT_WINDOW_MS;

/** 在一堆候选路径里找出真实存在的那一个。 */
function firstExisting(candidates) {
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/**
 * 把 `src/mastery.replay.test.ts` 这种包内相对路径解析成绝对路径。
 *
 * pnpm 递归跑时每行带包名前缀（`packages/engine test:  FAIL  src/...`），
 * 所以优先用前缀定位包根；前缀丢了就挨个 workspace 目录扫一遍 —— 这条
 * 兜底路径慢一点，但只在「找不到」时才走，而且比报「解析不到失败文件」
 * 更有用。
 */
function resolveTestFile(rel, pkgPrefix) {
  const normalized = rel.replaceAll('\\', '/');

  if (pkgPrefix) {
    const hit = firstExisting([join(root, pkgPrefix.replaceAll('/', '\\'), normalized)]);
    if (hit) return hit;
  }

  for (const base of ['packages', 'apps', 'tools']) {
    const baseDir = join(root, base);
    if (!existsSync(baseDir)) continue;
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const hit = firstExisting([join(baseDir, entry.name, normalized)]);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * 从 `pnpm test` 的输出里捞出失败的测试文件，并把它相对 import 的实现文件
 * 的 mtime 一并列出来。
 *
 * 输出格式（pnpm 递归会给每行加包名前缀）：
 *
 *     packages/engine test:  FAIL  src/mastery.replay.test.ts > 用例名
 *
 * 也兼容不带前缀的形态（直接 `pnpm --filter X test` 时）。
 *
 * 为什么顺着 import 去找实现文件而不是瞎猜：TDD 的红几乎总是「测试文件新、
 * 被测模块旧」。把两个 mtime 并排摆出来，这个对比自己会说话，不需要脚本
 * 去下「这是正常的红」的结论 —— 那个结论它下不了，也不该下。
 */
function diagnoseTestFailures(stdout, stderr, now) {
  const combined = `${stdout}\n${stderr}`;
  const failures = new Map(); // abs -> rel

  for (const rawLine of combined.split(/\r?\n/)) {
    const prefixMatch = /^([\w./@-]+) test:\s?(.*)$/.exec(rawLine);
    const pkgPrefix = prefixMatch ? prefixMatch[1] : null;
    const line = prefixMatch ? prefixMatch[2] : rawLine;

    const m = /^\s*FAIL\s+(\S+?)(?:\s+>|$)/.exec(line);
    if (!m) continue;
    const rel = m[1];
    if (!/\.(test|spec)\.[cm]?[jt]sx?$/.test(rel)) continue;

    const abs = resolveTestFile(rel, pkgPrefix);
    if (abs && !failures.has(abs)) failures.set(abs, rel);
  }

  if (failures.size === 0) return null;

  const lines = ['失败的测试文件（★ = 最近 10 分钟内改过；紧随其后是它 import 的实现文件）：'];

  for (const abs of failures.keys()) {
    const testStat = statSync(abs);
    const star = isRecent(testStat.mtimeMs, now) ? '★' : ' ';
    lines.push(`  ${star} ${relative(root, abs).replaceAll('\\', '/')}  (改于 ${clockOf(testStat.mtimeMs)})`);

    let src = '';
    try {
      src = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }

    // 只跟相对 import 走一步：`from './x.js'` → `./x.ts`。
    // 不递归 —— 一层就够看出「被测模块有没有跟着动」，递归会把整棵依赖树
    // 打出来，反而看不出重点。
    const dir = dirname(abs);
    const seen = new Set();
    for (const im of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const base = join(dir, im[1]);
      const hit = firstExisting([
        base.replace(/\.js$/, '.ts'),
        base.replace(/\.js$/, '.tsx'),
        `${base}.ts`,
        `${base}.tsx`,
        join(base, 'index.ts'),
      ]);
      if (!hit || seen.has(hit) || hit === abs) continue;
      seen.add(hit);
      const st = statSync(hit);
      const s = isRecent(st.mtimeMs, now) ? '★' : ' ';
      lines.push(`      ${s} ${relative(root, hit).replaceAll('\\', '/')}  (改于 ${clockOf(st.mtimeMs)})`);
    }
  }

  return lines.join('\n');
}

/**
 * 有些失败有**已知的**含义，值得直接翻译出来。
 *
 * 这条机制只给「翻译了不会有歧义」的失败用 —— 判据是：这句话如果是错的，
 * 会不会让人去改错的地方？会，就不该加。`domains.test.ts` 是合格的例子：
 * 它一红只有一个含义（有控制器没注册进去），翻译成「路由在真实服务上是
 * 404」比让人读一堆断言差异有用得多，因为失败的后果发生在**别处**。
 *
 * 它**不**判断「这是不是正常的红」（TDD 进行中那种）。那类判断归
 * `diagnoseTestFailures`，它只摆事实、不下结论。
 */
function explainKnownFailures(stdout, stderr) {
  const combined = `${stdout}\n${stderr}`;
  if (!/FAIL\s+\S*domains\.test\./.test(combined)) return null;
  return (
    '有控制器没注册到 apps/api/src/domains.ts 的 domainControllers。\n' +
    '    后果不在这个测试里：它自己用 Test.createTestingModule 装配，过了；\n' +
    '    但真实服务上那个控制器的路由全是 404 —— 服务能起、typecheck 绿、\n' +
    '    单测绿，只有 curl 才发现。红的是结构对账，不是业务逻辑。\n' +
    '    → 把缺的控制器加进 domainControllers（那个文件由 integrator 维护）。'
  );
}

/**
 * e2e 的红最常见的原因不是断言失败，是两个 webServer 没起来。
 *
 * `apps/web/playwright.config.ts` 里 `webServer` 段同时拉 `pnpm --filter
 * @starmap/api dev`（探活 `/api/v1/health`，90s）与 `npx vite --port 5173`
 * （60s）。后端连的是真 Postgres：库没起、或迁移没跑，后端能起但接口 500，
 * 于是 e2e 报「元素找不到」—— 看起来像前端 bug。
 *
 * 这条不判断「到底是不是环境问题」（判不了），只把排查入口摆出来。
 */
function explainE2eServers(stdout, stderr) {
  const combined = `${stdout}\n${stderr}`;
  const looksLikeTimeout =
    /Timeout \d+ms exceeded|webServer.*(timed out|failed)|ECONNREFUSED|net::ERR_CONNECTION_REFUSED/i.test(
      combined,
    );
  if (!looksLikeTimeout) return null;
  return (
    'e2e 超时或被拒连。先确认这两件事，再看断言：\n' +
    '    1. 数据库起着、迁移跑过（`pnpm db:migrate`）—— 后端能起但接口 500 时，\n' +
    '       e2e 报的是「元素找不到」，看起来像前端 bug。\n' +
    '    2. 5173 和 3001 没被别的进程占着（`reuseExistingServer` 会连着那个）。\n' +
    '    单独重跑：pnpm test:e2e:smoke'
  );
}

const steps = [
  { name: '类型检查', script: 'typecheck' },
  { name: '依赖边界', script: 'check:boundaries', guard: analyzeBoundaries },
  { name: '契约同步', script: 'contract:check' },
  { name: '迁移可回滚', script: 'check:migrations' },
  {
    name: '单元测试',
    script: 'test',
    hint: explainKnownFailures,
    diagnose: diagnoseTestFailures,
  },
  { name: '内容管线（Python）', script: 'verify:py' },
  // e2e 只跑 smoke：`graph.spec.ts` 是另一条泳道的进行中工作，把它串进来会
  // 让 verify 的红分不清「我这次改坏了」和「别人还没写完」。判据是「这一段的
  // 红必须只可能由本次改动引起」—— 做不到就不该进这条链。
  // smoke 覆盖的是跨进程真链路（真 Nest + 真 Postgres + 真 chromium），
  // 这是单测拿不到的：`/level/lv-bool-laws` 那次 500 就是单测全绿而 e2e 红。
  {
    name: '端到端（smoke）',
    script: 'test:e2e:smoke',
    hint: explainE2eServers,
  },
];

/**
 * 跑一段，边跑边把输出转发出去，同时攒下来给守卫/诊断用。
 *
 * 不用 `spawnSync`：整条链跑下来两分钟，`spawnSync` 期间终端一片空白，
 * 看的人分不清「在跑」和「卡住了」。转发是逐块写的，所以超长输出也不会
 * 在内存里堆成一份再吐。
 */
function run(step) {
  return new Promise((resolve) => {
    console.log(`\n${'─'.repeat(70)}\n▶ ${step.name}  (pnpm ${step.script})\n${'─'.repeat(70)}`);

    const child = spawn('pnpm', [step.script], {
      cwd: root,
      shell: process.platform === 'win32',
      // depcruise 会按 TTY 决定要不要上色；上了色正则就抓不到数字了。
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
      process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      stderr += d;
      process.stderr.write(d);
    });

    child.on('error', (err) =>
      resolve({ ok: false, code: null, error: err.message, stdout, stderr }),
    );
    child.on('close', (code) => {
      if (step.guard) {
        const verdict = step.guard({ status: code, stdout, stderr });
        if (verdict.note) console.log(`\n${verdict.ok ? '·' : '✗'} ${verdict.note}`);
        resolve({ ok: verdict.ok && code === 0, code, stdout, stderr });
        return;
      }
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

const startedAt = Date.now();
const results = [];
let failedAt = null;

for (const [index, step] of steps.entries()) {
  const result = await run(step);
  results.push({ ...step, ...result });
  if (!result.ok) {
    failedAt = { index, step, result };
    break;
  }
}

console.log(`\n${'═'.repeat(70)}`);
if (!failedAt) {
  console.log(`✓ 全部 ${steps.length} 段通过，可以合并`);
  for (const r of results) console.log(`   ✓ ${r.name}`);
  console.log(`  用时 ${Math.round((Date.now() - startedAt) / 1000)}s`);
  process.exit(0);
}

const skipped = steps.slice(failedAt.index + 1);
console.log(`✗ 第 ${failedAt.index + 1}/${steps.length} 段「${failedAt.step.name}」失败`);
console.log(`   命令：pnpm ${failedAt.step.script}`);
if (failedAt.result.code !== undefined && failedAt.result.code !== null) {
  console.log(`   退出码：${failedAt.result.code}`);
}
if (failedAt.result.error) console.log(`   启动失败：${failedAt.result.error}`);

for (const r of results.slice(0, failedAt.index)) console.log(`   ✓ ${r.name}`);

// 「已知含义」排在事实清单之前：如果一条失败有确定解释，先说它，别让人
// 先去读六行 mtime 对比才发现「原来是没注册」。两者不冲突，一个是结论、
// 一个是证据。
if (failedAt.step.hint) {
  const hint = failedAt.step.hint(failedAt.result.stdout, failedAt.result.stderr);
  if (hint) console.log(`\n${hint}`);
}

if (failedAt.step.diagnose) {
  const note = failedAt.step.diagnose(failedAt.result.stdout, failedAt.result.stderr, Date.now());
  if (note) console.log(`\n${note}`);
}

if (skipped.length) {
  // 说清「没跑到」而不是留一串沉默：否则看日志的人分不清「后面几段通过了」
  // 和「后面几段根本没执行」。
  console.log(`\n   未执行（前置已红，跑了也是噪音）：${skipped.map((s) => s.name).join(' / ')}`);
}
// 单人重跑建议永远指向**失败的那一段**，不是后面的段：
// 后面的段在坏掉的前置上跑本来就没意义，而失败的那一段正是要反复跑的东西。
console.log(`   单独重跑：pnpm ${failedAt.step.script}`);
process.exit(1);
