/**
 * Telegram 触发器 + 定时闹钟(Cloudflare Worker)
 *
 * 两件事:
 *   1. webhook 收到消息 —— 校验来源与白名单,回一句"正在生成"并触发 GitHub Actions;
 *   2. cron 到点 —— 触发 Actions 生成早报/晚报。
 * 都不做报告生成:抓取与渲染都在 Actions 里跑,Worker 只当门铃。
 * 报告内容(天气/课表/日历)全程不经过 Worker,隐私边界干净。
 *
 * 为什么定时也放这里而不是 GitHub 的 schedule:实测本仓库账号的 Actions schedule
 * 会排队 0~8 小时(早报常在凌晨或中午才发),而 Workers cron 准点到、
 * dispatch 触发后 4 秒 Actions 就起跑、全程约 35 秒。
 *
 * 需要的环境变量(在 Cloudflare 后台配置):
 *   TELEGRAM_BOT_TOKEN  机器人 token(用于回消息)
 *   TELEGRAM_CHAT_ID    允许的会话 id,多个用英文逗号分隔
 *   GITHUB_TOKEN        细粒度 PAT,仅需该仓库的 Contents: Read and write
 *                       (repository_dispatch 走 POST /repos/{owner}/{repo}/dispatches,
 *                        按 GitHub 文档要求 Contents 写权限,Actions 权限无效)
 *   GITHUB_REPO         形如 owner/repo
 *   WEBHOOK_SECRET      自定义随机串,与 setWebhook 的 secret_token 保持一致
 *
 * cron 表达式在 wrangler.toml 的 [triggers] 里声明,须与下面 CRON_JOBS 的键一致。
 */

/** 触发入口:全部走 repository_dispatch,事件类型与 workflow 的 types 对应 */
const EVENT_QUICK = 'quick-report';

/**
 * Workers cron 一律按 UTC 解释。
 * 值即 repository_dispatch 的 client_payload,由 morning.yml 翻译成命令行参数。
 */
const CRON_JOBS = {
  '0 0 * * *': { mode: 'morning', scheduled: true },   // 北京 08:00
  '0 13 * * *': { mode: 'evening', scheduled: true },  // 北京 21:00
};

const HELP_TEXT = [
  '可用命令:',
  '/quick — 立刻生成一份快报(当前快照,不影响早晚报)',
  '/help — 显示这条说明',
].join('\n');

/**
 * 可触发的命令 → 回执文案与 client_payload。
 * 都是"快照"语义(mode: quick):不写去重状态,不影响当天早晚报的增量。
 * 想加新命令就往这里加一项,不用碰 webhook 的处理逻辑。
 */
const QUICK_TRIGGER = {
  cooldownKey: 'quick',
  ack: '⚡ 收到,正在生成快报…大约 1 分钟后送达。',
  payload: { mode: 'quick' },
};

const TRIGGERS = {
  '/quick': QUICK_TRIGGER,
  '/k': QUICK_TRIGGER,
};

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

async function dispatch(env, eventType, payload) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'digest-bot-trigger-worker',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ event_type: eventType, client_payload: payload ?? {} }),
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

async function onCooldown(key) {
  try {
    const req = new Request(`https://cooldown.local/${encodeURIComponent(key)}`, { method: 'GET' });
    if (await caches.default.match(req)) return true;
    await caches.default.put(
      req,
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

    const trigger = TRIGGERS[cmd];
    if (trigger) {
      // 冷却按"会话 + 命令"计:连发 /quick 会被拦,但换一条命令不该被连带拦下
      if (await onCooldown(`${chatId}:${trigger.cooldownKey}`)) {
        ctx.waitUntil(reply(env, chatId, `⏳ 刚刚已经触发过了,请等 ${COOLDOWN_SECONDS} 秒再试。`));
        return new Response('ok', { status: 200 });
      }
      // 先回执再触发:让用户立刻有反馈,同时把耗时动作放进 waitUntil,避免 Telegram 等超时重投
      ctx.waitUntil(reply(env, chatId, trigger.ack));
      ctx.waitUntil(
        dispatch(env, EVENT_QUICK, trigger.payload).catch((err) => {
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

  /**
   * 定时闹钟:到点触发早报/晚报。cron 表达式与 [triggers] 里声明的一致,
   * 未登记的表达式只记日志 —— 改 wrangler.toml 忘了改这里时能立刻在 Logs 里看出来。
   */
  async scheduled(event, env, ctx) {
    const payload = CRON_JOBS[event.cron];
    if (!payload) {
      console.error(`[cron] 未登记的 cron 表达式:${event.cron}`);
      return;
    }
    // 定时没有会话可回执,失败只进 Worker Logs;Actions 侧的当日幂等保证重跑不会重复推送
    ctx.waitUntil(
      dispatch(env, EVENT_QUICK, payload).catch((err) => {
        console.error(`[cron] ${event.cron} 触发失败:${err instanceof Error ? err.message : String(err)}`);
      }),
    );
  },
};
