/** B 站热搜:解析、新上榜标记、条数上限、失败降级 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBiliHot } from '../src/modules/bilibili';
import { emptyState } from '../src/utils/state';
import { makeCfg } from './helpers';
import type { BotConfig, FetchContext } from '../src/types';

const LIST = [
  { keyword: '今年最后一次长庚伴月', heat_score: 1226970 },
  { keyword: 'LPL总决赛', heat_score: 561254 },
  { keyword: '新番开播', heat_score: 8600 },
];

function stubBili(opts: { code?: number; broken?: boolean; empty?: boolean } = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => {
    if (opts.broken) return new Response('server error', { status: 500 });
    const body = opts.empty
      ? { code: 0, data: { trending: { list: [] } } }
      : { code: opts.code ?? 0, data: { trending: { list: LIST } } };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function biliCfg(maxItems = 10): BotConfig {
  return makeCfg({ bilibili: { enabled: true, maxItems } });
}

function ctx(cfg: BotConfig, state = emptyState()): FetchContext {
  return { cfg, state, now: new Date('2026-09-15T08:00:00+08:00'), reportKind: 'morning' };
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchBiliHot', () => {
  it('输出榜单,名次从 1 开始,带热度值', async () => {
    stubBili();
    const res = await fetchBiliHot(ctx(biliCfg()));

    expect(res.ok).toBe(true);
    const items = (res.data as { items: { rank: number; word: string; heat?: number }[] }).items;
    expect(items.map((i) => i.word)).toEqual([
      '今年最后一次长庚伴月',
      'LPL总决赛',
      '新番开播',
    ]);
    expect(items[0]?.rank).toBe(1);
    expect(items[0]?.heat).toBe(1226970);
  });

  it('首次运行:所有词条都标为新上榜(seen 为空)', async () => {
    stubBili();
    const res = await fetchBiliHot(ctx(biliCfg()));
    const items = (res.data as { items: { isNew?: boolean }[] }).items;
    expect(items.every((i) => i.isNew === true)).toBe(true);
  });

  it('已见过的词条不再标新;新出现的照常标', async () => {
    stubBili();
    const state = emptyState();
    state.bilibili = { seen: ['今年最后一次长庚伴月', 'LPL总决赛'] };
    const res = await fetchBiliHot(ctx(biliCfg(), state));

    const items = (res.data as { items: { word: string; isNew?: boolean }[] }).items;
    expect(items[0]?.isNew).toBeUndefined();
    expect(items[1]?.isNew).toBeUndefined();
    expect(items[2]?.isNew).toBe(true); // 新番开播
  });

  it('全榜词条都写入 seen(含超出展示上限的)', async () => {
    stubBili();
    const state = emptyState();
    await fetchBiliHot(ctx(biliCfg(1), state)); // 只展示 1 条
    expect(state.bilibili?.seen).toEqual(
      expect.arrayContaining(['今年最后一次长庚伴月', 'LPL总决赛', '新番开播']),
    );
  });

  it('maxItems 截断输出但 rank 连续', async () => {
    stubBili();
    const res = await fetchBiliHot(ctx(biliCfg(2)));
    const items = (res.data as { items: { rank: number }[] }).items;
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.rank)).toEqual([1, 2]);
  });

  it('业务码非 0(风控等)按失败处理', async () => {
    stubBili({ code: -412 });
    const res = await fetchBiliHot(ctx(biliCfg()));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('code=-412');
  });

  it('HTTP 失败按失败处理', async () => {
    stubBili({ broken: true });
    const res = await fetchBiliHot(ctx(biliCfg()));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('HTTP 500');
  });

  it('榜单为空按失败处理(而不是静默推空块)', async () => {
    stubBili({ empty: true });
    const res = await fetchBiliHot(ctx(biliCfg()));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('没有可用条目');
  });
});
