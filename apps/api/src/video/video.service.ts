import { Inject, Injectable } from '@nestjs/common';
import type {
  LevelVideoClipListResponse,
  VideoAlignment,
  VideoClip,
  VideoClipListResponse,
} from '@starmap/api-contract';
import { DatabaseService } from '../db/database.service.js';
import { contentPath } from './paths.js';

/**
 * 行形状写成 `type` 而不是 `interface`：`DatabaseService.query<T>` 的约束是
 * `T extends Record<string, unknown>`，而 TypeScript 只给匿名对象类型/类型别名
 * 隐式索引签名，interface 没有 → 会报 TS2344。
 */
type ClipRow = {
  id: string;
  video_id: string;
  micro_kp_id: string | null;
  micro_kp_name: string | null;
  title: string;
  start_sec: string;
  end_sec: string;
  duration_sec: string;
  file_path: string;
  transcript_excerpt: string | null;
  reason: string | null;
  alignment_evidence: unknown;
  source_url: string;
  uploader: string | null;
  downloaded_at: string | Date | null;
  asr_model: string | null;
  origin: string;
  note: string | null;
};

const CLIP_COLUMNS = `
    c.id,
    c.video_id,
    c.micro_kp_id,
    kp.name AS micro_kp_name,
    c.title,
    c.start_sec,
    c.end_sec,
    c.duration_sec,
    c.file_path,
    c.transcript_excerpt,
    c.reason,
    c.alignment_evidence,
    s.source_url,
    s.uploader,
    s.downloaded_at,
    s.asr_model,
    s.origin,
    s.note
`;

const CLIP_FROM = `
  FROM video_clips c
  JOIN video_sources s ON s.video_id = c.video_id
  LEFT JOIN knowledge_points kp ON kp.id = c.micro_kp_id
`;

/**
 * 课程视频片段的读写。
 *
 * 只读：产物由 `tools/video/run.py import` 投影进库（那时已经做完切片与对齐）。
 * 这个服务不切视频、不转写 —— 那是离线管线的事，理由是切片要重跑几十次，
 * 而 HTTP 请求不该等 30 分钟的 ASR。
 */
@Injectable()
export class VideoService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** 按知识点（或全量）列片段。 */
  async listClips(microKpId: string | null): Promise<VideoClipListResponse> {
    const rows = microKpId
      ? await this.db.query<ClipRow>(
          `SELECT ${CLIP_COLUMNS} ${CLIP_FROM} WHERE c.micro_kp_id = $1
           ORDER BY c.video_id, c.start_sec`,
          [microKpId],
        )
      : await this.db.query<ClipRow>(
          `SELECT ${CLIP_COLUMNS} ${CLIP_FROM}
           ORDER BY c.micro_kp_id NULLS LAST, c.video_id, c.start_sec`,
          [],
        );
    return { microKpId, items: rows.map(toClip) };
  }

  /**
   * 按关卡列片段。关卡不存在时返回 null（控制器翻成 404）。
   *
   * `micro_kp_id` 可能是 NULL（关卡被删过又重建之类）时返回空列表而不是
   * 抛错：调用方只想要「这个关卡有没有视频可看」。
   */
  async listClipsForLevel(levelId: string): Promise<LevelVideoClipListResponse | null> {
    const levels = await this.db.query<{ micro_kp_id: string }>(
      'SELECT micro_kp_id FROM levels WHERE id = $1',
      [levelId],
    );
    const level = levels[0];
    if (!level) return null;

    const rows = await this.db.query<ClipRow>(
      `SELECT ${CLIP_COLUMNS} ${CLIP_FROM} WHERE c.micro_kp_id = $1
       ORDER BY c.video_id, c.start_sec`,
      [level.micro_kp_id],
    );
    return {
      levelId,
      microKpId: level.micro_kp_id,
      items: rows.map(toClip),
    };
  }

  /** 播放接口用：拿到落盘路径。不存在返回 null。 */
  async findClip(clipId: string): Promise<{ filePath: string } | null> {
    const rows = await this.db.query<{ file_path: string }>(
      'SELECT file_path FROM video_clips WHERE id = $1',
      [clipId],
    );
    const row = rows[0];
    return row ? { filePath: row.file_path } : null;
  }

  /**
   * 把库里存的相对路径拼成绝对路径。
   *
   * 存相对路径的理由见 0050 迁移的注释：绝对路径换机器就全失效。
   * 越界检查全部收在 `contentPath()` 里（那一条是 `/media` 唯一的安全边界，
   * 将来插图走 `/media/figures/*` 时应该复用它，而不是再写一遍前缀判定）。
   *
   * 抛出去的是普通 `Error` —— 越界意味着**库里存了坏数据**，不是客户端发错
   * 参数，所以让 `ApiExceptionFilter` 当成 500 处理；当成 404 会把它伪装成
   * 「这个片段不存在」，掩盖数据损坏。
   */
  resolveClipPath(filePath: string): string {
    return contentPath(filePath);
  }
}

/** 数据库行 → 契约形状。数值列是 numeric，pg 会给字符串，这里转成 number。 */
function toClip(row: ClipRow): VideoClip {
  const alignments = parseAlignments(row.alignment_evidence);
  return {
    clipId: row.id,
    videoId: row.video_id,
    microKpId: row.micro_kp_id,
    microKpName: row.micro_kp_name,
    title: row.title,
    startSec: Number(row.start_sec),
    endSec: Number(row.end_sec),
    durationSec: Number(row.duration_sec),
    // playUrl 与契约路径 `/media/clips/{clipId}` 逐字对应：**不带 `.mp4` 后缀**。
    // 早先写的是 `/media/clips/${id}.mp4`，而控制器按 `clipId` 查库 →
    // 查的是 `xxx.mp4`，永远查不到，所有播放请求 404。
    playUrl: `/media/clips/${encodeURIComponent(row.id)}`,
    transcriptExcerpt: row.transcript_excerpt,
    reason: row.reason,
    alignments,
    sourceUrl: row.source_url ?? '',
    uploadedBy: row.uploader,
    downloadedAt: toIso(row.downloaded_at),
    asrModel: row.asr_model,
    sourceOrigin: normalizeOrigin(row.origin),
    sourceNote: row.note,
  };
}

function normalizeOrigin(value: string): 'yt-dlp' | 'local-file' | 'unknown' {
  if (value === 'yt-dlp' || value === 'local-file') return value;
  return 'unknown';
}

function toIso(value: string | Date | null): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * `alignment_evidence` 是 jsonb，pg 会给已经解析好的数组/对象。
 * 但历史数据可能是字符串（手工写库时），所以两种都接受；形状不对时返回空数组
 * 而不是抛错 —— 一个片段的对齐证据坏了不该让整个列表 500。
 */
function parseAlignments(raw: unknown): VideoAlignment[] {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: VideoAlignment[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const microKpId = typeof record.microKpId === 'string' ? record.microKpId : null;
    const name = typeof record.name === 'string' ? record.name : null;
    if (!microKpId || !name) continue;
    out.push({
      microKpId,
      name,
      score: typeof record.score === 'number' ? record.score : 0,
      hits: typeof record.hits === 'number' ? record.hits : 0,
      evidence: typeof record.evidence === 'string' ? record.evidence : '',
    });
  }
  return out;
}
