/**
 * 课程视频领域的 paths 片段（票 19）。
 *
 * 归属泳道：authoring-dev。与 `src/domains/video.ts` 配对：
 * 加 schema 去那边，加路由来这边。
 *
 * 三条路由，对应三种查询入口：
 * - 按知识点：内容作者/调试用，看「这个知识点挂了哪些讲解片段」
 * - 按关卡：关卡页「看讲解」按钮用，后端替调用方把 level → microKp 走一步
 * - 流式播放：`GET /media/clips/{clipId}.mp4`，支持 Range
 */
import {
  LevelVideoClipListResponseSchema,
  VideoAlignmentSchema,
  VideoClipListResponseSchema,
  VideoClipSchema,
} from '../../dist/index.js';
import { jsonResponse, jsonSchema, pathParam } from './_shared.mjs';

export const components = {
  VideoAlignment: jsonSchema(VideoAlignmentSchema),
  // 用未 refine 的 VideoClipSchema 渲染组件形状：refine 是「运行时校验规则」，
  // 不是 JSON Schema 能表达的额外结构。响应校验仍然用带 refine 的版本（见 domains）。
  VideoClip: jsonSchema(VideoClipSchema),
  VideoClipListResponse: jsonSchema(VideoClipListResponseSchema),
  LevelVideoClipListResponse: jsonSchema(LevelVideoClipListResponseSchema),
};

/** 错误体统一走 `ApiError`（common 领域已定义，这里只引用不重定义） */
const err = (description) => jsonResponse(description, 'ApiError');

export const paths = {
  /**
   * 按知识点查讲解片段。
   *
   * ## 为什么空数组是 200 而不是 404
   *
   * 「这个知识点没有配视频」是正常状态（大多知识点确实没有），不是错误。
   * 返回 404 会让前端把「没视频」和「知识点 id 写错了」混为一谈 —— 而这两种
   * 情况在页面上要显示完全不同的文案。
   *
   * ## 为什么带 `sourceUrl` 与 `reason`
   *
   * 票面第七条要求每个片段可追溯来源；第五条要求每片有「为什么从这里开始/
   * 结束」的可读理由。这两件事都不能只躺在数据库里。
   */
  '/api/v1/video/clips': {
    get: {
      operationId: 'listVideoClips',
      summary: '按知识点列出课程视频片段',
      description:
        '返回挂在该知识点上的全部片段（按视频与起点排序）。每个片段带 `playUrl`（相对路径）、' +
        '起止秒数、可读的切分理由、对齐证据，以及可追溯的来源字段（`sourceUrl`、' +
        '`downloadedAt`、`asrModel` 等）。\n\n' +
        '`microKpId` 不给时返回全部片段（调试/管理用）。没有片段时返回空数组。',
      parameters: [
        {
          name: 'microKpId',
          in: 'query',
          required: false,
          schema: { type: 'string' },
          description: '知识点 id，例如 `kp-wangzhiying-1989-p34-前置放大器的作用`',
        },
      ],
      responses: {
        '200': jsonResponse('片段列表（可能为空）', 'VideoClipListResponse'),
        '500': err('服务内部错误'),
      },
    },
  },

  /**
   * 按关卡查讲解片段。
   *
   * 关卡页的「看讲解」按钮走这条：关卡 → 它所属的 micro_kp → 挂在该知识点上的
   * 片段。放在服务端做这一步而不是让前端先查关卡再查片段，是因为前端拿到的
   * 关卡详情里只有 `microKpId`，而「该知识点的片段」需要另一跳；两跳合成一跳
   * 少一次往返，也少一处前端自己拼查询参数。
   */
  '/api/v1/levels/{levelId}/video-clips': {
    get: {
      operationId: 'listLevelVideoClips',
      summary: '按关卡列出它所属知识点的讲解片段',
      description:
        '关卡不存在时 404。关卡存在但它所属的知识点没有配视频时返回空数组（正常状态）。\n\n' +
        '响应里的 `microKpId` 是关卡的归属知识点，前端可以在空结果时说清' +
        '「这个知识点还没有讲解视频」而不是「加载失败」。',
      parameters: [pathParam('levelId')],
      responses: {
        '200': jsonResponse('片段列表（可能为空）', 'LevelVideoClipListResponse'),
        '404': err('关卡不存在'),
        '500': err('服务内部错误'),
      },
    },
  },

  /**
   * 流式播放一个片段（支持 Range）。
   *
   * 用 `GET` 且带 206 响应：视频播放器要求 Range 支持，否则不能拖动进度条。
   * 这不是普通 JSON 接口，所以响应体是 `video/mp4` 二进制而不是 `ApiError`
   * 形状的 JSON —— 播放器直接把它喂给 `<video src>`。
   */
  '/media/clips/{clipId}': {
    get: {
      operationId: 'streamVideoClip',
      summary: '流式播放一个视频片段（支持 HTTP Range）',
      description:
        '返回 `video/mp4`。支持 `Range` 请求头，响应 206 与 `Content-Range`；' +
        '不支持 Range 的客户端会拿到 200 与完整内容。\n\n' +
        '片段不存在时 404；`file_path` 指向的文件已丢失时 404（不是 500 —— ' +
        '那是内容部署问题，不是服务故障）。',
      parameters: [pathParam('clipId')],
      responses: {
        '200': {
          description: '完整视频内容',
          content: { 'video/mp4': { schema: { type: 'string', format: 'binary' } } },
        },
        '206': {
          description: 'Range 片段',
          content: { 'video/mp4': { schema: { type: 'string', format: 'binary' } } },
        },
        '404': jsonResponse('片段或文件不存在', 'ApiError'),
        '500': jsonResponse('服务内部错误', 'ApiError'),
      },
    },
  },
};
