/** 百度热搜模块:榜单快照、🆕 新上榜标记、seen 游标、失败降级 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBaiduHot } from '../src/modules/baiduhot';
import { HttpError } from '../src/utils/http';
import { emptyState } from '../src/utils/state';
import { makeCfg } from './helpers';
import type { BotConfig, FetchContext } from '../src/types';

// 按真实接口的嵌套结构构造:cards[].content[] 为分组,分组 .content[] 为条目
const SAMPLE_RESP = {
  success: true,
  data: {
    cards: [
      {
        content: [
          {
            content: [
              { word: '词条A', url: 'https://m.baidu.com/s?word=A', index: 1, isTop: true },
              { word: '词条B', desc: '无链接条目' },
              { url: 'https://example.com', hotScore: '123' }, // 无 word,应被过滤
            ],
          },
          {
            content: [{ word: '词条C', url: 'https://m.baidu.com/s?word=C' }],
          },
        ],
      },
    ],
  },
};

const mockJson = vi.fn();
vi.mock('../src/utils/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/http')>();
  return { ...actual, httpGetJson: (...args: unknown[]) => mockJson(...args) };
});

function hotCtx(cfg: BotConfig, state = emptyState()): FetchContext {
  return { cfg, state, now: new Date('2026-09-13T06:30:00Z') };
}

afterEach(() => {
  mockJson.mockReset();
  vi.unstubAllGlobals();
});

describe('fetchBaiduHot', () => {
  it('递归提取嵌套条目并排序,首次运行全部标记新上榜', async () => {
    mockJson.mockResolvedValue(SAMPLE_RESP);
    const state = emptyState();
    const res = await fetchBaiduHot(hotCtx(makeCfg(), state));

    expect(res.ok).toBe(true);
    const items = res.data?.items ?? [];
    expect(items.map((i) => i.word)).toEqual(['词条A', '词条B', '词条C']); // 无 word 的被过滤
    expect(items.map((i) => i.rank)).toEqual([1, 2, 3]);
    expect(items.every((i) => i.isNew)).toBe(true);
    expect(items[0]?.url).toBe('https://m.baidu.com/s?word=A');
    expect(items[1]?.url).toBeUndefined();
    // 全榜词条记入 seen
    expect(state.baidu?.seen).toEqual(expect.arrayContaining(['词条A', '词条B', '词条C']));
  });

  it('已见过的词条不再标记新上榜', async () => {
    mockJson.mockResolvedValue(SAMPLE_RESP);
    const state = emptyState();
    state.baidu = { seen: ['词条A'] };

    const res = await fetchBaiduHot(hotCtx(makeCfg(), state));
    const items = res.data?.items ?? [];
    expect(items.find((i) => i.word === '词条A')?.isNew).toBeUndefined();
    expect(items.find((i) => i.word === '词条B')?.isNew).toBe(true);
  });

  it('maxItems 截断展示,但全榜仍记入 seen', async () => {
    mockJson.mockResolvedValue(SAMPLE_RESP);
    const state = emptyState();
    const res = await fetchBaiduHot(hotCtx(makeCfg({ baiduhot: { enabled: true, maxItems: 2 } }), state));

    expect(res.data?.items).toHaveLength(2);
    expect(state.baidu?.seen).toEqual(expect.arrayContaining(['词条C']));
  });

  it('接口失败时整体降级为模块故障', async () => {
    mockJson.mockRejectedValue(new HttpError(403, 'forbidden', API_URL()));
    function API_URL(): string { return 'https://top.baidu.com/api/board'; }

    const res = await fetchBaiduHot(hotCtx(makeCfg(), emptyState()));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('百度热搜');
    expect(res.error).toContain('403');
  });
});
