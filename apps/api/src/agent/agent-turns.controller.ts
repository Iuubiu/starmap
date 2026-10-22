import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import { z } from 'zod';
import {
  AgentTurnHistoryResponseSchema,
  AgentSessionListResponseSchema,
  AgentTurnRequestSchema,
  AgentTurnResponseSchema,
  type AgentTurnHistoryResponse,
  type AgentSessionListResponse,
  type AgentTurnResponse,
  type AgentTurnEvidenceResponse,
} from '@starmap/api-contract';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { TurnService } from './turn.service.js';

/**
 * 把 zod 的第一条 issue 变成一句能给人看的话。
 *
 * 为什么不直接 `JSON.stringify(issues)`：那会把 `{"code":"too_big","maximum":2000,…}`
 * 整段塞进 MessageBar，学生读不懂。这里只挑最常见的三种（太长/太短/缺字段），
 * 其余退回 zod 自带的 message —— 它本身就是中文之外的英文短句，但至少有指向性。
 */
function firstIssueHint(issues: readonly { path: PropertyKey[]; code: string; message: string; maximum?: number | bigint; minimum?: number | bigint }[]): string {
  const first = issues[0];
  if (!first) return '';
  const field = first.path.join('.') || '请求体';
  if (first.code === 'too_big' && first.maximum !== undefined) {
    return `：${field} 最多 ${String(first.maximum)} 字`;
  }
  if (first.code === 'too_small' && first.minimum !== undefined) {
    return `：${field} 至少 ${String(first.minimum)} 字`;
  }
  if (first.code === 'invalid_type' || first.code === 'invalid_literal') {
    return `：${field} 类型不对`;
  }
  return `：${field} ${first.message}`;
}

/**
 * 结构化回合的 HTTP 边界（票 08）。
 *
 * 这里只做三件事：校验入参、调服务、按契约 schema 校验出参。
 * 业务判断一条都不在这层——回合服务拿不到 HTTP 上下文才能被单测覆盖。
 */

const SessionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const HistoryQuerySchema = z.object({
  sessionId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

@Controller('api/v1')
@UseFilters(ApiExceptionFilter)
export class AgentTurnsController {
  constructor(@Inject(TurnService) private readonly turns: TurnService) {}

  /**
   * 发起一轮。
   *
   * 用 POST 而不是 GET：一句话落库会产生新记录，且同一句话在不同掌握度下
   * 会得到不同卡（缓存语义是错的）。
   *
   * 但状态码是 200 不是 201：这一轮的价值在于**返回的那张卡**，而不是
   * 一个「新建的回合资源」。回合 id 是给「看依据 / 回看」用的句柄，
   * 调用方不会拿着它去 GET 一个集合成员 —— 用 201 会暗示一个并不存在的
   * `Location`。契约里这四条也只声明了 200。
   */
  @Post('agent/turns')
  @HttpCode(200)
  async create(@Body() rawBody: unknown): Promise<AgentTurnResponse> {
    const parsed = AgentTurnRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        // 「请求体不合法」本身没错，但它对使用者零信息量：学生看到这句话无法
        // 判断是「话说太长」还是「字段少了」。把第一条 issue 拼进来，
        // 界面上就能显示「请求体不合法：utterance 最多 2000 字」。
        message: `请求体不合法${firstIssueHint(parsed.error.issues)}`,
        details: parsed.error.issues,
      });
    }
    const response = await this.turns.turn(parsed.data);
    // 服务层已经 parse 过一次；这里再 parse 是防「服务层改字段没改契约」。
    return AgentTurnResponseSchema.parse(response);
  }

  /** 学习日志：这一会话里出过哪些卡，按时间正序。 */
  /** 「学习记录」：会话列表，按最近活动倒序。空库返回 `{sessions: []}`。 */
  @Get('agent/sessions')
  async sessions(@Query() rawQuery: unknown): Promise<AgentSessionListResponse> {
    const parsed = SessionListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '查询参数不合法',
        details: parsed.error.issues,
      });
    }
    const response = await this.turns.sessions(parsed.data.limit);
    return AgentSessionListResponseSchema.parse(response);
  }

  @Get('agent/turns')
  async list(@Query() rawQuery: unknown): Promise<AgentTurnHistoryResponse> {
    const parsed = HistoryQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '查询参数不合法',
        details: parsed.error.issues,
      });
    }
    const response = await this.turns.history(parsed.data.sessionId, parsed.data.limit);
    return AgentTurnHistoryResponseSchema.parse(response);
  }

  /** 「看依据」：这一轮当时命中了哪些切片、哪些被门控排除了、为什么。 */
  @Get('agent/turns/:turnId/evidence')
  async evidence(@Param('turnId') turnId: string): Promise<AgentTurnEvidenceResponse> {
    if (!turnId) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '缺少回合 id' });
    }
    return this.turns.evidence(turnId);
  }

  /**
   * 回看某一轮：从库里取出当时那张卡，原样重放。
   *
   * 不重新调模型 —— 同一个问题两次生成的卡不一样，历史会自己变形。
   */
  @Get('agent/turns/:turnId')
  async get(@Param('turnId') turnId: string): Promise<AgentTurnResponse> {
    if (!turnId) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '缺少回合 id' });
    }
    return AgentTurnResponseSchema.parse(await this.turns.get(turnId));
  }
}
