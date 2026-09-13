/**
 * 百度热搜模块:直连百度热搜榜的 JSON 接口(top.baidu.com 移动页同款),
 * 不依赖第三方 RSS 桥。每次运行输出当前榜单快照(Top N),
 * 并用历史 seen 记录给"新上榜"的词条打 🆕 标记。
 *
 * 为什么不去重:热搜的价值在于"今天整个榜单长什么样",增量过滤反而丢信息;
 * seen 只用来对比变化,不对输出做删减。
 */

import { HttpError, httpGetJson } from '../utils/http';
import { pushCapped } from '../utils/state';
import type {
  BaiduHotSection,
  FetchContext,
  HotSearchItem,
  ModuleResult,
} from '../types';

const API_URL = 'https://top.baidu.com/api/board?platform=wise&tab=realtime';
const SEEN_CAP = 200;
const DEFAULT_MAX_ITEMS = 10;

/** 接口元素(只声明用到的字段,其余按 unknown 防御) */
interface BaiduApiItem {
  word?: unknown;
  url?: unknown;
}

interface BaiduApiResp {
  success?: unknown;
  data?: { cards?: unknown };
}

function errCause(err: unknown): string {
  if (err instanceof HttpError) return `HTTP ${err.status}`;
  if (err instanceof Error) {
    const msg = err.message.trim();
    return msg.length > 120 ? `${msg.slice(0, 120)}…` : msg || err.name;
  }
  return String(err);
}

/** 递归收集嵌套结构里所有带 string word 字段的对象,兼容接口的层级变化 */
function collectWords(node: unknown, out: BaiduApiItem[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collectWords(child, out);
    return;
  }
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o.word === 'string') {
      out.push(node as BaiduApiItem);
      return;
    }
    if (o.content !== undefined) collectWords(o.content, out);
  }
}

export async function fetchBaiduHot(
  ctx: FetchContext,
): Promise<ModuleResult<BaiduHotSection>> {
  const maxItems = ctx.cfg.baiduhot?.maxItems ?? DEFAULT_MAX_ITEMS;

  // seen 记录全榜词条(不止展示的 Top N),保证"新上榜"判断跨名次变化依然准确
  if (!ctx.state.baidu || !Array.isArray(ctx.state.baidu.seen)) {
    ctx.state.baidu = { seen: [] };
  }
  const prevSeen: string[] = ctx.state.baidu.seen ?? [];

  let rawItems: BaiduApiItem[];
  try {
    const resp = await httpGetJson<BaiduApiResp>(API_URL, {
      timeoutMs: 15_000,
      headers: {
        // 百度接口对非浏览器 UA 可能拒绝,带上常规 UA 与 Referer
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        referer: 'https://top.baidu.com/board?tab=realtime',
        accept: 'application/json',
      },
    });
    rawItems = [];
    collectWords(resp.data?.cards, rawItems);
    if (rawItems.length === 0) {
      return { ok: false, data: null, error: '百度热搜: 响应中没有可用条目' };
    }
  } catch (err) {
    return { ok: false, data: null, error: `百度热搜: ${errCause(err)}` };
  }

  // 先记全榜词条到 seen(供下次对比),再组装本次输出
  let updatedSeen = prevSeen;
  for (const raw of rawItems) {
    const word = typeof raw.word === 'string' ? raw.word.trim() : '';
    if (word) updatedSeen = pushCapped(updatedSeen, word, SEEN_CAP);
  }
  ctx.state.baidu.seen = updatedSeen;

  const items: HotSearchItem[] = [];
  for (const raw of rawItems) {
    if (items.length >= maxItems) break;
    const word = typeof raw.word === 'string' ? raw.word.trim() : '';
    if (!word) continue;
    const item: HotSearchItem = { rank: items.length + 1, word };
    if (typeof raw.url === 'string' && /^https?:\/\//i.test(raw.url)) {
      item.url = raw.url;
    }
    if (!prevSeen.includes(word)) item.isNew = true;
    items.push(item);
  }

  return { ok: true, data: { items } };
}
