/**
 * 一条命令起全部开发依赖。
 *
 * 顺序不是随意的：先确认数据库可连，再跑迁移，最后才起两个 dev server。
 * 如果把这三件事并发跑，API 会在迁移完成前启动，然后在第一次查询时
 * 报「relation does not exist」——那个错误看起来像代码 bug，实际是启动顺序。
 *
 * 用 Node 而不是 shell 脚本：Windows 上 `&` / `wait` 的行为与 POSIX 不同，
 * 而 Node 的 spawn 在两个平台一致。
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const run = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}`))));
    child.on('error', reject);
  });

if (!existsSync(join(root, '.env'))) {
  console.warn('⚠ 没有 .env，使用 .env.example 的默认值（本地 Postgres）');
}

// 本机没有 docker（daemon 不可用、`docker compose` 子命令也不存在），
// 数据库是 scoop 装的 PostgreSQL 18。这一步是幂等的：已经在跑就立刻返回。
// 不自动起数据库的话，重启机器后第一次 `pnpm dev` 会以
// 「connect ECONNREFUSED 127.0.0.1:5432」失败，看起来像代码 bug。
if (process.platform === 'win32' && existsSync(join(root, 'scripts', 'db-up.ps1'))) {
  console.log('→ 确认本机 PostgreSQL 在运行…');
  try {
    execFileSync('pwsh', ['-NoProfile', '-File', join(root, 'scripts', 'db-up.ps1')], {
      cwd: root,
      stdio: 'inherit',
    });
  } catch {
    console.warn('⚠ db-up.ps1 失败，继续尝试连数据库（可能你用的是别的 Postgres）');
  }
}

console.log('→ 检查数据库并执行迁移…');
try {
  execFileSync('pnpm', ['db:migrate'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
} catch {
  console.error(
    '\n✗ 迁移失败。请确认本机 PostgreSQL 已启动，且 .env 里的 DATABASE_URL 可连。\n' +
      '  本机（scoop 安装）：pwsh -File scripts/db-up.ps1\n' +
      '  其它环境：docker compose --profile container up -d\n' +
      '  或检查服务：Get-Service postgresql*',
  );
  process.exit(1);
}

console.log('→ 启动 API 与 Web…');
const api = spawn('pnpm', ['--filter', '@starmap/api', 'dev'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
const web = spawn('pnpm', ['--filter', '@starmap/web', 'dev'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const shutdown = () => {
  api.kill();
  web.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
