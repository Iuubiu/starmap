/**
 * 学习者画像接口（票 78）。
 *
 * 两条路由，读与改。没有 `POST`：画像是单行资源，第一次写入由 PATCH 的
 * upsert 完成 —— 前端不需要先「创建画像」再「填字段」。
 *
 * 为什么服务是现场 new 的：`app.module.ts` 的 providers 是共享文件（见
 * `domains.ts` 的说明），加一个 Service 去改它会让所有泳道在同一个数组上排队。
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  UseFilters,
} from '@nestjs/common';
import {
  LearnerProfilePatchSchema,
  type ProfileResponse,
} from '@starmap/api-contract';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { DatabaseService } from '../db/database.service.js';
import { ProfileService } from './profile.service.js';

@Controller('api/v1')
@UseFilters(ApiExceptionFilter)
export class ProfileController {
  private readonly profile: ProfileService;

  constructor(@Inject(DatabaseService) db: DatabaseService) {
    this.profile = new ProfileService(db);
  }

  /**
   * 当前画像。
   *
   * 从没填过时返回全 `null` + `updatedAt: null`，**不是 404**：新用户没有画像是
   * 正常状态，前端据此决定是去欢迎页还是直接展示画像。
   */
  @Get('profile')
  async get(): Promise<ProfileResponse> {
    return this.profile.get();
  }

  /**
   * 按字段更新。
   *
   * 请求体是部分画像：`{ "background": "graduate" }` 只改学段；`{ "goal": null }`
   * 表示学生跳过了目标这一问 —— 两者必须分得开，所以用 PATCH 而不是 PUT。
   */
  @Patch('profile')
  async update(@Body() body: unknown): Promise<ProfileResponse> {
    const parsed = LearnerProfilePatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '请求体不合法',
        details: parsed.error.issues,
      });
    }
    return this.profile.update(parsed.data);
  }
}
