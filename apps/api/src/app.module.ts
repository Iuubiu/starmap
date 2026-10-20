import { Module } from '@nestjs/common';
import { DatabaseService } from './db/database.service.js';
import { domainControllers } from './domains.js';
import { LLM_PORT } from './llm/llm.port.js';
import { OpenAiCompatibleLlm } from './llm/openai-compatible-llm.js';
import { StarmapMastraModule } from './mastra/mastra.module.js';
import { RetrievalService } from './retrieval/retrieval.service.js';
import { SkillsService } from './skills/skills.service.js';
import { ProbeService } from './probe/probe.service.js';
import { TurnService } from './agent/turn.service.js';

/**
 * 根模块。
 *
 * **`StarmapMastraModule` 必须排在 imports 数组的最后。** `@mastra/nestjs`
 * 注册的是 catch-all 控制器（`@All('*')`），排在业务模块前面会拦掉
 * `/api/v1/*` 并返回 404。现在它是唯一的 import，但后面加模块时
 * 一定要加在它上面。
 *
 * 控制器清单不在这里，在 `domains.ts` —— 新增领域控制器只改那一个文件。
 * **但控制器用到的 Service 必须在这下面的 providers 里**：控制器归 AppModule
 * 拥有，Nest 只会在 AppModule 的作用域内解析它们的依赖。
 *
 * providers 的排列顺序对 Nest 无影响（它按 token 解析而不是按声明顺序），
 * 但这里仍按「基础设施 → 领域服务」分段，方便肉眼核对。
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
    // 领域服务（票 08/09/10/15）。依赖链：TurnService → ProbeService/RetrievalService
    // → DatabaseService，四者必须在同一个模块里才能互相注入。
    RetrievalService,
    SkillsService,
    ProbeService,
    TurnService,
  ],
  exports: [DatabaseService, LLM_PORT],
})
export class AppModule {}

