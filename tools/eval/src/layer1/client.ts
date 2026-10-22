/**
 * 第一层用的最小 HTTP 客户端。
 *
 * 不用 apps/web 的 Orval 客户端：那个客户端会把响应体收窄成 `{ data }`，
 * 并在 !ok 时抛异常 —— 第一层要断言的恰恰包括 400/404 的**响应体形状**，
 * 抛异常的客户端会把这条信息丢掉。
 *
 * 也不引 axios/got：只有 GET，node 自带 fetch 够了，少一个依赖少一处
 * 供应链面（这个包会被 depcruise 巡航）。
 */

export const DEFAULT_BASE_URL = 'http://127.0.0.1:3001/api/v1';

export interface RawResponse {
  status: number;
  /** 解析后的 JSON；解析失败时保留原始文本，方便断言错误页。 */
  body: unknown;
  rawText: string;
  durationMs: number;
}

export class ApiClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string = DEFAULT_BASE_URL, timeoutMs = 15_000) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  /** 发一个 GET，**从不抛异常**：状态码是断言对象，不是错误。 */
  async get(path: string): Promise<RawResponse> {
    const started = performance.now();
    const response = await fetch(`${this.baseUrl}${path}`, {
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { accept: 'application/json' },
    });
    const rawText = await response.text();
    let body: unknown = rawText;
    try {
      body = rawText.length === 0 ? null : (JSON.parse(rawText) as unknown);
    } catch {
      /* 保留字符串体；下面调用方若期待 JSON 会自己判失败。 */
    }
    return {
      status: response.status,
      body,
      rawText,
      durationMs: performance.now() - started,
    };
  }

  /** 后端是否活着。第一层的第一件事，失败时直接整体报错而不是 20 条连锁失败。 */
  async isUp(): Promise<boolean> {
    try {
      const response = await this.get('/health');
      return response.status === 200;
    } catch {
      return false;
    }
  }
}

/**
 * 翻完所有分页。返回 items 与页数；任何一页非 200 直接抛错 —— 分页翻不完整
 * 时后面的断言都不成立，静默截断比报错更危险。
 */
export async function fetchAllPages<T>(
  client: ApiClient,
  path: string,
  pageSize: number,
  extract: (body: unknown) => { items: T[]; nextCursor: string | null },
  maxPages = 200,
): Promise<{ items: T[]; pages: number }> {
  const items: T[] = [];
  let cursor: string | null = null;
  let pages = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const query = cursor === null ? `?limit=${pageSize}` : `?limit=${pageSize}&cursor=${encodeURIComponent(cursor)}`;
    const response = await client.get(`${path}${query}`);
    if (response.status !== 200) {
      throw new Error(`分页请求失败：${path}${query} → ${response.status} ${response.rawText.slice(0, 200)}`);
    }
    const parsed = extract(response.body);
    items.push(...parsed.items);
    pages += 1;
    if (parsed.nextCursor === null) return { items, pages };
    if (parsed.nextCursor === cursor) {
      throw new Error(`分页游标没有前进：${cursor}（会死循环）`);
    }
    cursor = parsed.nextCursor;
  }

  throw new Error(`翻到 ${maxPages} 页仍未结束，怀疑 nextCursor 逻辑有问题`);
}
