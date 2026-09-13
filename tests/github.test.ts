/** GitHub Releases 模块:过滤、去重、firstRunQuiet、force、部分失败降级 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGithub } from '../src/modules/github';
import { emptyState } from '../src/utils/state';
import { makeCfg } from './helpers';
import type { BotConfig, FetchContext, GithubConfig, GithubDiscoverConfig } from '../src/types';

const RELEASES_A = [
  {
    id: 3, tag_name: 'v3.0', name: 'V3',
    body: '## Fixes\nSee [docs](https://x.y) and ![img](https://i.z)',
    prerelease: false, draft: false,
    published_at: '2026-09-12T10:00:00Z',
    html_url: 'https://github.com/a/b/releases/tag/v3.0',
  },
  { id: 2, tag_name: 'v2.0-rc', prerelease: true, draft: false, published_at: '2026-09-11T10:00:00Z', html_url: 'https://github.com/a/b/releases/tag/v2.0-rc' },
  { id: 1, tag_name: 'v1.0', prerelease: false, draft: false, published_at: '2026-09-10T10:00:00Z', html_url: 'https://github.com/a/b/releases/tag/v1.0' },
];

function ghCfg(over: Partial<GithubConfig> = {}): BotConfig {
  return makeCfg({ github: { enabled: true, repos: ['a/b'], includePrerelease: false, maxPerRepo: 3, firstRunQuiet: true, ...over } });
}

function ghCtx(cfg: BotConfig, state = emptyState(), force = false): FetchContext {
  return { cfg, state, now: new Date('2026-09-13T00:30:00Z'), force };
}

function stubReleasesApi(brokenRepo?: string): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (brokenRepo && url.includes(brokenRepo)) {
      return new Response('server error', { status: 500 });
    }
    return new Response(JSON.stringify(RELEASES_A), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchGithubReleases', () => {
  it('首次运行静默:只记录 seenIds 不推送', async () => {
    stubReleasesApi();
    const state = emptyState();
    const res = await fetchGithub(ghCtx(ghCfg(), state));

    expect(res.ok).toBe(true);
    expect(res.data?.releases).toEqual([]);
    expect(state.github?.repos?.['a/b']?.seenIds).toEqual(expect.arrayContaining([1, 3]));
    expect(state.github?.repos?.['a/b']?.seenIds).not.toContain(2); // prerelease 被过滤,不入游标
  });

  it('force 全量预览:忽略去重,输出可见 Release', async () => {
    stubReleasesApi();
    const res = await fetchGithub(ghCtx(ghCfg(), emptyState(), true));

    expect(res.ok).toBe(true);
    const tags = res.data?.releases.map((r) => r.tagName) ?? [];
    expect(tags).toEqual(['v3.0', 'v1.0']); // prerelease 仍按配置过滤;倒序
  });

  it('老仓库:只输出未见过的,摘要被清洗', async () => {
    stubReleasesApi();
    const state = emptyState();
    state.github = { repos: { 'a/b': { seenIds: [1] } } };
    const res = await fetchGithub(ghCtx(ghCfg(), state));

    const releases = res.data?.releases ?? [];
    expect(releases.map((r) => r.tagName)).toEqual(['v3.0']);
    // Markdown 图片删除、链接留文本、空白折叠
    expect(releases[0]?.summary).toBe('## Fixes See docs and');
  });

  it('prerelease 过滤可被 includePrerelease 打开', async () => {
    stubReleasesApi();
    const state = emptyState();
    state.github = { repos: { 'a/b': { seenIds: [1] } } };
    const res = await fetchGithub(ghCtx(ghCfg({ includePrerelease: true }), state));

    expect(res.data?.releases.map((r) => r.tagName)).toEqual(['v3.0', 'v2.0-rc']);
  });

  it('maxPerRepo 截断输出,但所有 id 仍记入游标', async () => {
    stubReleasesApi();
    const state = emptyState();
    state.github = { repos: { 'a/b': { seenIds: [2] } } }; // 让 v3/v1 都算"新"
    const res = await fetchGithub(ghCtx(ghCfg({ maxPerRepo: 1 }), state));

    expect(res.data?.releases).toHaveLength(1);
    expect(state.github?.repos?.['a/b']?.seenIds).toEqual(expect.arrayContaining([1, 3]));
  });

  it('单仓库失败降级为 warning,其余仓库正常', async () => {
    stubReleasesApi('c/d');
    const cfg = ghCfg({ repos: ['a/b', 'c/d'] });
    // force 让 a/b(新仓库)绕过 firstRunQuiet,便于断言其正常产出
    const res = await fetchGithub(ghCtx(cfg, emptyState(), true));

    expect(res.ok).toBe(true);
    expect(res.warnings?.join('\n')).toContain('仓库 c/d: HTTP 500');
    expect(res.data?.releases.length).toBeGreaterThan(0);
  });

  it('全部仓库失败时整体失败', async () => {
    stubReleasesApi('c/d');
    const res = await fetchGithub(ghCtx(ghCfg({ repos: ['c/d'] })));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('全部仓库拉取失败');
  });
});

/* ---------------- discover:中文区高星新项目 ---------------- */

const SEARCH_ITEMS = [
  { id: 11, full_name: 'foo/bar', html_url: 'https://github.com/foo/bar', description: 'an english project', stargazers_count: 500, language: 'Go', created_at: '2026-09-08T00:00:00Z', fork: false },
  { id: 12, full_name: 'cn/p', html_url: 'https://github.com/cn/p', description: '一个中文项目,做了件很酷的事', stargazers_count: 300, language: 'TypeScript', created_at: '2026-09-10T00:00:00Z', fork: false },
  { id: 13, full_name: 'cn/f', html_url: 'https://github.com/cn/f', description: '中文 fork 项目', stargazers_count: 200, language: 'Python', created_at: '2026-09-11T00:00:00Z', fork: true },
];

function stubGithubApi(opts: { brokenSearch?: boolean } = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/search/')) {
      if (opts.brokenSearch) return new Response('server error', { status: 500 });
      return new Response(JSON.stringify({ total_count: SEARCH_ITEMS.length, items: SEARCH_ITEMS }), { status: 200 });
    }
    return new Response(JSON.stringify(RELEASES_A), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function discCfg(over: Partial<GithubDiscoverConfig> = {}): BotConfig {
  return makeCfg({
    github: {
      enabled: true,
      repos: [],
      discover: {
        enabled: true, minStars: 50, createdWithinDays: 14, chineseOnly: true, maxItems: 10, firstRunQuiet: false,
        ...over,
      },
    },
  });
}

describe('fetchGithub discover 模式', () => {
  it('中文过滤 + 排除 fork,输出按星数排序', async () => {
    const fetchMock = stubGithubApi();
    const res = await fetchGithub(ghCtx(discCfg()));

    expect(res.ok).toBe(true);
    expect(res.data?.releases).toEqual([]); // repos 为空,无 Release
    const repos = res.data?.discoveries.map((d) => d.repo) ?? [];
    expect(repos).toEqual(['cn/p']); // 英文项目与 fork 被过滤
    expect(res.data?.discoveries[0]).toMatchObject({ stars: 300, language: 'TypeScript' });
    // 搜索查询带上了创建时间与星数下限
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain('stars%3A%3E%3D50');
    expect(calledUrl).toContain('created%3A%3E%3D');
  });

  it('首次静默只建立基线不推送', async () => {
    stubGithubApi();
    const state = emptyState();
    const res = await fetchGithub(ghCtx(discCfg({ firstRunQuiet: true }), state));

    expect(res.data?.discoveries).toEqual([]);
    // fork 仓库在进入游标前就被排除,只有真实候选入库
    expect(state.github?.discovery?.seenIds).toEqual(expect.arrayContaining([11, 12]));
  });

  it('已见过的 id 不再输出;关闭 chineseOnly 后英文项目可见', async () => {
    stubGithubApi();
    // 两次调用各用独立状态:第一次运行会把全量候选记入 seen(设计如此)
    const stateCn = emptyState();
    stateCn.github = { discovery: { seenIds: [12] } };
    const cnOnly = await fetchGithub(ghCtx(discCfg(), stateCn));
    expect(cnOnly.data?.discoveries).toEqual([]);

    const stateAll = emptyState();
    stateAll.github = { discovery: { seenIds: [12] } };
    const all = await fetchGithub(ghCtx(discCfg({ chineseOnly: false }), stateAll));
    expect(all.data?.discoveries.map((d) => d.repo)).toEqual(['foo/bar']);
  });

  it('force 全量预览忽略去重', async () => {
    stubGithubApi();
    const state = emptyState();
    state.github = { discovery: { seenIds: [12] } };
    const res = await fetchGithub(ghCtx(discCfg({ chineseOnly: false }), state, true));

    expect(res.data?.discoveries.map((d) => d.repo)).toEqual(['foo/bar', 'cn/p']);
  });

  it('搜索失败时整体失败并带原因', async () => {
    stubGithubApi({ brokenSearch: true });
    const res = await fetchGithub(ghCtx(discCfg()));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('新项目发现失败');
    expect(res.error).toContain('HTTP 500');
  });
});
