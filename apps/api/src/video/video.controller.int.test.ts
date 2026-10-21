import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../db/database.service.js';
import { LLM_PORT } from '../llm/llm.port.js';
import { ScriptedLlm } from '../llm/scripted-llm.js';
import { createTestSchema } from '../../test/test-schema.js';
import { assertMatchesContract } from '../../test/contract.js';
import { VideoController, contentRoot } from './video.controller.js';

/**
 * 课程视频端点的集成测试（票 19）。
 *
 * 连真库（`createTestSchema` 重放迁移）而不是 mock：这个接口的语义主要在
 * SQL 里（JOIN knowledge_points 拿名字、按 level 反查 micro_kp），mock 掉
 * 就等于不测。
 *
 * 唯一被 mock 的是**文件系统里那个 mp4**：测试在 `content/videos/_vitest/`
 * 下造一个几十字节的假文件（测试结束删掉）。真去切一段真视频会让这个套件
 * 依赖 ffmpeg 与几十 MB 的素材，而这里要验的是「Range 能不能正确回 206」，
 * 与文件内容是不是真视频无关。
 */
describe('VideoController', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let schema: { name: string; drop: () => Promise<void> };
  const FIXTURE_DIR = join(contentRoot(), 'videos', '_vitest');
  const FIXTURE_FILE = join(FIXTURE_DIR, 'fake-clip.mp4');

  beforeAll(async () => {
    schema = await createTestSchema();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [VideoController],
    })
      .overrideProvider(LLM_PORT)
      .useValue(new ScriptedLlm([{ text: '假的' }]))
      .compile();
    app = moduleRef.createNestApplication();
    db = app.get(DatabaseService);
    await db.useSchema(schema.name);
    await app.init();

    // 夹具：一个知识点 + 一张关卡 + 一个来源 + 两个片段
    await db.query(
      `INSERT INTO subjects (id, name) VALUES ('vid-subj', '核电子学') ON CONFLICT DO NOTHING`,
    );
    await db.query(
      `INSERT INTO modules (id, subject_id, name, tier) VALUES ('vid-mod', 'vid-subj', '前置放大器', 'D')
       ON CONFLICT DO NOTHING`,
    );
    await db.query(
      `INSERT INTO knowledge_points (id, module_id, name, is_leaf) VALUES
         ('vid-kp-preamp', 'vid-mod', '前置放大器的作用', true),
         ('vid-kp-other', 'vid-mod', '另一个知识点', true)
       ON CONFLICT DO NOTHING`,
    );
    await db.query(
      `INSERT INTO levels (id, micro_kp_id, title, kind, ordinal, spec) VALUES
         ('vid-lv', 'vid-kp-preamp', '前置放大器', 'teach', 1, '{}'::jsonb)
       ON CONFLICT DO NOTHING`,
    );
    await db.query(
      `INSERT INTO video_sources (video_id, source_url, title, duration_sec, uploader,
                                  downloaded_at, asr_model, transcript_source, origin)
       VALUES ('vid-bv1', 'https://www.bilibili.com/video/BV1VE411e7UP?p=9',
               '核电子学 37 讲 p9 前置放大器', 1993.683, '张雪梅',
               '2026-10-21T03:00:00Z', 'faster-whisper:small:int8', 'faster-whisper', 'yt-dlp')`,
    );
    await db.query(
      `INSERT INTO video_clips (id, video_id, micro_kp_id, title, start_sec, end_sec,
                                duration_sec, file_path, transcript_excerpt, reason,
                                alignment_evidence, downloaded_at)
       VALUES
         ('vid-bv1-c01', 'vid-bv1', 'vid-kp-preamp', '前置放大器', 0, 300, 300,
          'videos/_vitest/fake-clip.mp4', '那么我们现在开始讲前置放大器',
          '视频一开头就是讲解内容；停在 5:00：为控制单片时长',
          '[{"microKpId":"vid-kp-preamp","name":"前置放大器","score":15,"hits":3,"evidence":"命中知识点名「前置放大器」3 次（5 字）"}]'::jsonb,
          '2026-10-21T03:00:00Z'),
         ('vid-bv1-c02', 'vid-bv1', NULL, '前置放大器', 300, 600, 300,
          'videos/_vitest/fake-clip.mp4', '接着看噪声',
          '从 5:00 续切；停在 10:00：之后有 2.0s 停顿', '[]'::jsonb,
          '2026-10-21T03:00:00Z')`,
    );

    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(FIXTURE_FILE, Buffer.alloc(2048, 7));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await schema?.drop();
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  it('按知识点列片段，带名字、可追溯字段与对齐证据', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/video/clips?microKpId=vid-kp-preamp')
      .expect(200);
    assertMatchesContract('/api/v1/video/clips', 'get', 200, res.body);
    expect(res.body.items).toHaveLength(1);
    const clip = res.body.items[0];
    expect(clip.microKpName).toBe('前置放大器的作用');
    expect(clip.sourceUrl).toBe('https://www.bilibili.com/video/BV1VE411e7UP?p=9');
    expect(clip.asrModel).toBe('faster-whisper:small:int8');
    expect(clip.alignments[0].evidence).toContain('前置放大器');
    // 这里断言的是**契约路径** `/media/clips/{clipId}`（不带 `.mp4`）。
    // 早先这个断言写的是 `/media/clips/vid-bv1-c01.mp4`，而实现也正好带上
    // 了后缀 —— 两边一致，测试绿了，但控制器按 clipId 查库永远查不到，
    // 所有播放请求实际 404。断言“实现长什么样”而不是“契约长什么样”
    // 正是这种 bug 能活下来的原因；下面另有一条用例真的去 GET 这个 playUrl。
    expect(clip.playUrl).toBe('/media/clips/vid-bv1-c01');
    expect(clip.reason).toContain('视频一开头就是讲解内容');
  });

  it('不给 microKpId 时返回全部片段', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/video/clips').expect(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
    expect(res.body.microKpId).toBeNull();
  });

  it('按关卡查片段：关卡 → 它所属知识点 → 片段', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/levels/vid-lv/video-clips')
      .expect(200);
    assertMatchesContract('/api/v1/levels/{levelId}/video-clips', 'get', 200, res.body);
    expect(res.body.levelId).toBe('vid-lv');
    expect(res.body.microKpId).toBe('vid-kp-preamp');
    expect(res.body.items).toHaveLength(1);
  });

  it('关卡不存在 → 404（不是空数组）', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/levels/vid-nope/video-clips')
      .expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('没有片段的关卡返回空数组而不是 404', async () => {
    await db.query(
      `INSERT INTO levels (id, micro_kp_id, title, kind, ordinal, spec)
       VALUES ('vid-lv-empty', 'vid-kp-other', '空的', 'teach', 2, '{}'::jsonb) ON CONFLICT DO NOTHING`,
    );
    const res = await request(app.getHttpServer())
      .get('/api/v1/levels/vid-lv-empty/video-clips')
      .expect(200);
    expect(res.body.items).toEqual([]);
  });

  it('列表里给出的 playUrl 真的能拉到视频（URL 与播放路由逐字对应）', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/video/clips?microKpId=vid-kp-preamp')
      .expect(200);
    const playUrl = list.body.items[0].playUrl as string;

    const media = await request(app.getHttpServer()).get(playUrl).expect(200);
    expect(media.headers['content-type']).toContain('video/mp4');
    expect(Number(media.headers['content-length'])).toBe(2048);
  });

  it('播放：不带 Range 返回 200 与完整内容', async () => {
    const res = await request(app.getHttpServer()).get('/media/clips/vid-bv1-c01').expect(200);
    expect(res.headers['content-type']).toContain('video/mp4');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(Number(res.headers['content-length'])).toBe(2048);
  });

  it('播放：带 Range 返回 206 与 Content-Range', async () => {
    const res = await request(app.getHttpServer())
      .get('/media/clips/vid-bv1-c01')
      .set('Range', 'bytes=100-199')
      .expect(206);
    expect(res.headers['content-range']).toBe('bytes 100-199/2048');
    expect(Number(res.headers['content-length'])).toBe(100);
  });

  it('播放：Range 越界 → 416', async () => {
    const res = await request(app.getHttpServer())
      .get('/media/clips/vid-bv1-c01')
      .set('Range', 'bytes=5000-')
      .expect(416);
    expect(res.headers['content-range']).toBe('bytes */2048');
  });

  it('播放：片段不存在 → 404', async () => {
    const res = await request(app.getHttpServer()).get('/media/clips/vid-nope').expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('播放：库里有登记但文件不在盘上 → 404 且说明要重跑产物', async () => {
    await db.query(
      `INSERT INTO video_clips (id, video_id, micro_kp_id, title, start_sec, end_sec,
                                duration_sec, file_path, alignment_evidence)
       VALUES ('vid-bv1-gone', 'vid-bv1', NULL, 'x', 0, 60, 60,
               'videos/_vitest/does-not-exist.mp4', '[]'::jsonb)`,
    );
    const res = await request(app.getHttpServer()).get('/media/clips/vid-bv1-gone').expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toContain('tools/video/run.py');
  });

  it('数据库 CHECK 挡住超过 6 分钟的片段', async () => {
    await expect(
      db.query(
        `INSERT INTO video_clips (id, video_id, micro_kp_id, title, start_sec, end_sec,
                                  duration_sec, file_path, alignment_evidence)
         VALUES ('vid-too-long', 'vid-bv1', NULL, 'x', 0, 400, 400, 'x.mp4', '[]'::jsonb)`,
      ),
    ).rejects.toThrow(/video_clips_max_len|check constraint/i);
  });
});
