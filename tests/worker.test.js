/**
 * Cloudflare Worker(Telegram 触发器)的行为测试。
 *
 * 这个 Worker 是安全边界:凡是带正确 secret_token 的请求才被信任,且只有白名单
 * 会话能真正触发 Actions。这里用 stub 的 fetch/caches 覆盖这些路径,不需要真网络。
 *
 * 说明:用 .js 而不是 .ts —— 该 Worker 是给 Cloudflare 运行时用的纯 JS(不在
 * tsconfig 的 src/tests 编译范围内),vitest 原生支持 .js 测试,tsc 则不会因为
 * 缺少 allowJs 而报错。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'test-secret';
const CHAT_OK = '1234567890';
const CHAT_BAD = '9999999999';

const ENV = {
  TELEGRAM_BOT_TOKEN: '123:FAKE',
  TELEGRAM_CHAT_ID: CHAT_OK,
  GITHUB_TOKEN: 'github_pat_fake',
  GITHUB_REPO: 'owner/repo',
  WEBHOOK_SECRET: SECRET,
};

/** 收集 ctx.waitUntil 的 promise,便于断言后台动作是否发生 */
function makeCtx() {
  const pending = [];
  return {
    ctx: { waitUntil: (p) => pending.push(p) },
    settle: async () => {
      await Promise.allSettled(pending);
    },
  };
}

let worker;
let fetchMock;

function telegramUpdate(text, chatId = CHAT_OK) {
  return { update_id: 1, message: { message_id: 1, date: 1_700_000_000, text, chat: { id: Number(chatId), type: 'private' } } };
}

function postReq(body, { secret = SECRET, method = 'POST' } = {}) {
  const headers = {};
  // secret 传 null 表示"刻意不带这个头" —— 不能用 undefined,否则会被默认值顶掉
  if (secret) headers['X-Telegram-Bot-Api-Secret-Token'] = secret;
  return new Request('https://worker.example.com', {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

/** 从 mock 调用里取出某个 API 的请求 */
function callsTo(fragment) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes(fragment));
}

beforeEach(async () => {
  vi.resetModules();
  // caches.default 在 Node 里不存在,用内存版替身模拟冷却缓存
  const store = new Map();
  globalThis.caches = {
    default: {
      match: async (req) => (store.has(req.url) ? new Response('1') : undefined),
      put: async (req) => {
        store.set(req.url, true);
      },
    },
  };
  fetchMock = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/dispatches')) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  globalThis.fetch = fetchMock;
  ({ default: worker } = await import('../cloudflare/telegram-trigger.js'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete globalThis.caches;
});

describe('入口与鉴权', () => {
  it('非 POST 请求当作健康检查,返回 200', async () => {
    const res = await worker.fetch(postReq(null, { method: 'GET' }), ENV, makeCtx().ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('running');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('secret 不匹配时返回 403 且不做任何动作', async () => {
    const res = await worker.fetch(postReq(telegramUpdate('/quick'), { secret: 'wrong' }), ENV, makeCtx().ctx);
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('缺少 secret 头也返回 403(不能因为没带就被信任)', async () => {
    const res = await worker.fetch(postReq(telegramUpdate('/quick'), { secret: null }), ENV, makeCtx().ctx);
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('非 JSON 请求体返回 200,避免 Telegram 反复重投', async () => {
    const req = new Request('https://worker.example.com', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET },
      body: 'not-json',
    });
    const res = await worker.fetch(req, ENV, makeCtx().ctx);
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('白名单', () => {
  it('未授权会话被拒绝且不触发 dispatch', async () => {
    const { ctx, settle } = makeCtx();
    await worker.fetch(postReq(telegramUpdate('/quick', CHAT_BAD)), ENV, ctx);
    await settle();

    expect(callsTo('/dispatches')).toHaveLength(0);
    const sent = callsTo('/sendMessage');
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0][1].body).text).toContain('没有触发权限');
  });

  it('支持逗号分隔的多个会话 id', async () => {
    const env = { ...ENV, TELEGRAM_CHAT_ID: `${CHAT_BAD}, ${CHAT_OK}` };
    const { ctx, settle } = makeCtx();
    await worker.fetch(postReq(telegramUpdate('/quick')), env, ctx);
    await settle();
    expect(callsTo('/dispatches')).toHaveLength(1);
  });
});

describe('/quick 触发', () => {
  it('先回执再触发 repository_dispatch,事件类型正确', async () => {
    const { ctx, settle } = makeCtx();
    const res = await worker.fetch(postReq(telegramUpdate('/quick')), ENV, ctx);
    expect(res.status).toBe(200);
    await settle();

    const reply = JSON.parse(callsTo('/sendMessage')[0][1].body);
    expect(reply.chat_id).toBe(CHAT_OK);
    expect(reply.text).toContain('正在生成快报');

    const dispatches = callsTo('/dispatches');
    expect(dispatches).toHaveLength(1);
    expect(String(dispatches[0][0])).toBe('https://api.github.com/repos/owner/repo/dispatches');
    expect(JSON.parse(dispatches[0][1].body)).toEqual({ event_type: 'quick-report' });
    expect(dispatches[0][1].headers.authorization).toBe(`Bearer ${ENV.GITHUB_TOKEN}`);
  });

  it('兼容 /quick@MyBot 写法与 /k 简写', async () => {
    for (const text of ['/quick@MyDigestBot', '/k']) {
      fetchMock.mockClear();
      const { ctx, settle } = makeCtx();
      const store = new Map(); // 重置冷却
      globalThis.caches.default.match = async (req) => (store.has(req.url) ? new Response('1') : undefined);
      globalThis.caches.default.put = async (req) => store.set(req.url, true);

      await worker.fetch(postReq(telegramUpdate(text)), ENV, ctx);
      await settle();
      expect(callsTo('/dispatches'), `命令 ${text}`).toHaveLength(1);
    }
  });

  it('冷却期内重复触发不会重复消耗 Actions', async () => {
    const { ctx: c1, settle: s1 } = makeCtx();
    await worker.fetch(postReq(telegramUpdate('/quick')), ENV, c1);
    await s1();
    expect(callsTo('/dispatches')).toHaveLength(1);

    const { ctx: c2, settle: s2 } = makeCtx();
    await worker.fetch(postReq(telegramUpdate('/quick')), ENV, c2);
    await s2();

    expect(callsTo('/dispatches')).toHaveLength(1); // 仍是 1 次
    const texts = callsTo('/sendMessage').map((c) => JSON.parse(c[1].body).text);
    expect(texts.some((t) => t.includes('刚刚已经触发过'))).toBe(true);
  });

  it('dispatch 失败时把原因回给用户', async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/dispatches')) return new Response('Bad credentials', { status: 401 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const { ctx, settle } = makeCtx();
    await worker.fetch(postReq(telegramUpdate('/quick')), ENV, ctx);
    await settle();

    const texts = callsTo('/sendMessage').map((c) => JSON.parse(c[1].body).text);
    expect(texts.some((t) => t.includes('触发失败') && t.includes('401'))).toBe(true);
  });
});

describe('其它消息', () => {
  it('/help 与 /start 回帮助文本', async () => {
    for (const cmd of ['/help', '/start']) {
      fetchMock.mockClear();
      const { ctx, settle } = makeCtx();
      await worker.fetch(postReq(telegramUpdate(cmd)), ENV, ctx);
      await settle();
      const text = JSON.parse(callsTo('/sendMessage')[0][1].body).text;
      expect(text).toContain('/quick');
      expect(callsTo('/dispatches')).toHaveLength(0);
    }
  });

  it('未识别命令回提示且不触发', async () => {
    const { ctx, settle } = makeCtx();
    await worker.fetch(postReq(telegramUpdate('/whatever')), ENV, ctx);
    await settle();
    expect(callsTo('/dispatches')).toHaveLength(0);
    expect(JSON.parse(callsTo('/sendMessage')[0][1].body).text).toContain('未识别的命令');
  });

  it('非文本消息(如图片)被忽略,连回话都不发', async () => {
    const update = { update_id: 2, message: { message_id: 2, date: 1, chat: { id: Number(CHAT_OK), type: 'private' }, photo: [] } };
    const { ctx, settle } = makeCtx();
    const res = await worker.fetch(postReq(update), ENV, ctx);
    await settle();
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
