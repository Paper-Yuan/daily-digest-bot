/**
 * RSS 模块。
 *
 * 职责:拉取各订阅源的最新条目,用 link 的短哈希做跨运行去重
 * (游标写在 ctx.state 草稿上,由 main 决定落盘;状态键用 url,名字可能改、url 稳定)。
 * 单源失败只记 warnings;全部失败才判模块失败。绝不向调用方抛异常。
 */

import Parser from 'rss-parser';
import { HttpError, httpGetText } from '../utils/http';
import { pushCapped, shortHash } from '../utils/state';
import type {
  FetchContext,
  ModuleResult,
  RssFeedState,
  RssItem,
  RssSection,
} from '../types';

const TIMEOUT_MS = 15_000;
/** seen 上限:与 pushCapped 配合,只保留最近 300 个 */
const SEEN_CAP = 300;
const DEFAULT_MAX_PER_FEED = 5;
const TITLE_MAX_CHARS = 80;
const DEFAULT_SUMMARY_CHARS = 100;

/** 去重前条目的中间形态:item 为最终输出,hash 为去重标识 */
interface MappedEntry {
  item: RssItem;
  hash: string;
}

/**
 * 清洗为纯文本并截断:去 HTML 标签 / 解码常见实体 / 空白折叠 / 截断。
 * 空结果返回 undefined。注意 &amp; 放到最后解码,避免 "&amp;lt;" 被二次解码。
 */
export function cleanRssText(input: string | undefined, maxChars: number): string | undefined {
  if (!input) return undefined;
  let s = input
    .replace(/<[^>]+>/g, '') // 去 HTML 标签
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ') // 换行/连续空白折叠为单个空格
    .trim();
  if (!s) return undefined;
  if (s.length > maxChars) s = `${s.slice(0, maxChars)}…`;
  return s;
}

/** 把任意异常压成一句短原因(用于 warnings / error) */
function errCause(err: unknown): string {
  if (err instanceof HttpError) return `HTTP ${err.status}`;
  if (err instanceof Error) {
    const msg = err.message.trim();
    if (!msg) return err.name;
    return msg.length > 120 ? `${msg.slice(0, 120)}…` : msg;
  }
  return String(err);
}

/** 把 feed 原始条目映射为输出结构并计算去重哈希(保序) */
function mapItems(items: Parser.Item[], feedTitle: string, summaryChars: number): MappedEntry[] {
  const out: MappedEntry[] = [];
  for (const it of items) {
    // 无 title 或无 link 的条目跳过;link 必须是 http(s)
    const link = typeof it.link === 'string' ? it.link.trim() : undefined;
    const title = cleanRssText(
      typeof it.title === 'string' ? it.title : undefined,
      TITLE_MAX_CHARS,
    );
    if (!title || !link || !/^https?:\/\//i.test(link)) continue;

    const publishedAt =
      typeof it.isoDate === 'string' && it.isoDate
        ? it.isoDate
        : typeof it.pubDate === 'string' && it.pubDate
          ? it.pubDate
          : undefined;

    // 摘要:优先 contentSnippet(已是纯文本),否则 content / summary 清洗
    const rawSummary =
      typeof it.contentSnippet === 'string' && it.contentSnippet.trim()
        ? it.contentSnippet
        : typeof it.content === 'string' && it.content
          ? it.content
          : typeof it.summary === 'string'
            ? it.summary
            : undefined;

    out.push({
      item: {
        feedTitle,
        title,
        link,
        publishedAt,
        summary: cleanRssText(rawSummary, summaryChars),
      },
      // 去重标识 = link 短哈希(link 上面已确保存在,无需 title 兜底)
      hash: shortHash(link),
    });
  }
  return out;
}

export async function fetchRss(ctx: FetchContext): Promise<ModuleResult<RssSection>> {
  const warnings: string[] = [];
  const cfg = ctx.cfg.rss;
  const force = ctx.force === true;
  const quiet = cfg.firstRunQuiet !== false; // 默认 true
  const maxPerFeed = cfg.maxPerFeed ?? DEFAULT_MAX_PER_FEED;
  const summaryChars = ctx.cfg.limits.summaryChars ?? DEFAULT_SUMMARY_CHARS;

  // 跳过 url 为空的源
  const feeds = (cfg.feeds ?? []).filter(
    (f) => typeof f.url === 'string' && f.url.trim() !== '',
  );
  if (feeds.length === 0) {
    return { ok: true, data: { items: [] }, warnings: ['未配置 rss.feeds'] };
  }

  // 去重游标只写草稿;状态键用 url(名字可能改,url 稳定)
  if (!ctx.state.rss) ctx.state.rss = {};
  if (!ctx.state.rss.feeds) ctx.state.rss.feeds = {};
  const feedStates = ctx.state.rss.feeds;

  const parser = new Parser();
  const out: RssItem[] = [];
  let firstCause: string | undefined;
  let okCount = 0;

  for (const feed of feeds) {
    const url = feed.url.trim();
    let feedTitle = feed.name || 'RSS'; // 解析失败时的兜底显示名

    let mapped: MappedEntry[];
    try {
      const text = await httpGetText(url, { timeoutMs: TIMEOUT_MS });
      const parsed = await parser.parseString(text);
      feedTitle = feed.name || parsed.title || 'RSS';
      mapped = mapItems(Array.isArray(parsed.items) ? parsed.items : [], feedTitle, summaryChars);
    } catch (err) {
      const cause = errCause(err);
      warnings.push(`RSS 源 ${feedTitle}: ${cause}`);
      firstCause ??= cause;
      continue;
    }
    okCount += 1;

    // ---- 去重:状态键为 url ----
    const prev = feedStates[url];
    // seen 损坏(非数组)时按新源处理,保证模块不抛异常
    const existing: RssFeedState | undefined = prev && Array.isArray(prev.seen) ? prev : undefined;

    let fresh: MappedEntry[];
    if (!force && existing) {
      // 老源:按 feed 原始顺序取未推送过的
      fresh = mapped.filter((e) => !existing.seen.includes(e.hash));
    } else if (!force && !existing && quiet) {
      // 新源 + 静默模式:首次只记录不推送,避免刷屏
      fresh = [];
    } else {
      // force 全量预览,或新源非静默:全部视为新
      fresh = mapped;
    }

    // 本次拉到的全部 hash(含未输出的)都记入 seen
    const st: RssFeedState = existing ?? { seen: [] };
    let seen = st.seen;
    for (const e of mapped) seen = pushCapped(seen, e.hash, SEEN_CAP);
    st.seen = seen;
    st.lastCheck = ctx.now.toISOString();
    feedStates[url] = st;

    // 各源内部保序,新条目在前
    out.push(...fresh.slice(0, maxPerFeed).map((e) => e.item));
  }

  if (okCount === 0) {
    return {
      ok: false,
      data: null,
      error: `RSS: 全部源拉取失败(${firstCause ?? '未知原因'})`,
      warnings,
    };
  }
  return { ok: true, data: { items: out }, warnings };
}
