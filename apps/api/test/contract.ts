import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import OpenApiResponseValidator from 'openapi-response-validator';
import { parse } from 'yaml';

/**
 * 契约测试：同一份响应必须同时满足 Zod（代码里已 parse）与 openapi.yaml。
 *
 * 这一步是「契约是唯一真源」的执行点——只有 Zod 通过、yaml 不同步的话，
 * 外部消费者（未来的移动端、第三方）会拿到与文档不符的东西。
 */
const here = dirname(fileURLToPath(import.meta.url));
const openapiPath = join(here, '..', '..', '..', 'packages', 'api-contract', 'openapi.yaml');

export function loadOpenApi(): Record<string, unknown> {
  return parse(readFileSync(openapiPath, 'utf8')) as Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Validator = (body: unknown) => any;

/**
 * 支持的 HTTP 方法。
 *
 * 只列**有响应体**的方法：DELETE 在契约里通常返回 204（无 body），
 * 硬塞进来会让调用方以为需要校验一个不存在的响应。
 */
export type ContractMethod = 'get' | 'post' | 'patch' | 'put';

function validatorFor(path: string, method: ContractMethod, status: number): Validator {
  const spec = loadOpenApi() as {
    paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
  };
  const responses = spec.paths[path]?.[method]?.responses;
  if (!responses) throw new Error(`openapi.yaml 缺少 ${method.toUpperCase()} ${path}`);
  const v = new OpenApiResponseValidator({
    responses: responses as never,
    components: (loadOpenApi() as { components?: unknown }).components as never,
  });
  return (body: unknown) => v.validateResponse(status, body);
}

export function assertMatchesContract(
  path: string,
  method: ContractMethod,
  status: number,
  body: unknown,
): void {
  const errors = validatorFor(path, method, status)(body);
  if (errors) {
    // 把「哪个字段不对」写进错误消息：contract 断言失败最常见的原因是
    // 后端加了字段但没跑 contract:gen，光看一句「不符合」查不出来。
    throw new Error(
      `响应不符合 openapi.yaml（${method.toUpperCase()} ${path} → ${status}）: ${JSON.stringify(errors, null, 2)}`,
    );
  }
}
