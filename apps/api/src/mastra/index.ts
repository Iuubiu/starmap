import { Mastra } from '@mastra/core/mastra';
import { PostgresStore } from '@mastra/pg';
import { Logger } from '@nestjs/common';

/**
 * AI 世界的组装根。
 *
 * 这里只做一件事：把 agents / workflows / storage 装进一个 Mastra 实例。
 * **业务逻辑一行都没有** —— 业务看到的是 NestJS 的 service，Mastra 只是它
 * 背后的 AI 运行时。这条边界是 ADR-0007 的全部内容。
 *
 * 遥测必须在这里关掉。@mastra/core 的遥测**默认开启**，会把主机名（sha256
 * 前 16 位）、操作系统、Node 版本、Mastra 版本发往 PostHog（us.posthog.com）。
 * 构造参数里**没有** telemetry 字段，唯一的开关是环境变量
 * `MASTRA_TELEMETRY_DISABLED`（源码见 core/dist/feature-telemetry-*.js 的
 * `isTelemetryEnabled()`）。所以这里不能只靠文档，要在进程内强制设置。
 */
if (!process.env.MASTRA_TELEMETRY_DISABLED) {
  process.env.MASTRA_TELEMETRY_DISABLED = '1';
}

const logger = new Logger('Mastra');

/** Mastra 的背景 worker 不启动则定时 workflow 不跑，这里显式持有以便启停 */
let mastraInstance: Mastra | undefined;

export function createMastra(): Mastra {
  if (mastraInstance) return mastraInstance;

  const storage = new PostgresStore({
    /**
     * `id` 是必填项（`PostgresBaseConfig.id: string`），不是可选元数据。
     * 同一个 Mastra 实例里出现重复 id 会抛错，所以它其实是「这个存储的身份」。
     */
    id: 'starmap-pg',
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/starmap',
    // Mastra 的表放在独立 schema，业务代码不读、不对它建外键（升级会锁死迁移）
    schemaName: 'mastra',
    /**
     * 生产环境建议 true 并由 CI 显式迁移。本地开发留 false，
     * 让第一次 `pnpm dev` 就能自己建好表，不需要额外的初始化步骤。
     */
    disableInit: process.env.NODE_ENV === 'production',
  });

  mastraInstance = new Mastra({ storage });

  logger.log('Mastra 已初始化（storage: PostgresStore@mastra schema，遥测已关闭）');
  return mastraInstance;
}

export function getMastra(): Mastra {
  return createMastra();
}
