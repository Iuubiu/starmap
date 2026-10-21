import {
  Controller,
  Get,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  StreamableFile,
  UseFilters,
} from '@nestjs/common';
import {
  LevelVideoClipListResponseSchema,
  VideoClipListResponseSchema,
  type LevelVideoClipListResponse,
  type VideoClip,
  type VideoClipListResponse,
} from '@starmap/api-contract';
import type { Request, Response } from 'express';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { DatabaseService } from '../db/database.service.js';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { VideoService } from './video.service.js';

/**
 * 课程视频片段的 HTTP 端点（票 19）。
 *
 * ## 为什么控制器自己 `new VideoService`
 *
 * `app.module.ts` 的 providers 是多人合并点（多条泳道并行时改它必冲突）。
 * 这个服务的依赖只有 `DatabaseService`，而后者已经在 AppModule 的 providers
 * 里 —— 现场 `new` 一个不产生新的依赖解析需求，也就完全不必动那个文件。
 * 与 `MarketController` / `GenerationController` 的取舍一致。
 *
 * ## 为什么播放接口返回二进制而不是 JSON
 *
 * `<video src>` 只认媒体流。把 mp4 塞进 JSON 的 base64 字段会让浏览器先下载
 * 整个文件再解码，30 秒的片段就要等几秒才起播，而且完全不能拖进度条。
 *
 * ## 为什么支持 Range
 *
 * 拖进度条、边下边播、Safari 的媒体加载都依赖 `Range` 请求与 206 响应。
 * 只给 200 + 完整内容时，Chrome 能动（自己缓冲够了），Safari 直接不播。
 */
@Controller()
@UseFilters(ApiExceptionFilter)
export class VideoController {
  private readonly video: VideoService;

  constructor(@Inject(DatabaseService) db: DatabaseService) {
    this.video = new VideoService(db);
  }

  /**
   * 按知识点列片段。
   *
   * 没有 `microKpId` 时返回全部 —— 这是给内容作者自查用的：
   * 「这一批视频一共切出了多少片、各挂在哪里」。
   */
  @Get('api/v1/video/clips')
  async list(@Query('microKpId') microKpId?: string): Promise<VideoClipListResponse> {
    const payload = await this.video.listClips(microKpId ?? null);
    return VideoClipListResponseSchema.parse(payload);
  }

  /**
   * 按关卡列片段。
   *
   * 关卡不存在 → 404（不是空数组）：关卡 id 写错和「这个知识点没有视频」
   * 是两件事，前者要报错、后者要显示「还没有讲解视频」。
   */
  @Get('api/v1/levels/:levelId/video-clips')
  async listByLevel(@Param('levelId') levelId: string): Promise<LevelVideoClipListResponse> {
    const payload = await this.video.listClipsForLevel(levelId);
    if (!payload) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `关卡不存在: ${levelId}` });
    }
    return LevelVideoClipListResponseSchema.parse(payload);
  }

  /**
   * 流式播放一个片段，支持 Range。
   *
   * 用 `@Res({ passthrough: true })` 是为了能自己设 `206`/`Content-Range`
   * 头，同时仍然让 Nest 的异常过滤器接管错误分支（直接 `@Res()` 会跳过它，
   * 401/404 就变成裸响应）。
   */
  @Get('media/clips/:clipId')
  async stream(@Param('clipId') clipId: string, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const clip = await this.video.findClip(clipId);
    if (!clip) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `片段不存在: ${clipId}` });
    }

    const absolute = this.video.resolveClipPath(clip.filePath);
    if (!existsSync(absolute)) {
      // 文件在库里登记了但盘上没有：这是部署问题，不是「片段不存在」。
      // 用 404 而不是 500 是因为对调用方来说两者的动作一样（重新生成产物），
      // 而 500 会触发前端无限重试。
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `片段文件不在磁盘上: ${clip.filePath}（需要重新运行 tools/video/run.py 生成产物）`,
      });
    }

    const size = statSync(absolute).size;
    const range = req.headers.range;

    if (range) {
      const parsed = parseRange(range, size);
      if (!parsed) {
        // 语法不合法或越界：按 RFC 7233 回 416。
        //
        // 用 `HttpException(..., 416)` 而不是「先 res.status(416) 再 throw」：
        // 抛出去的异常会被 `ApiExceptionFilter` 接管，那个过滤器按 status 重新
        // 写响应头 —— 先设的 416 会被它改成 404，客户端只看到「不存在」。
        res.setHeader('Content-Range', `bytes */${size}`);
        throw new HttpException(
          { code: 'VALIDATION_FAILED', message: `Range 不合法: ${range}` },
          416,
        );
      }
      const { start, end } = parsed;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', String(end - start + 1));
      res.setHeader('Content-Type', 'video/mp4');
      return new StreamableFile(createReadStream(absolute, { start, end }));
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', String(size));
    res.setHeader('Content-Type', 'video/mp4');
    return new StreamableFile(createReadStream(absolute));
  }
}

/**
 * 解析 `Range: bytes=start-end`。返回 `null` 表示不合法/不可满足。
 *
 * 只支持单区间（`bytes=0-`、`bytes=100-200`、`bytes=-500`）。多区间
 * （`bytes=0-1,5-6`）返回 null —— 浏览器播放器从不发多区间，支持它要写
 * multipart/byteranges 的编码，是纯负担。
 */
export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  let start: number;
  let end: number;
  if (!rawStart) {
    // `bytes=-500` = 最后 500 字节
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (start > end || start >= size) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

/**
 * 这个文件**不再**定义 `contentRoot()`。
 *
 * 它原先住在这里，`video.service.ts` 为了解析片段绝对路径 import 回去，于是
 * dependency-cruiser 的 `no-circular`（error 级）报 controller → service → controller。
 * 纯路径函数挪到 `./paths.js` 后环断开；这里仍然转出去一行，是为了让既有的
 * 集成测试（`import { contentRoot } from './video.controller.js'`）不必改 import。
 */
export { contentRoot, join } from './paths.js';
