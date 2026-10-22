import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { NulByteGuard } from './common/nul-byte.guard.js';
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
    // 全局守卫：拦住含 NUL 字节的路径参数/查询/请求体。
    // PostgreSQL 不接受 0x00，驱动会抛 DatabaseError —— 不拦的话每个把路径参数
    // 传给 SQL 的端点都会 500（实测六个端点全部如此）。放全局因为这是所有路由
    // 都必经、且早于任何 DB 调用的唯一位置（详见 nul-byte.guard.ts 的文件头）。
    { provide: APP_GUARD, useClass: NulByteGuard },
    DatabaseService,
    {
      provide: LLM_PORT,
      useFactory: () => {
        // 演示录制专用通道：`DEMO_LLM=1` 时改用官方 key（更快、更贵）。
        // 为什么用开关而不是让演示时手改 .env：手改要记得改回来，忘了就会
        // 在后续开发里一直烧贵的那把 key，而且改 .env 要重启才生效、容易
        // 出现「以为切了其实没切」。开关只有一处判断，缺变量时明确报错
        // 而不是静默回退到便宜通道 —— 演示当天悄悄变慢比直接报错更难查。
        if (process.env.DEMO_LLM === '1') {
          const base = process.env.DEMO_LLM_BASE_URL;
          const key = process.env.DEMO_LLM_API_KEY;
          const model = process.env.DEMO_LLM_MODEL;
          const missing = [
            !base && 'DEMO_LLM_BASE_URL',
            !key && 'DEMO_LLM_API_KEY',
            !model && 'DEMO_LLM_MODEL',
          ].filter(Boolean);
          if (missing.length > 0) {
            throw new Error(
              `DEMO_LLM=1 但缺少 ${missing.join(' / ')}。演示通道要显式配全三项，` +
                '不允许一部分走演示、一部分走默认（那会得到一个你以为更快、实际上没换的模型）。',
            );
          }
          return new OpenAiCompatibleLlm(base!, key!, model!);
        }
        return new OpenAiCompatibleLlm(
          process.env.LLM_BASE_URL ?? 'https://d1api.xin/v1',
          process.env.LLM_API_KEY ?? '',
          process.env.LLM_MODEL ?? 'deepseek-v4.1-flash',
        );
      },
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

