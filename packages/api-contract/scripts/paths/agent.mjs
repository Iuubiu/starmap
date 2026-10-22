/**
 * 智能体与检索领域的 paths 片段（票 08 / 09 / 10 / 15）。
 *
 * 归属泳道：agent-dev。本文件与该泳道的 `src/domains/agent.ts` 配对：
 * 加 schema 去那边，加路由来这边。两处都只 append。
 *
 * component 名**全局唯一**（`collect-paths.mjs` 重名直接失败）—— 因为 Orval
 * 的类型名只由 component 名决定，重名会让两条泳道的类型悄悄合并成一个。
 * 前缀 `Agent` / `Skill` 是本泳道的命名空间。
 */
import {
  AgentTurnRequestSchema,
  AgentTurnResponseSchema,
  AgentTurnHistoryResponseSchema,
  AgentTurnEvidenceResponseSchema,
  RetrievalDebugResponseSchema,
  RetrievalBandsResponseSchema,
  RetrievalExpansionSchema,
  ProbeStartRequestSchema,
  ProbeReplyRequestSchema,
  ProbeTurnResponseSchema,
  ProbeSessionResponseSchema,
  ProbeMetricsResponseSchema,
  SkillListResponseSchema,
  SkillDetailResponseSchema,
  SkillToggleRequestSchema,
  SkillSystemPreviewResponseSchema,
} from '../../dist/index.js';
import { jsonResponse, jsonSchema, pathParam } from './_shared.mjs';

const errorResponses = {
  '400': jsonResponse('请求参数不合法', 'ApiError'),
  '500': jsonResponse('服务内部错误', 'ApiError'),
};

const jsonBody = (schemaName) => ({
  required: true,
  content: { 'application/json': { schema: { $ref: `#/components/schemas/${schemaName}` } } },
});

export const components = {
  AgentTurnRequest: jsonSchema(AgentTurnRequestSchema),
  ProbeStartRequest: jsonSchema(ProbeStartRequestSchema),
  ProbeReplyRequest: jsonSchema(ProbeReplyRequestSchema),
  SkillToggleRequest: jsonSchema(SkillToggleRequestSchema),
  AgentTurnResponse: jsonSchema(AgentTurnResponseSchema),
  AgentTurnHistoryResponse: jsonSchema(AgentTurnHistoryResponseSchema),
  AgentTurnEvidenceResponse: jsonSchema(AgentTurnEvidenceResponseSchema),
  RetrievalDebugResponse: jsonSchema(RetrievalDebugResponseSchema),
  RetrievalBandsResponse: jsonSchema(RetrievalBandsResponseSchema),
  RetrievalExpansion: jsonSchema(RetrievalExpansionSchema),
  ProbeTurnResponse: jsonSchema(ProbeTurnResponseSchema),
  ProbeSessionResponse: jsonSchema(ProbeSessionResponseSchema),
  ProbeMetricsResponse: jsonSchema(ProbeMetricsResponseSchema),
  SkillListResponse: jsonSchema(SkillListResponseSchema),
  SkillDetailResponse: jsonSchema(SkillDetailResponseSchema),
  SkillSystemPreviewResponse: jsonSchema(SkillSystemPreviewResponseSchema),
};

export const paths = {
  '/api/v1/agent/turns': {
    post: {
      operationId: 'createAgentTurn',
      summary: '提交一句话，产出一张结构化产物卡',
      requestBody: jsonBody('AgentTurnRequest'),
      responses: {
        '200': jsonResponse('本轮的产物卡与可见回复', 'AgentTurnResponse'),
        '400': errorResponses['400'],
        '502': jsonResponse('模型上游不可用', 'ApiError'),
        '500': errorResponses['500'],
      },
    },
    get: {
      operationId: 'listAgentTurns',
      summary: '某个会话的学习日志（不是消息流）',
      parameters: [
        { name: 'sessionId', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } },
      ],
      responses: {
        '200': jsonResponse('学习日志', 'AgentTurnHistoryResponse'),
        '400': errorResponses['400'],
        '500': errorResponses['500'],
      },
    },
  },
  '/api/v1/agent/turns/{turnId}/evidence': {
    get: {
      operationId: 'getAgentTurnEvidence',
      summary: '「看依据」：本轮用到了哪些切片，哪些被门控排除',
      parameters: [pathParam('turnId')],
      responses: {
        '200': jsonResponse('依据清单', 'AgentTurnEvidenceResponse'),
        '404': jsonResponse('回合不存在', 'ApiError'),
        '500': errorResponses['500'],
      },
    },
  },
  '/api/v1/agent/turns/{turnId}': {
    get: {
      operationId: 'getAgentTurn',
      summary: '回看某一轮：取出当时那张卡，原样重放（不重新调模型）',
      parameters: [pathParam('turnId')],
      responses: {
        '200': jsonResponse('那一轮的完整响应', 'AgentTurnResponse'),
        '404': jsonResponse('回合不存在', 'ApiError'),
        '500': errorResponses['500'],
      },
    },
  },
  '/api/v1/agent/retrieval/debug': {
    get: {
      operationId: 'debugRetrieval',
      summary: '检索调试器：命中切片、是否答案块、被排除的具体原因',
      parameters: [
        { name: 'query', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'microKpId', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50 } },
      ],
      responses: {
        '200': jsonResponse('调试结果', 'RetrievalDebugResponse'),
        '400': errorResponses['400'],
        '404': jsonResponse('知识点不存在', 'ApiError'),
        '500': errorResponses['500'],
      },
    },
  },
  '/api/v1/agent/retrieval/bands': {
    get: {
      operationId: 'getRetrievalBands',
      summary: '同一 query 在三档掌握度下的集合差异',
      parameters: [
        { name: 'query', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'microKpId', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50 } },
      ],
      responses: {
        '200': jsonResponse('三档对比', 'RetrievalBandsResponse'),
        '400': errorResponses['400'],
        '404': jsonResponse('知识点不存在', 'ApiError'),
        '500': errorResponses['500'],
      },
    },
  },
  '/api/v1/agent/probes': {
    post: {
      operationId: 'startProbe',
      summary: '开始一次苏格拉底追问，返回新会话的初始阶梯状态',
      requestBody: jsonBody('ProbeStartRequest'),
      responses: {
        // 返回**会话**而不是回合：第一次提问需要先读到回答，那是
        // `POST /agent/probes/{probeId}/replies` 的事。这里只建会话并给出
        // 起始档位（P1 从第 1 级、P2 从第 2 级、P3 从第 3 级），
        // `turns` 为 0、`askedQuestions` 为空。
        '200': jsonResponse('新会话（尚未提问）', 'ProbeSessionResponse'),
        '400': errorResponses['400'],
        '404': jsonResponse('知识点不存在', 'ApiError'),
        '500': errorResponses['500'],
      },
    },
  },
  '/api/v1/agent/probes/metrics': {
    get: {
      operationId: 'getProbeMetrics',
      summary: '追问越界统计（按拒绝原因分类）',
      responses: {
        '200': jsonResponse('统计', 'ProbeMetricsResponse'),
        '500': errorResponses['500'],
      },
    },
  },
  '/api/v1/agent/probes/{probeId}': {
    get: {
      operationId: 'getProbeSession',
      summary: '追问会话状态',
      parameters: [pathParam('probeId')],
      responses: {
        '200': jsonResponse('会话状态', 'ProbeSessionResponse'),
        '404': jsonResponse('追问不存在', 'ApiError'),
        '500': errorResponses['500'],
      },
    },
  },
  '/api/v1/agent/probes/{probeId}/replies': {
    post: {
      operationId: 'replyProbe',
      summary: '提交一句回答，状态机决定下一步',
      parameters: [pathParam('probeId')],
      requestBody: jsonBody('ProbeReplyRequest'),
      responses: {
        '200': jsonResponse('下一轮', 'ProbeTurnResponse'),
        '400': errorResponses['400'],
        '404': jsonResponse('追问不存在', 'ApiError'),
        '500': errorResponses['500'],
      },
    },
  },
  '/api/v1/agent/skills': {
    get: {
      operationId: 'listSkills',
      summary: '扫描到的 skill 列表与启用状态',
      responses: {
        '200': jsonResponse('skill 列表', 'SkillListResponse'),
        '500': errorResponses['500'],
      },
    },
  },
  '/api/v1/agent/skills/system-preview': {
    get: {
      operationId: 'getSkillSystemPreview',
      summary: '此刻 agent 的 system message 里会出现哪些 skill',
      responses: {
        '200': jsonResponse('system message 预览', 'SkillSystemPreviewResponse'),
        '500': errorResponses['500'],
      },
    },
  },
  '/api/v1/agent/skills/{name}': {
    get: {
      operationId: 'getSkill',
      summary: '单个 skill 的正文与 references 清单',
      parameters: [pathParam('name')],
      responses: {
        '200': jsonResponse('skill 详情', 'SkillDetailResponse'),
        '404': jsonResponse('skill 不存在', 'ApiError'),
        '500': errorResponses['500'],
      },
    },
    patch: {
      operationId: 'toggleSkill',
      summary: '启用/禁用 skill（持久化，重启保持）',
      parameters: [pathParam('name')],
      requestBody: jsonBody('SkillToggleRequest'),
      responses: {
        '200': jsonResponse('更新后的详情', 'SkillDetailResponse'),
        '400': errorResponses['400'],
        '404': jsonResponse('skill 不存在', 'ApiError'),
        '500': errorResponses['500'],
      },
    },
  },
};
