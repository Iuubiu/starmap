/**
 * 个人看板（票 80）的 paths 片段。
 *
 * 归属泳道：agent-dev。与 `src/domains/mastery.ts` 配对，两处都只 append。
 *
 * ## 为什么是一个端点而不是三个
 *
 * 三块进度必须共享同一个 `evaluatedAt`：掌握度按天衰减，三个请求各取一次
 * 时刻，就会出现「知识点块说 7 个已掌握、学科块加起来是 6」这种自相矛盾的
 * 页面。合成一个响应是让「同一屏里的数字互相一致」成为结构上的保证，而不是
 * 前端记得少发两次请求。
 */
import { ProgressBoardSchema } from '../../dist/index.js';
import { jsonResponse, jsonSchema } from './_shared.mjs';

export const components = {
  ProgressBoard: jsonSchema(ProgressBoardSchema),
};

/** 错误体统一走 `ApiError`（common 领域已定义，这里只引用不重定义） */
const err = (description) => jsonResponse(description, 'ApiError');

export const paths = {
  '/api/v1/mastery/board': {
    get: {
      operationId: 'getProgressBoard',
      summary: '个人看板：知识点 / 学科 / 课本三级进度',
      description:
        '只读端点。按叶节点逐条回放作答证据（不读 `app.mastery` 的快照列，那列会衰减），' +
        '再按三个维度分组计数：全库五态、`course_layers` 的 8 层、`sources` 里 27 本书。\n\n' +
        '**同一个响应里的所有数字共享 `evaluatedAt`**（UTC 日界）。三个维度分别请求会让' +
        '「知识点说已掌握 7、八层加起来是 6」这类矛盾出现在同一屏上。\n\n' +
        '分母都随分子返回：`knowledgePoints.total`、`layers[].total`、`books[].total`。\n' +
        '八层分母之和可能小于全库叶节点数——差额见 `unlayeredLeafCount`，那不是算错了。',
      tags: ['mastery'],
      responses: {
        200: jsonResponse('三级进度', 'ProgressBoard'),
        500: err('内部错误'),
      },
    },
  },
};
