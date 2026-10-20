import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  UseFilters,
} from '@nestjs/common';
import { z } from 'zod';
import {
  SkillToggleRequestSchema,
  type SkillDetailResponse,
  type SkillListResponse,
  type SkillSystemPreviewResponse,
} from '@starmap/api-contract';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { SkillsService } from './skills.service.js';

/**
 * 票 15 的 skill 库接口。
 *
 * **只读正文 + 一个开关。** 不做导入导出：skill 是仓库里的文件，迁移靠
 * git 或直接拷目录，页面上要写清这句话（见前端的空状态文案）。把上传
 * 做进 web 层会让「谁在什么时候改了 agent 的行为」失去版本控制这道保险。
 */
@Controller('api/v1')
@UseFilters(ApiExceptionFilter)
export class SkillsController {
  constructor(@Inject(SkillsService) private readonly skills: SkillsService) {}

  @Get('agent/skills')
  async list(): Promise<SkillListResponse> {
    return this.skills.list();
  }

  /**
   * 注意路由顺序：`system-preview` 必须定义在 `:name` 之前，
   * 否则 Express 会把 "system-preview" 当成一个 skill 名。
   * （这里写成两个独立装饰器，Nest 按声明顺序注册，顺序即优先级。）
   */
  @Get('agent/skills/system-preview')
  async systemPreview(): Promise<SkillSystemPreviewResponse> {
    return this.skills.systemPreview();
  }

  @Get('agent/skills/:name')
  async detail(@Param('name') name: string): Promise<SkillDetailResponse> {
    return this.skills.detail(name);
  }

  @Patch('agent/skills/:name')
  async toggle(
    @Param('name') name: string,
    @Body() rawBody: unknown,
  ): Promise<SkillDetailResponse> {
    const parsed = SkillToggleRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '请求体不合法',
        details: parsed.error.issues,
      });
    }
    return this.skills.toggle(name, parsed.data.enabled);
  }
}
