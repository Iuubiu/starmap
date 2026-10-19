import { Module, type DynamicModule } from '@nestjs/common';
import { MastraModule } from '@mastra/nestjs';
import { createMastra } from './index.js';

/**
 * Mastra × NestJS 的**唯一**交汇点（ADR-0007）。
 *
 * 三条来自实测的硬约束，写在这里免得后人踩：
 *
 * 1. **必须用 `@nestjs/platform-express`**。`@mastra/nestjs@0.2.37` 的 peer
 *    依赖是 `express ^4 || ^5`，配 fastify 装不上。
 *
 * 2. **`prefix` 必须给专用前缀**。适配器注册的是 catch-all `@All('*')`，
 *    没有前缀会拦截所有其它路由并返回 404。配合「在 AppModule 里最后导入」
 *    形成双重保险。
 *
 * 3. **后台 worker 要手动启停**。`MastraModule` 不启动 Mastra 的 background
 *    workers，不启动则定时 workflow、agent schedules、事件监听全部不运行；
 *    shutdown 时它只 drain 请求，不停 Mastra。所以 main.ts 里要显式
 *    `startWorkers()` 与 `shutdown()`。
 */
@Module({})
export class StarmapMastraModule {
  static register(): DynamicModule {
    return {
      module: StarmapMastraModule,
      imports: [
        MastraModule.register({
          mastra: createMastra(),
          prefix: '/api/mastra',
          /**
           * v1 是本地单用户、无登录（spec 明确不鉴权）。适配器默认开启的
           * 限流在这里保留，因为它是防误用的，不是身份验证。
           */
          rateLimitOptions: { enabled: true, defaultLimit: 200, windowMs: 60_000 },
        }),
      ],
      exports: [MastraModule],
    };
  }
}
