/**
 * 探针：service 层并发 status()，看「无乐观锁」时会不会写出多行重判日志。
 *
 * 为什么不用 HTTP：curl 进程启动开销几十毫秒，把 8 个请求摊开了，
 * 事务窗口（几毫秒）根本撞不上 —— 实测 8 路和 20 路都只写 1 行，
 * 那不是「锁生效」，是「没并发起来」。这里直接在同一进程内并发调用，
 * 才真的把 8 个事务压在同一个窗口里。
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../apps/api/src/app.module.js';
import { PlacementService } from '../apps/api/src/placement/placement.service.js';
import { DatabaseService } from '../apps/api/src/db/database.service.js';

const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
const db = app.get(DatabaseService);
const placement = app.get(PlacementService);

async function countRejudges(): Promise<number> {
  const rows = await db.query<{ n: string }>('SELECT count(*) AS n FROM placement_rejudges');
  return Number(rows[0]?.n ?? 0);
}

// 把基线往回拨 5，制造「够 5 题该重判」的状态
await db.query('UPDATE placement_profile SET attempts_baseline = attempts_baseline - 5 WHERE id = 1');
const before = await countRejudges();
console.log('重判前基线已回拨，当前日志条数:', before);

const N = 8;
const results = await Promise.allSettled(Array.from({ length: N }, () => placement.status()));
console.log('成功:', results.filter((r) => r.status === 'fulfilled').length, '/', N);

const after = await countRejudges();
console.log(`并发 ${N} 次 status() 新增日志条数:`, after - before);
console.log(after - before > 1 ? '❌ 复现了重复写日志' : '✅ 只写了一条');

await app.close();
