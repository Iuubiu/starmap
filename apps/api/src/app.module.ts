import { Module } from '@nestjs/common';
import { DatabaseService } from './db/database.service.js';
import { domainControllers } from './domains.js';
import { LLM_PORT } from './llm/llm.port.js';
import { OpenAiCompatibleLlm } from './llm/openai-compatible-llm.js';
import { StarmapMastraModule } from './mastra/mastra.module.js';

/**
 * 根模块。
 *
 * **`StarmapMastraModule` 必须排在 imports 数组的最后。** `@mastra/nestjs`
 * 注册的是 catch-all 控制器（`@All('*')`），排在业务模块前面会拦掉
 * `/api/v1/*` 并返回 404。现在它是唯一的 import，但后面加模块时
 * 一定要加在它上面。
 *
 * 控制器清单不在这里，在 `domains.ts` —— 新增领域控制器只改那一个文件。
 */
@Module({
  imports: [StarmapMastraModule.register()],
  controllers: domainControllers,
  providers: [
    DatabaseService,
    {
      provide: LLM_PORT,
      useFactory: () =>
        new OpenAiCompatibleLlm(
          process.env.LLM_BASE_URL ?? 'https://d1api.xin/v1',
          process.env.LLM_API_KEY ?? '',
          process.env.LLM_MODEL ?? 'deepseek-v4.1-flash',
        ),
    },
  ],
  exports: [DatabaseService, LLM_PORT],
})
export class AppModule {}

