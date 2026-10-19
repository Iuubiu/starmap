import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorBody } from '@starmap/api-contract';

/**
 * 统一错误结构 `{ code, message, details? }`（spec §契约）。
 * 前端只需要认一种形状，不要为每个接口写一个错误分支。
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const body: ApiErrorBody =
        typeof payload === 'object' && payload !== null && 'code' in payload
          ? (payload as ApiErrorBody)
          : {
              code: mapStatusToCode(status),
              message: exception.message,
            };
      res.status(status).json(body);
      return;
    }

    const message = exception instanceof Error ? exception.message : String(exception);
    this.logger.error(`未处理异常: ${message}`, exception instanceof Error ? exception.stack : '');

    // 不把内部错误细节泄露给前端；细节留在日志
    const body: ApiErrorBody = {
      code: 'INTERNAL',
      message: '服务器内部错误',
    };
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }
}

function mapStatusToCode(status: number): ApiErrorBody['code'] {
  switch (status) {
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.BAD_REQUEST:
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'VALIDATION_FAILED';
    case HttpStatus.BAD_GATEWAY:
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'UPSTREAM_UNAVAILABLE';
    default:
      return 'INTERNAL';
  }
}
