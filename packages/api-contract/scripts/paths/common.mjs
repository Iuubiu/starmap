/**
 * 公共组件：错误体。
 *
 * 归属：integrator（共享面）。**只放 components，不放 paths** —— 错误体不挂在
 * 任何一条路由上，它挂在几乎每条路由上。
 *
 * 领域文件引用它时写 `ref('ApiError')`，不要各自重复声明一份：
 * 两份同名的 component 会被 gen-openapi 的重复检测直接拒绝（这是故意的）。
 */
import { ApiErrorSchema } from '../../dist/index.js';
import { jsonSchema } from './_shared.mjs';

export const components = {
  ApiError: jsonSchema(ApiErrorSchema),
};

export const paths = {};
