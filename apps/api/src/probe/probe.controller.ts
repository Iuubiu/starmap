import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  UseFilters,
} from '@nestjs/common';
import {
  ProbeReplyRequestSchema,
  ProbeStartRequestSchema,
  type ProbeMetricsResponse,
  type ProbeSessionResponse,
  type ProbeTurnResponse,
} from '@starmap/api-contract';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { ProbeService } from './probe.service.js';

/**
 * 票 10 的追问接口。
 *
 * 路由顺序有两处必须注意（Nest 按声明顺序注册，声明顺序即匹配优先级）：
 * - `agent/probes/metrics` 必须在 `agent/probes/:probeId` 之前；
 * - 同理 `agent/probes/:probeId/replies` 不受影响（多一段路径，不会歧义）。
 */
@Controller('api/v1')
@UseFilters(ApiExceptionFilter)
export class ProbeController {
  constructor(@Inject(ProbeService) private readonly probe: ProbeService) {}

  @Post('agent/probes')
  async start(@Body() rawBody: unknown): Promise<ProbeSessionResponse> {
    const parsed = ProbeStartRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '请求体不合法',
        details: parsed.error.issues,
      });
    }
    return this.probe.start({ microKpId: parsed.data.microKpId, tier: parsed.data.tier });
  }

  @Get('agent/probes/metrics')
  async metrics(): Promise<ProbeMetricsResponse> {
    return this.probe.metrics();
  }

  @Get('agent/probes/:probeId')
  async get(@Param('probeId') probeId: string): Promise<ProbeSessionResponse> {
    return this.probe.get(probeId);
  }

  @Post('agent/probes/:probeId/replies')
  async reply(
    @Param('probeId') probeId: string,
    @Body() rawBody: unknown,
  ): Promise<ProbeTurnResponse> {
    const parsed = ProbeReplyRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '请求体不合法',
        details: parsed.error.issues,
      });
    }
    return this.probe.reply(probeId, parsed.data.replyText);
  }
}
