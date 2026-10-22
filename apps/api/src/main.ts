import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { Mastra } from '@mastra/core/mastra';
import { MASTRA } from '@mastra/nestjs';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  // 必须调用：否则 Mastra 的 shutdown 钩子不会被触发，SSE 连接不会被收尾
  app.enableShutdownHooks();
  app.enableCors({ origin: ['http://127.0.0.1:5173', 'http://localhost:5173'] });

  /**
   * `MastraModule` 不启动 background workers。不显式启动的话，定时 workflow、
   * agent schedules、事件监听都不会运行 —— 表现为「代码看起来对，但什么都不
   * 发生」。这是适配器文档明说的行为，不是 bug。
   */
  const mastra = app.get<Mastra>(MASTRA, { strict: false });
  if (mastra) {
    await mastra.startWorkers();
    new Logger('Bootstrap').log('Mastra background workers 已启动');
  }

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '127.0.0.1');
  new Logger('Bootstrap').log(`API 已启动: http://127.0.0.1:${port}/api/v1/health`);
}

void bootstrap();
