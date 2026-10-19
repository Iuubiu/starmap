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

console.log('→ 检查数据库并执行迁移…');
try {
  execFileSync('pnpm', ['db:migrate'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
} catch {
  console.error(
    '\n✗ 迁移失败。请确认本机 PostgreSQL 已启动，且 .env 里的 DATABASE_URL 可连。\n' +
      '  Windows（scoop 安装）：pg_ctl -D <数据目录> start\n' +
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
