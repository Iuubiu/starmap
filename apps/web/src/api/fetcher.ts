/**
 * Orval 的 mutator：所有生成客户端共用的 fetch 封装。
 *
 * 两件事值得强调：
 *
 * 1. **返回形状必须是 `{ data, status, headers }`**。Orval 生成的响应类型是
 *    `{ data: T; status: 200 } & { headers }`。如果这里只返回解析后的 JSON，
 *    类型对不上但运行时也不报错 —— 直到某天有人真的去读 `status`。
 *
 * 2. **错误必须是结构化的**。后端契约规定错误体是 `{ code, message, details? }`，
 *    UI 要按 `code` 分支（NOT_FOUND 显示空态、VALIDATION_FAILED 显示字段错误）。
 *    如果这里只 throw 一个 Error，code 在 throw 那一刻就丢了。
 */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/** 空字符串 = 同源。开发时走 Vite 代理，生产同域名部署时不需要改代码。 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * 合并请求头。
 *
 * **必须用 `Headers` 实例，不能用对象字面量。** 对象字面量的键区分大小写，
 * `{ 'content-type': 'application/json', ...{'Content-Type': 'application/json'} }`
 * 得到的是**两个键**；`fetch` 把它们按 HTTP 语义归一化成同一个头，值拼成
 * `application/json, application/json`。Express 的 body-parser 按 media type
 * 精确匹配 `application/json`，匹配失败就**静默跳过解析**，`req.body` 是
 * `undefined`，控制器收到 400「请求体不合法」。
 *
 * 这不是理论风险：Orval 生成的每个写操作都会自己带一个 `Content-Type`，
 * 于是所有 POST/PATCH 在浏览器里都必然 400，而 MSW 在 fetch 层拦截、
 * 根本不经过 body-parser，单测全绿。真链路才发现。
 *
 * `Headers` 的键大小写不敏感，`set` 前用 `has` 判断即可避免重复。
 */
export const mergeHeaders = (provided: RequestInit['headers']): Headers => {
  const headers = new Headers(provided);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return headers;
};

export const customFetch = async <T>(url: string, options: RequestInit = {}): Promise<T> => {
  const res = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers: mergeHeaders(options.headers),
  });

  if (!res.ok) {
    let code = 'INTERNAL';
    let message = `请求失败（HTTP ${res.status}）`;
    let details: unknown;
    try {
      const body = (await res.json()) as { code?: string; message?: string; details?: unknown };
      code = body.code ?? code;
      message = body.message ?? message;
      details = body.details;
    } catch {
      // 非 JSON 错误体：保留 HTTP 状态信息即可，不要吞掉原始 status
    }
    throw new ApiClientError(res.status, code, message, details);
  }

  const data = res.status === 204 ? undefined : await res.json();
  return { data, status: res.status, headers: res.headers } as T;
};
