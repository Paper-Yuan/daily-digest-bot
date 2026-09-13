/** HTTP 客户端容错:重试条件、退避、4xx 不重试 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError, httpGetJson } from '../src/utils/http';

function jsonRes(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('httpGetJson 容错', () => {
  it('5xx 自动重试,第二次成功', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonRes(500, { error: 'boom' }))
      .mockResolvedValueOnce(jsonRes(200, { ok: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    const data = await httpGetJson<{ ok: number }>('https://example.com/x', { backoffBaseMs: 1 });
    expect(data).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('429 尊重 Retry-After 并重试成功', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonRes(429, {}, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonRes(200, { ok: 2 }));
    vi.stubGlobal('fetch', fetchMock);

    const data = await httpGetJson<{ ok: number }>('https://example.com/x', { backoffBaseMs: 1 });
    expect(data).toEqual({ ok: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('404 属确定性失败,不重试直接抛 HttpError', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(404, 'nope'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(httpGetJson('https://example.com/x')).rejects.toBeInstanceOf(HttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('网络错误重试耗尽后抛出原始错误', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      httpGetJson('https://example.com/x', { retries: 1, backoffBaseMs: 1 }),
    ).rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
