/**
 * 关卡领域的 paths 片段。
 *
 * 归属泳道：level-dev。本文件与该泳道的 `src/domains/levels.ts` 配对：
 * 加 schema 去那边，加路由来这边。两处都只 append。
 */
import {
  AttemptRecordSchema,
  AttemptSubmitRequestSchema,
  AttemptSubmitResponseSchema,
  GateEvaluationSchema,
  GateHistoryResponseSchema,
  GateResponseSchema,
  LevelDetailResponseSchema,
  LevelSummarySchema,
  MasteryViewSchema,
  ReviewCompleteResponseSchema,
  ReviewQueueResponseSchema,
  ReviewRoundDetailResponseSchema,
  ReviewRoundStartResponseSchema,
  UnlockStateSchema,
} from '../../dist/index.js';
import { LevelSpecSchema } from '@starmap/shared';
import { jsonResponse, jsonSchema, pathParam } from './_shared.mjs';

export const components = {
  LevelSummary: jsonSchema(LevelSummarySchema),
  // spec 的 JSON Schema 直接由 Zod 渲染。它是响应体的一部分，所以必须进组件，
  // 否则前端只能拿到一个 `additionalProperties: true` 的空对象去猜形状。
  LevelSpec: jsonSchema(LevelSpecSchema),
  LevelDetailResponse: jsonSchema(LevelDetailResponseSchema),
  // 票 05：作答与双字段掌握度
  AttemptSubmitRequest: jsonSchema(AttemptSubmitRequestSchema),
  AttemptRecord: jsonSchema(AttemptRecordSchema),
  MasteryView: jsonSchema(MasteryViewSchema),
  AttemptSubmitResponse: jsonSchema(AttemptSubmitResponseSchema),
  // 票 06：出口门控与解锁
  GateEvaluation: jsonSchema(GateEvaluationSchema),
  GateResponse: jsonSchema(GateResponseSchema),
  GateHistoryResponse: jsonSchema(GateHistoryResponseSchema),
  UnlockState: jsonSchema(UnlockStateSchema),
  // 票 07：复验与间隔排期
  ReviewQueueResponse: jsonSchema(ReviewQueueResponseSchema),
  ReviewRoundStartResponse: jsonSchema(ReviewRoundStartResponseSchema),
  ReviewCompleteResponse: jsonSchema(ReviewCompleteResponseSchema),
  ReviewRoundDetailResponse: jsonSchema(ReviewRoundDetailResponseSchema),
};

/** 错误体统一走 `ApiError`（common 领域已定义，这里只引用不重定义） */
const err = (description) => jsonResponse(description, 'ApiError');

export const paths = {
  '/api/v1/levels/{levelId}': {
    get: {
      operationId: 'getLevel',
      summary: '关卡详情（含完整 level.spec）',
      description:
        '返回关卡的完整规范。播放器靠它一次性拿到卡片、七段步骤与全部题目：' +
        '每题的选项、正确答案与**预写反馈**都在里面，作答后不需要再请求后端、' +
        '也不需要等模型生成解释。\n\n' +
        '这个知识点若还被上游的先修门挡着，返回 409 而不是 200：拦的是**入口**，' +
        '不是一个知识点的存在性。想知道被哪道门挡着，读 `details`（形状同 UnlockState）' +
        '或直接调 `GET /nodes/{microKpId}/unlock`。',
      parameters: [pathParam('levelId')],
      responses: {
        '200': jsonResponse('关卡详情', 'LevelDetailResponse'),
        '404': jsonResponse('关卡不存在', 'ApiError'),
        '409': jsonResponse(
          '这张关卡还没解锁：挡路的先修门没通过（响应 details 里带 blockers）',
          'ApiError',
        ),
        '500': jsonResponse('服务内部错误', 'ApiError'),
      },
    },
  },

  /**
   * 提交一次作答。
   *
   * ## 为什么是 POST /attempts 而不是 POST /levels/{id}/attempts
   *
   * 作答的归属是**微知识点**，关卡只是它发生的地点：同一道题会在复验关卡里
   * 再出现一次（票 07），那时关卡 id 变了而知识点没变。挂在关卡下面会让
   * 「这道题我做过几次」变成跨三个关卡 id 的并集查询。
   *
   * ## 为什么响应里带掌握度
   *
   * 学习者答完一题最想知道的是「这算数吗」；判完立刻把新的双字段带回来，
   * 前端不必再发一次请求，也不会出现「记录写成功了但掌握度显示的是旧值」
   * 这种两秒钟的错觉窗口。
   *
   * ## 为什么不幂等
   *
   * 每次 POST 都是一条**新证据**，同一道题做两次就是两条记录（这才会让
   * attemptNo 有意义）。要防「双击提交」请由客户端在提交后禁用按钮 ——
   * 服务端去重会让「真的想再做一次」变成静默无效。
   */
  /**
   * 读一个知识点的双字段掌握度。
   *
   * `microKpId` 可以是叶节点也可以是折叠父节点：父节点的数是**只读聚合**
   * （叶子后代按证据量加权），`isLeaf=false` 与 `aggregatedLeafCount` 就是
   * 给调用方看这件事的。聚合不落库（ADR-0004），所以这个接口是纯读。
   */
  '/api/v1/mastery/{microKpId}': {
    get: {
      operationId: 'getMastery',
      summary: '知识点掌握度（双字段：achieved 不衰减、current 会衰减）',
      description:
        '证据不足（<3 个变式或 <8 次作答）时 `achieved` 与 `current` 都是 null，' +
        '调用方应显示「证据不足」而不是 0% —— 「不知道」和「零分」是两件事。',
      parameters: [pathParam('microKpId')],
      responses: {
        '200': jsonResponse('掌握度', 'MasteryView'),
        '404': err('知识点不存在'),
        '500': err('服务内部错误'),
      },
    },
  },

  '/api/v1/attempts': {
    post: {
      operationId: 'submitAttempt',
      summary: '记录一次作答并重算掌握度',
      description:
        '对错由后端比对 `level_items.answer` 判定，请求体不接受客户端自报的 ' +
        '`correct`。写入作答、重算该微知识点掌握度、更新掌握度行在**同一个事务**里' +
        '完成：半步失败会留下「证据记了但掌握度没动」的不一致状态。',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AttemptSubmitRequest' },
          },
        },
      },
      responses: {
        '200': jsonResponse('作答已记录，附带重算后的掌握度', 'AttemptSubmitResponse'),
        '400': err('请求体不成形（缺字段、类型不对）'),
        '404': err('题目不存在'),
        '422': err('作答不合法（选项下标越界、答案类型与题目不符）'),
        '500': err('服务内部错误'),
      },
    },
  },

  /**
   * 评一次出口门控。
   *
   * ## 为什么是 POST 而不是 GET
   *
   * 一次判定不是纯读：通过时它会**写两条东西**——一条 gate_* 学习日志
   * （payload 里带这次判定用了哪几题，供回看）与 node_unlocks 里的解锁行。
   * 用 GET 做带副作用的操作会在预取、刷新、后退时静默重放，而重放会多写
   * 一次日志，让「我到底考过几次」变得不可信。
   *
   * ## 重复调用怎么办
   *
   * 不幂等，但也不会重复计分：判定每次都重读 `attempts` 里已有的作答，
   * 重复调用只会再写一条同样结论的日志；解锁行用 `ON CONFLICT DO NOTHING`，
   * 不会把首次解锁时间改写。
   *
   * ## 为什么判定不做在提交作答里
   *
   * 「关内单次答错不算门控失败」（spec 需求 17）—— 作答是关内的连续行为，
   * 每一次都触发判定会让学习者每答错一题就看到一次不及格。门控是**在出口
   * 上主动发起的一次考试**，节律与作答不同，所以接口也分开。
   */
  '/api/v1/levels/{levelId}/gate': {
    post: {
      operationId: 'evaluateGate',
      summary: '评一次出口门控（通过则解锁下游节点）',
      description:
        '读 `attempts` 里本关卡范围内已有的作答，用**二项下界**判定：章末出口 n=8、' +
        '≥7 对；高入度先修 n=10、≥9 对。题量不足时返回 `verdict=undetermined`，' +
        '不当作通过也不当作失败。判定结果写入学习日志（可回看每次用了哪几题）；' +
        '通过时解锁该知识点的下游先修节点，解锁状态落库，刷新不丢。',
      parameters: [pathParam('levelId')],
      responses: {
        '200': jsonResponse('门控判定结果与本次解锁的节点', 'GateResponse'),
        '404': err('关卡不存在'),
        '409': err('前置先修门还没通过，这张关卡尚未解锁（响应 details 里带 blockers）'),
        '500': err('服务内部错误'),
      },
    },
  },

  /**
   * 门控判定历史（新的在前）。
   *
   * 「可回看每次判定用了哪几题」的读端：每条评估里写死了当时的 `itemIds`
   * 与 `wrongItemIds`。之后内容改了、题目删了，历史也不会跟着变 —— 回看的
   * 意义就在于此。
   */
  '/api/v1/levels/{levelId}/gate/history': {
    get: {
      operationId: 'getGateHistory',
      summary: '这张关卡的门控判定历史',
      description:
        '按时间倒序返回最多 20 条判定记录，每条带当时的规则、答对数、用的是哪几题。' +
        '只读：不再写任何日志，也不会因为看了一次历史而多出一条判定。',
      parameters: [pathParam('levelId')],
      responses: {
        '200': jsonResponse('判定历史', 'GateHistoryResponse'),
        '404': err('关卡不存在'),
        '500': err('服务内部错误'),
      },
    },
  },

  /**
   * 读一个节点的解锁状态。
   *
   * 锁是**默认态**：任何节点生来就是锁的，只有真正通过了一道门控才会出现
   * 解锁行。所以这个接口的 200 不代表「开放」，要读 `unlocked`。
   *
   * 页面读它来决定「这张关卡的入口给不给开」：`GET /levels/{id}` 自己会再拦一道
   * （409），但页面需要在**跳转之前**就知道，否则用户点进去才看到一堵墙。
   */
  '/api/v1/nodes/{microKpId}/unlock': {
    get: {
      operationId: 'getNodeUnlock',
      summary: '节点的解锁状态与阻碍它的先修门',
      description:
        '`unlocked=false` 时 `blockers` 列出每一道挡路的门控：哪个先修知识点、' +
        '哪张关卡、最近一次判定还差几题。没有任何门控挡路时 `blockers` 为空数组。',
      parameters: [pathParam('microKpId')],
      responses: {
        '200': jsonResponse('解锁状态', 'UnlockState'),
        '404': err('知识点不存在'),
        '500': err('服务内部错误'),
      },
    },
  },

  /**
   * 到期复验队列。
   *
   * 空数组是**正常状态**：没到期的日子不该有复验。这里不用 404 —— 那样前端
   * 得把「没有到期的」和「地址写错了」区分对待，而两者对页面的含义相同
   * （都是「现在没有要做的」）。
   *
   * `nextDueAt` 与图谱节点的 `reviewDueAt` 是**同一列**（`mastery.next_review_at`），
   * 到期判据也是同一个 `<= now`。票 07 验收第 5 条要求两边一致，靠的就是
   * 「同一个事实只有一个计算处」。
   */
  '/api/v1/review/queue': {
    get: {
      operationId: 'getReviewQueue',
      summary: '此刻到期的复验队列',
      description:
        '列出所有 `next_review_at <= now` 的已掌握叶节点，按到期先后排序。' +
        '每项带 `overdueDays`（逾期天数，未逾期为 0）、`reviewStage`（间隔序列位置 0..4）' +
        '与 `availableItemCount`（这个知识点现在能抽多少道复验题）。',
      responses: {
        '200': jsonResponse('到期队列', 'ReviewQueueResponse'),
        '500': err('服务内部错误'),
      },
    },
  },

  /**
   * 开始一轮复验。
   *
   * `POST` 而不是 `GET`：会写 `review_rounds` 与 `review_round_items` 两行。
   * 带副作用的读请求会在预取/刷新/后退时被静默重放 —— 每重放一次就多一轮
   * 没做完的会话。
   *
   * 409 而不是空题单：没有到期知识点时返回 409，因为「现在不该开始复验」
   * 与「复验开始成功但考 0 题」是两件事，后者会让前端渲染一个空测验。
   */
  '/api/v1/review/rounds': {
    post: {
      operationId: 'startReviewRound',
      summary: '开始一轮复验（返回交错后的题单）',
      description:
        '从所有到期的知识点里各自抽 3–5 题（跨 `variant_group`、不重做原题），' +
        '再把它们轮转交错成一份 3–5 题的题单：相邻两题来自不同知识点。\n\n' +
        '题单与它会话都**当场落库**：判分发生在学习者做完之后，那时现算题单' +
        '会让他看到的题与判分的题不是同一批。\n\n' +
        '题目里不带 `answer` —— 与 `POST /attempts` 一样，判对错在服务端。' +
        '`explainCorrect` / `explainWrong` 是预写反馈，答完立刻显示，不调模型。',
      responses: {
        '200': jsonResponse('会话与题单', 'ReviewRoundStartResponse'),
        '409': jsonResponse(
          '现在没有到期的复验，或者到期的知识点都还没有可复验的题',
          'ApiError',
        ),
        '500': err('服务内部错误'),
      },
    },
  },

  /**
   * 判分。
   *
   * 幂等：会话一旦写死结果，重复请求返回存下来的判定，不再推进排期
   * （推进排期不是幂等操作，连点两次会推两档）。
   *
   * 还有题没答完 → 422，`details.missingItemIds` 列出缺哪几道。
   */
  '/api/v1/review/rounds/{roundId}/complete': {
    post: {
      operationId: 'completeReviewRound',
      summary: '判分（按知识点聚合、推进间隔排期）',
      description:
        '按知识点把这一轮的作答聚合成「过 / 没过」，然后各自推进排期：' +
        '通过 +1 档、未通过 −1 档（1/3/7/21/60 天，夹在 0..4）。\n\n' +
        '每个知识点分开判定的理由：间隔排期是每个知识点各自一条。A 记得牢、B 忘了，' +
        '不能让 B 的遗忘把 A 的间隔一起退回去。\n\n' +
        '响应里的 `mastery` 是判分后各知识点的掌握度：复验的落点就是' +
        '「`current` 降了、`achieved` 没降」—— `achieved` 是历史最高后验，' +
        '不出现在任何下调路径里。',
      parameters: [pathParam('roundId')],
      responses: {
        '200': jsonResponse('判分结果', 'ReviewCompleteResponse'),
        '404': err('复验会话不存在'),
        '422': err('还有题目没答完（details.missingItemIds 列出缺哪几道）'),
        '500': err('服务内部错误'),
      },
    },
  },

  /**
   * 读一回复验（判分前是题单，判分后是结果）。
   *
   * 刷新页面后回到同一份结果要靠它：判分是 `POST`，不能靠浏览器后退重放。
   */
  '/api/v1/review/rounds/{roundId}': {
    get: {
      operationId: 'getReviewRound',
      summary: '读一回复验（题单与判定结果）',
      description:
        '判分之前 `round.verdict` 为 null、`outcomes` 为空数组；判分之后两者都有值。' +
        '`items` 始终返回这一轮考了哪几题（含预写反馈），所以「上次复验考了什么」' +
        '在刷新之后仍然看得到。',
      parameters: [pathParam('roundId')],
      responses: {
        '200': jsonResponse('复验会话', 'ReviewRoundDetailResponse'),
        '404': err('复验会话不存在'),
        '500': err('服务内部错误'),
      },
    },
  },
};
