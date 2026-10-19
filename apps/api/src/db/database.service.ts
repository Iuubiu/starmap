import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

/**
 * 数据库连接池。
 *
 * 业务表在 `app` schema，Mastra 的表在 `mastra` schema。
 * 边界靠连接的 `search_path` 强制，而不是靠代码自律——
 * 这样即使有人写裸 SQL 也越不过去（ADR-0005 / docs/architecture.md §7）。
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool;
  /** 主 schema；业务表在 app，测试时切到独立 schema */
  private schema = 'app';

  constructor() {
    this.pool = this.createPool('app');
  }

  private createPool(schema: string): Pool {
    const connectionString =
      process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap';
    // search_path 通过连接启动参数设置，而不是在 'connect' 事件里发 SET。
    // 用事件发 SET 会有竞态：那条 SET 是异步的，第一条业务查询可能先跑，
    // 于是查询落到默认的 app schema（空表）上并**静默返回空结果**——
    // 不报错、看起来只是「没数据」，这种 bug 极难定位（我踩过）。
    return new Pool({
      connectionString,
      max: 10,
      options: `-c search_path=${schema},public`,
    });
  }

  /**
   * 切换 schema。会关闭旧池并重建——只在测试里调用。
   *
   * 第一版只改了字段再 `SET search_path`，结果池里已存在的连接仍指向
   * 旧 schema，测试读到空数据且不报错。这种"看起来生效其实没生效"的
   * 状态最难查，故直接重建池。
   */
  async useSchema(schema: string): Promise<void> {
    if (!/^app_test_[a-z0-9_]+$/.test(schema)) {
      throw new Error(`拒绝使用非法测试 schema 名: ${schema}`);
    }
    const old = this.pool;
    this.schema = schema;
    this.pool = this.createPool(schema);
    await old.end().catch(() => undefined);
  }

  /** 当前 schema，测试断言用 */
  get activeSchema(): string {
    return this.schema;
  }

  get connection(): Pool {
    return this.pool;
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const res = await this.pool.query(sql, params as unknown[]);
    return res.rows as T[];
  }

  /** 健康检查用：返回数据库当前时间，证明连的是真库 */
  async now(): Promise<string> {
    const rows = await this.query<{ now: Date }>('SELECT now() AS now');
    const value = rows[0]?.now;
    return value instanceof Date ? value.toISOString() : String(value ?? '');
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('关闭数据库连接池');
    await this.pool.end();
  }
}
