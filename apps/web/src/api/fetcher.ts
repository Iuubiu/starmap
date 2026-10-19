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

export const customFetch = async <T>(url: string, options: RequestInit = {}): Promise<T> => {
  const res = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
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
