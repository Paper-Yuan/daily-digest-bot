/**
 * 统一的 HTTP 客户端:超时控制 + 指数退避重试。
 *
 * 容错设计要点:
 *  - 每次尝试用 AbortSignal.timeout 限制耗时,防止慢接口拖垮整个任务;
 *  - 只对"值得重试"的错误重试:网络异常、429、5xx;
 *    4xx(除 429)是确定性失败,重试没有意义,直接抛 HttpError;
 *  - 退避带随机抖动,上游限流时降低集体撞车概率;
 *  - 服务端给了 Retry-After 就尊重它(封顶 10s,避免 CI 卡死)。
 * 所有模块必须经由这里发请求,禁止直接裸调 fetch。
 */

export interface HttpOptions {
  timeoutMs?: number;
  retries?: number;
  backoffBaseMs?: number;
  headers?: Record<string, string>;
}

interface RetryRuntime {
  timeoutMs: number;
  retries: number;
  backoffBaseMs: number;
}

const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF = 500;
const MAX_RETRY_DELAY = 10_000;

const DEFAULT_HEADERS: Record<string, string> = {
  'user-agent': 'daily-digest-bot/1.0 (personal digest bot)',
  accept: 'application/json, text/plain, */*',
};

/** 非 2xx 的 HTTP 响应,保留状态码与响应体片段 */
export class HttpError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string, url: string) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 200)}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelayMs(attempt: number, res: Response | null, baseMs: number): number {
  const retryAfter = res?.headers.get('retry-after');
  if (retryAfter) {
    const sec = Number(retryAfter);
    if (Number.isFinite(sec) && sec >= 0) return Math.min(sec * 1000, MAX_RETRY_DELAY);
  }
  const backoff = baseMs * 2 ** attempt + Math.random() * baseMs;
  return Math.min(backoff, MAX_RETRY_DELAY);
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: RetryRuntime,
): Promise<Response> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      if (res.ok) return res;
      if (!isRetryableStatus(res.status)) {
        const body = await res.text().catch(() => '');
        throw new HttpError(res.status, body, url);
      }
      // 429/5xx:等一等再试
      await res.text().catch(() => '');
      lastErr = new HttpError(res.status, '', url);
      if (attempt < opts.retries) {
        await sleep(retryDelayMs(attempt, res, opts.backoffBaseMs));
      }
    } catch (err) {
      if (err instanceof HttpError && !isRetryableStatus(err.status)) throw err;
      // 网络层错误 / 超时(AbortError 也在其中)
      lastErr = err;
      if (attempt < opts.retries) {
        await sleep(retryDelayMs(attempt, null, opts.backoffBaseMs));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`request failed: ${url}`);
}

export async function httpGetText(url: string, opts: HttpOptions = {}): Promise<string> {
  const runtime: RetryRuntime = {
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT,
    retries: opts.retries ?? DEFAULT_RETRIES,
    backoffBaseMs: opts.backoffBaseMs ?? DEFAULT_BACKOFF,
  };
  const res = await fetchWithRetry(
    url,
    { method: 'GET', headers: { ...DEFAULT_HEADERS, ...(opts.headers ?? {}) } },
    runtime,
  );
  return res.text();
}

export async function httpGetJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const text = await httpGetText(url, opts);
  return JSON.parse(text) as T;
}

export async function httpPostJson<T>(
  url: string,
  body: unknown,
  opts: HttpOptions = {},
): Promise<T> {
  const runtime: RetryRuntime = {
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT,
    retries: opts.retries ?? DEFAULT_RETRIES,
    backoffBaseMs: opts.backoffBaseMs ?? DEFAULT_BACKOFF,
  };
  const res = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: { ...DEFAULT_HEADERS, 'content-type': 'application/json', ...(opts.headers ?? {}) },
      body: JSON.stringify(body),
    },
    runtime,
  );
  const text = await res.text();
  return (text ? JSON.parse(text) : ({} as T)) as T;
}

/**
 * POST multipart/form-data(用于上传图片等二进制内容)。
 * 刻意不手写 content-type:必须交给 fetch 自动附加 boundary,
 * 手动指定会导致服务端解析失败。超时给得更宽(图片上传较慢),重试策略与其它方法一致。
 */
export async function httpPostForm<T>(
  url: string,
  form: FormData,
  opts: HttpOptions = {},
): Promise<T> {
  const runtime: RetryRuntime = {
    timeoutMs: opts.timeoutMs ?? 30_000,
    retries: opts.retries ?? DEFAULT_RETRIES,
    backoffBaseMs: opts.backoffBaseMs ?? DEFAULT_BACKOFF,
  };
  const res = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: { ...DEFAULT_HEADERS, ...(opts.headers ?? {}), accept: 'application/json' },
      body: form,
    },
    runtime,
  );
  const text = await res.text();
  return (text ? JSON.parse(text) : ({} as T)) as T;
}
