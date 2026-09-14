/**
 * Telegram → GitHub 快报触发器(Cloudflare Worker)
 *
 * 作用:让"给机器人发消息"变成一次真正的触发。它只做三件事,不做任何报告生成:
 *   1. 校验请求确实来自 Telegram(secret_token 头比对);
 *   2. 校验会话在允许列表内(否则任何人都能消耗你的 Actions 额度);
 *   3. 回一句"正在生成"并触发 GitHub 的 repository_dispatch,由 Actions 生成并推送报告。
 *
 * 为什么不做报告生成:抓取与渲染都在 GitHub Actions 里跑,Worker 只当门铃。
 * 报告内容(天气/课表/日历)全程不经过 Worker,隐私边界干净。
 *
 * 需要的环境变量(在 Cloudflare 后台配置):
 *   TELEGRAM_BOT_TOKEN  机器人 token(用于回消息)
 *   TELEGRAM_CHAT_ID    允许的会话 id,多个用英文逗号分隔
 *   GITHUB_TOKEN        细粒度 PAT,仅需该仓库的 Actions: Read and write
 *   GITHUB_REPO         形如 owner/repo
 *   WEBHOOK_SECRET      自定义随机串,与 setWebhook 的 secret_token 保持一致
 */

/** 触发入口:全部走 repository_dispatch,事件类型与 workflow 的 types 对应 */
const EVENT_QUICK = 'quick-report';

const HELP_TEXT = [
  '可用命令:',
  '/quick — 立刻生成一份快报(当前快照,不影响早晚报)',
  '/help — 显示这条说明',
].join('\n');

/* ---------------- Telegram API ---------------- */

async function telegram(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => ({}));
  if (body && body.ok === false) {
    console.error(`[telegram] ${method} 失败: ${body.description ?? '未知原因'}`);
  }
  return body;
}

function reply(env, chatId, text) {
  return telegram(env, 'sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}

/* ---------------- GitHub 触发 ---------------- */

async function dispatch(env, eventType) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'digest-bot-trigger-worker',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ event_type: eventType }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status !== 204) {
    const detail = await res.text().catch(() => '');
    throw new Error(`GitHub dispatch 失败 HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
}

/**
 * 冷却:同一次点击可能被连续触发(手抖双击、客户端重发)。
 * 用 Cache API 当一层轻量去重(免费 Worker 没有 KV 时的常用做法),
 * 命中缓存说明 60 秒内刚触发过,直接忽略,避免白发一次 Actions 任务。
 * 缓存读写失败时一律放行(失败开放),不能因为限流组件挂掉就收不到报告。
 */
const COOLDOWN_SECONDS = 60;

async function onCooldown(chatId) {
  try {
    const key = new Request(`https://cooldown.local/${encodeURIComponent(chatId)}`, { method: 'GET' });
    if (await caches.default.match(key)) return true;
    await caches.default.put(
      key,
      new Response('1', { headers: { 'cache-control': `max-age=${COOLDOWN_SECONDS}` } }),
    );
    return false;
  } catch {
    return false;
  }
}

/* ---------------- 入口 ---------------- */

export default {
  async fetch(request, env, ctx) {
    // 健康检查:浏览器直接打开 Worker 地址时应返回正常,便于确认部署成功
    if (request.method !== 'POST') {
      return new Response('digest-bot trigger worker is running', { status: 200 });
    }

    // 只信任带正确 secret_token 的请求 —— 这个 URL 是公开的,这是唯一的身份来源
    const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) {
      return new Response('forbidden', { status: 403 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response('ok', { status: 200 }); // 非 JSON:当作已处理,避免 Telegram 重投
    }

    const msg = update?.message ?? update?.edited_message;
    const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
    const chatId = msg?.chat?.id !== undefined ? String(msg.chat.id) : '';
    if (!text || !chatId) {
      return new Response('ok', { status: 200 }); // 图片/贴纸/入群等非文本消息直接忽略
    }

    // 白名单:不在列表里的会话一律拒绝并回话,防止额度被人蹭
    const allowed = String(env.TELEGRAM_CHAT_ID || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!allowed.includes(chatId)) {
      ctx.waitUntil(reply(env, chatId, '⛔ 这个会话没有触发权限。'));
      return new Response('ok', { status: 200 });
    }

    // 取命令本体:兼容 /quick、/quick@MyBot、/quick 附带参数等写法
    const cmd = text.split(/[\s@]/)[0].toLowerCase();

    if (cmd === '/quick' || cmd === '/k') {
      if (await onCooldown(chatId)) {
        ctx.waitUntil(reply(env, chatId, `⏳ 刚刚已经触发过了,请等 ${COOLDOWN_SECONDS} 秒再试。`));
        return new Response('ok', { status: 200 });
      }
      // 先回执再触发:让用户立刻有反馈,同时把耗时动作放进 waitUntil,避免 Telegram 等超时重投
      ctx.waitUntil(reply(env, chatId, '⚡ 收到,正在生成快报…大约 1 分钟后送达。'));
      ctx.waitUntil(
        dispatch(env, EVENT_QUICK).catch((err) => {
          console.error(String(err));
          return reply(env, chatId, `❌ 触发失败:${err instanceof Error ? err.message : String(err)}`);
        }),
      );
      return new Response('ok', { status: 200 });
    }

    if (cmd === '/start' || cmd === '/help') {
      ctx.waitUntil(reply(env, chatId, HELP_TEXT));
      return new Response('ok', { status: 200 });
    }

    ctx.waitUntil(reply(env, chatId, `未识别的命令。${HELP_TEXT}`));
    return new Response('ok', { status: 200 });
  },
};
