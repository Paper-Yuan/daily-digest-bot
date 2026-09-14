/**
 * B 站热搜模块:直连 B 站搜索页的热搜榜接口。
 *
 * 与百度热搜同构(榜单语义:每次输出当前榜 Top N,不做增量过滤),
 * 用 seen 记录给"新上榜"的词条打 🆕 标记 —— 热搜的价值在于
 * "今天整个榜单长什么样",过滤掉旧词条反而丢信息。
 *
 * 接口需要带浏览器 UA;B 站对空 UA / 脚本 UA 可能返回风控页。
 */

import { HttpError, httpGetJson } from '../utils/http';
import { pushCapped } from '../utils/state';
import type {
  BiliHotSection,
  FetchContext,
  HotSearchItem,
  ModuleResult,
} from '../types';

const API_URL = 'https://api.bilibili.com/x/web-interface/search/square?limit=50';
const SEEN_CAP = 200;
const DEFAULT_MAX_ITEMS = 10;

/** 接口元素(只声明用到的字段) */
interface BiliTrendItem {
  keyword?: unknown;
  show_name?: unknown;
  heat_score?: unknown;
}

interface BiliResp {
  code?: unknown;
  data?: { trending?: { list?: unknown } };
}

function errCause(err: unknown): string {
  if (err instanceof HttpError) return `HTTP ${err.status}`;
  if (err instanceof Error) {
    const msg = err.message.trim();
    return msg.length > 120 ? `${msg.slice(0, 120)}…` : msg || err.name;
  }
  return String(err);
}

/** 从响应里取出榜单数组(防御嵌套结构变化) */
function extractList(resp: BiliResp): BiliTrendItem[] {
  const list = resp.data?.trending?.list;
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is BiliTrendItem => Boolean(x) && typeof x === 'object');
}

export async function fetchBiliHot(
  ctx: FetchContext,
): Promise<ModuleResult<BiliHotSection>> {
  const maxItems = ctx.cfg.bilibili?.maxItems ?? DEFAULT_MAX_ITEMS;

  if (!ctx.state.bilibili || !Array.isArray(ctx.state.bilibili.seen)) {
    ctx.state.bilibili = { seen: [] };
  }
  const prevSeen: string[] = ctx.state.bilibili.seen ?? [];

  let raw: BiliTrendItem[];
  try {
    const resp = await httpGetJson<BiliResp>(API_URL, {
      timeoutMs: 15_000,
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        referer: 'https://www.bilibili.com/',
        accept: 'application/json',
      },
    });
    // B 站业务码:0 才是成功,其余(如 -412 风控)按失败处理
    if (typeof resp.code === 'number' && resp.code !== 0) {
      return { ok: false, data: null, error: `B 站热搜: 接口返回 code=${resp.code}` };
    }
    raw = extractList(resp);
    if (raw.length === 0) {
      return { ok: false, data: null, error: 'B 站热搜: 响应中没有可用条目' };
    }
  } catch (err) {
    return { ok: false, data: null, error: `B 站热搜: ${errCause(err)}` };
  }

  // 先记全榜词条(供下次判断"新上榜"),再组装本次输出
  let updatedSeen = prevSeen;
  const words: string[] = [];
  for (const item of raw) {
    const w = typeof item.keyword === 'string' ? item.keyword.trim() : '';
    if (w) {
      words.push(w);
      updatedSeen = pushCapped(updatedSeen, w, SEEN_CAP);
    }
  }
  ctx.state.bilibili.seen = updatedSeen;

  const items: HotSearchItem[] = [];
  for (const w of words) {
    if (items.length >= maxItems) break;
    const item: HotSearchItem = { rank: items.length + 1, word: w };
    if (!prevSeen.includes(w)) item.isNew = true;
    // 热度值:B 站给的是数字,补在词条后便于比较榜内冷热
    const src = raw.find((x) => typeof x.keyword === 'string' && x.keyword.trim() === w);
    const heat = src?.heat_score;
    if (typeof heat === 'number' && Number.isFinite(heat)) item.heat = heat;
    items.push(item);
  }

  return { ok: true, data: { items } };
}
