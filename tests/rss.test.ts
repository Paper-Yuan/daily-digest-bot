/** RSS 模块:解析清洗、去重、firstRunQuiet、单源失败降级 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRss } from '../src/modules/rss';
import { emptyState } from '../src/utils/state';
import { makeCfg } from './helpers';
import type { BotConfig, FetchContext, RssConfig } from '../src/types';

const FEED_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<rss version="2.0"><channel>',
  '<title>测试周刊</title><link>https://example.com</link><description>desc</description>',
  '<item>',
  '  <title>第一篇文章</title>',
  '  <link>https://example.com/post/1</link>',
  '  <pubDate>Sat, 12 Sep 2026 10:00:00 GMT</pubDate>',
  '  <description>Hello 世界 bold</description>',
  '</item>',
  '<item>',
  '  <title>第二篇 &amp; 随笔</title>',
  '  <link>https://example.com/post/2</link>',
  '  <pubDate>Fri, 11 Sep 2026 10:00:00 GMT</pubDate>',
  '  <description>第二条 &lt;b&gt;摘要&lt;/b&gt;</description>',
  '</item>',
  '<item>',
  '  <title>无链接条目</title>',
  '  <description>x</description>',
  '</item>',
  '</channel></rss>',
].join('\n');

vi.mock('../src/utils/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/http')>();
  return {
    ...actual, // 保留 HttpError 等真实导出,rss.ts 依赖它做错误归因
    httpGetText: vi.fn(async (url: string) => {
      if (url.includes('bad.example.com')) throw new Error('HTTP 503');
      return FEED_XML;
    }),
  };
});

function rssCfg(over: Partial<RssConfig> = {}): BotConfig {
  return makeCfg({
    rss: {
      enabled: true,
      feeds: [{ name: '周刊', url: 'https://feed.example.com/rss.xml' }],
      maxPerFeed: 5,
      firstRunQuiet: true,
      ...over,
    },
  });
}

function rssCtx(cfg: BotConfig, state = emptyState(), force = false): FetchContext {
  return { cfg, state, now: new Date('2026-09-13T00:30:00Z'), force };
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchRss', () => {
  it('force 预览:解析、清洗、跳过无链接条目', async () => {
    const res = await fetchRss(rssCtx(rssCfg({ firstRunQuiet: false }), emptyState(), true));

    expect(res.ok).toBe(true);
    const items = res.data?.items ?? [];
    expect(items).toHaveLength(2); // 无链接条目被跳过
    expect(items[0]).toMatchObject({ feedTitle: '周刊', title: '第一篇文章', summary: 'Hello 世界 bold' });
    expect(items[1]?.title).toBe('第二篇 & 随笔'); // 实体已解码且标签已清洗
    expect(items[1]?.summary).toBe('第二条 摘要');
  });

  it('首次运行静默:只记录 seen 不推送,次轮同样静默', async () => {
    const state = emptyState();
    const first = await fetchRss(rssCtx(rssCfg(), state));
    expect(first.data?.items).toEqual([]);
    expect(state.rss?.feeds?.['https://feed.example.com/rss.xml']?.seen).toHaveLength(2);

    // 第二轮:同样的内容全部已在 seen 中,仍无新增
    const second = await fetchRss(rssCtx(rssCfg(), state));
    expect(second.data?.items).toEqual([]);
  });

  it('老源有新条目时只输出增量', async () => {
    // 只预置第二条的 hash(等价于"第二条已推送过")
    const state = emptyState();
    const probe = await fetchRss(rssCtx(rssCfg({ firstRunQuiet: false }), emptyState(), true));
    const hashes = (probe.data?.items ?? []).map((i) => i.link);
    expect(hashes).toHaveLength(2);

    // 用真实 shortHash 生成 seen:直接复用模块内部逻辑太绕,改为把第一条标记为已见
    const { shortHash } = await import('../src/utils/state');
    state.rss = { feeds: { 'https://feed.example.com/rss.xml': { seen: [shortHash('https://example.com/post/1')] } } };

    const res = await fetchRss(rssCtx(rssCfg(), state));
    expect(res.data?.items.map((i) => i.title)).toEqual(['第二篇 & 随笔']);
  });

  it('maxPerFeed 截断', async () => {
    const res = await fetchRss(rssCtx(rssCfg({ maxPerFeed: 1, firstRunQuiet: false }), emptyState(), true));
    expect(res.data?.items).toHaveLength(1);
  });

  it('单源失败降级为 warning', async () => {
    const cfg = rssCfg({
      feeds: [
        { name: '坏源', url: 'https://bad.example.com/rss.xml' },
        { name: '好源', url: 'https://feed.example.com/rss.xml' },
      ],
      firstRunQuiet: false,
    });
    const res = await fetchRss(rssCtx(cfg, emptyState(), true));

    expect(res.ok).toBe(true);
    expect(res.warnings?.join('\n')).toContain('RSS 源 坏源: HTTP 503');
    expect(res.data?.items.length).toBeGreaterThan(0);
  });

  it('全部源失败时整体失败', async () => {
    const cfg = rssCfg({ feeds: [{ name: '坏源', url: 'https://bad.example.com/rss.xml' }] });
    const res = await fetchRss(rssCtx(cfg));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('全部源拉取失败');
  });
});
