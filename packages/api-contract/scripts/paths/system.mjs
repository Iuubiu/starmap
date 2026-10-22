/**
 * 健康检查的 paths 片段。
 *
 * 归属：integrator（共享面）。
 */
import { HealthResponseSchema } from '../../dist/index.js';
import { jsonResponse, jsonSchema } from './_shared.mjs';

export const components = {
  HealthResponse: jsonSchema(HealthResponseSchema),
};

export const paths = {
  '/api/v1/health': {
    get: {
      operationId: 'getHealth',
      summary: '健康检查',
      responses: {
        '200': jsonResponse('服务正常', 'HealthResponse'),
      },
    },
  },
};
