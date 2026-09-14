/** GitHub Releases 模块:过滤、去重、firstRunQuiet、force、部分失败降级 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchGithub,
  isChineseProject,
  resolveWeights,
  scoreDiscoveries,
  toOneLineIntro,
} from '../src/modules/github';
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

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

/** 活跃度 GraphQL 响应:按仓库名给出提交/issue 数 */
function gqlResponse(names: string[]): string {
  const data: Record<string, unknown> = {};
  names.forEach((full, idx) => {
    data[`r${idx}`] = {
      defaultBranchRef: { target: { history: { totalCount: 10 * (idx + 1) } } },
      issues: { totalCount: idx },
    };
  });
  return JSON.stringify({ data });
}

function stubGithubApi(
  opts: { brokenSearch?: boolean; brokenGraphql?: boolean; nullRepo?: boolean } = {},
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: unknown, init?: unknown) => {
    const url = String(input);
    if (url.includes('/graphql')) {
      if (opts.brokenGraphql) return new Response('server error', { status: 500 });
      // 从 query 里把别名对应的仓库名还原出来,按顺序给指标
      const body = JSON.parse(String((init as { body?: string } | undefined)?.body ?? '{}')) as { query?: string };
      const matches = [...(body.query ?? '').matchAll(/owner: "([^"]+)", name: "([^"]+)"/g)];
      const names = matches.map((m) => `${m[1]}/${m[2]}`);
      if (opts.nullRepo && names.length > 0) {
        // 模拟"搜索之后仓库消失":该别名为 null,但不带 errors,其余别名照常有数据
        const resp = JSON.parse(gqlResponse(names)) as { data: Record<string, unknown> };
        resp.data.r0 = null;
        return new Response(JSON.stringify(resp), { status: 200 });
      }
      return new Response(gqlResponse(names), { status: 200 });
    }
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
    const searchCall = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.includes('/search/')) ?? '';
    expect(searchCall).toContain('stars%3A%3E%3D50');
    expect(searchCall).toContain('created%3A%3E%3D');
  });

  it('无 GITHUB_TOKEN 时不请求活跃度,退化为按 star 排序并给出提示', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    vi.stubEnv('GH_TOKEN', '');
    const fetchMock = stubGithubApi();
    const res = await fetchGithub(ghCtx(discCfg({ chineseOnly: false }), emptyState(), true));

    // 没有 token 就不该发 GraphQL 请求
    expect(fetchMock.mock.calls.map((c) => String(c[0])).some((u) => u.includes('/graphql'))).toBe(false);
    expect(res.warnings?.join('\n')).toContain('未配置 GITHUB_TOKEN');
    // 排序仍是 star 倒序(foo/bar 500 > cn/p 300)
    expect(res.data?.discoveries.map((d) => d.repo)).toEqual(['foo/bar', 'cn/p']);
    // 拿不到活跃度就不该把 commits/issues/score 填成 0
    expect(res.data?.discoveries[0]?.commits).toBeUndefined();
    expect(res.data?.discoveries[0]?.score).toBeUndefined();
  });

  it('有 token 时取回提交/issue 数并给出得分,分数高的排前面', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'test-token');
    stubGithubApi();
    const res = await fetchGithub(ghCtx(discCfg({ chineseOnly: false, weights: { stars: 0, commits: 1, issues: 0 } }), emptyState(), true));

    const items = res.data?.discoveries ?? [];
    expect(items).toHaveLength(2);
    // fixture:foo/bar 是第 0 个候选 → 10 提交;cn/p 第 1 个 → 20 提交
    for (const d of items) {
      expect(typeof d.commits).toBe('number');
      expect(typeof d.issues).toBe('number');
      expect(typeof d.score).toBe('number');
    }
    // 权重只看提交数 → 20 提交的 cn/p 应排第一(尽管它 star 更少)
    expect(items.map((d) => d.repo)).toEqual(['cn/p', 'foo/bar']);
  });

  it('GraphQL 失败时降级为按 star 排序并记警告,不影响推送', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'test-token');
    stubGithubApi({ brokenGraphql: true });
    const res = await fetchGithub(ghCtx(discCfg({ chineseOnly: false }), emptyState(), true));

    expect(res.ok).toBe(true); // 活跃度只是加分项,不该让整块失败
    expect(res.warnings?.join('\n')).toContain('活跃度数据拉取失败');
    expect(res.data?.discoveries.map((d) => d.repo)).toEqual(['foo/bar', 'cn/p']);
    expect(res.data?.discoveries[0]?.score).toBeUndefined();
  });

  it('仓库在搜索后消失(别名为 null)按 0 计,不拖垮整批', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'test-token');
    stubGithubApi({ nullRepo: true });
    const res = await fetchGithub(ghCtx(discCfg({ chineseOnly: false }), emptyState(), true));

    expect(res.ok).toBe(true);
    const items = res.data?.discoveries ?? [];
    expect(items).toHaveLength(2);
    // 缺失的那个记 0,另一个照常有真实数据
    const missing = items.find((d) => d.repo === 'foo/bar');
    expect(missing?.commits).toBe(0);
    expect(items.find((d) => d.repo === 'cn/p')?.commits).toBeGreaterThan(0);
  });

  it('三项权重全写 0 时回落默认权重(仍然请求活跃度,不产生空榜单)', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'test-token');
    const fetchMock = stubGithubApi();
    const res = await fetchGithub(ghCtx(discCfg({ chineseOnly: false, weights: { stars: 0, commits: 0, issues: 0 } }), emptyState(), true));
    expect(res.ok).toBe(true);
    expect(res.data?.discoveries.length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.map((c) => String(c[0])).some((u) => u.includes('/graphql'))).toBe(true);
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

describe('toOneLineIntro(单句介绍)', () => {
  it('只取第一个句末标点之前的内容', () => {
    expect(toOneLineIntro('一个很棒的项目。它还支持很多东西。', 60)).toBe('一个很棒的项目。');
    expect(toOneLineIntro('Fast tool for X. Works everywhere.', 60)).toBe('Fast tool for X.');
    expect(toOneLineIntro('这项目真好！后面还有内容', 60)).toBe('这项目真好！');
  });

  it('中文逗号/顿号不算句末,不会把一句话切碎', () => {
    const s = '基于 Cloudflare WARP 的可视化注册、配置生成工具，支持多客户端转换';
    expect(toOneLineIntro(s, 60)).toBe(s);
  });

  it('清洗 Markdown/HTML 并折叠空白', () => {
    expect(toOneLineIntro('![图](https://x/y.png) 看 [文档](https://a.b) 吧', 60)).toBe('看 文档 吧');
    expect(toOneLineIntro('<b>粗体</b>\n换行   多空格', 60)).toBe('粗体 换行 多空格');
  });

  it('超长内容按上限截断并加省略号', () => {
    const long = '这是一个特别特别长的描述'.repeat(6); // 无句末标点
    const out = toOneLineIntro(long, 20);
    expect(out).toBeDefined();
    expect(out?.length).toBe(21); // 20 字符 + …
    expect(out?.endsWith('…')).toBe(true);
  });

  it('空值/纯空白返回 undefined', () => {
    expect(toOneLineIntro(undefined, 50)).toBeUndefined();
    expect(toOneLineIntro('', 50)).toBeUndefined();
    expect(toOneLineIntro('   ', 50)).toBeUndefined();
  });

  it('discovery 输出始终带单句介绍(缺描述时给兜底)', async () => {
    stubGithubApi();
    const res = await fetchGithub(ghCtx(discCfg({ chineseOnly: false }), emptyState(), true));
    const items = res.data?.discoveries ?? [];
    expect(items.length).toBeGreaterThan(0);
    for (const d of items) {
      expect(typeof d.description).toBe('string');
      expect(d.description!.length).toBeGreaterThan(0);
    }
    // 示例描述 "an english project" 无句末标点,应原样返回
    expect(items.find((d) => d.repo === 'foo/bar')?.description).toBe('an english project');
  });
});

/* ---------------- 加权评分算法 ---------------- */

describe('isChineseProject(中文区判定)', () => {
  it('含汉字即算中文区', () => {
    expect(isChineseProject('一个中文项目')).toBe(true);
    expect(isChineseProject('中文项目 by someone')).toBe(true);
  });

  it('含日文假名的不算(日文也用汉字,只判断汉字会误收)', () => {
    expect(isChineseProject('中文ドキュメント')).toBe(false);
    expect(isChineseProject('ひらがな と 漢字')).toBe(false);
    expect(isChineseProject('カタカナ')).toBe(false);
  });

  it('纯英文不算', () => {
    expect(isChineseProject('an english project')).toBe(false);
  });
});

describe('resolveWeights(权重规整)', () => {
  it('未配置时用默认 0.4 / 0.3 / 0.3', () => {
    expect(resolveWeights(undefined)).toEqual({ stars: 0.4, commits: 0.3, issues: 0.3 });
  });

  it('显式配置时未写的项按 0(只写 stars 即纯 star 排序)', () => {
    expect(resolveWeights({ stars: 1 })).toEqual({ stars: 1, commits: 0, issues: 0 });
  });

  it('归一化到和为 1(写 4/3/3 与 0.4/0.3/0.3 等价)', () => {
    expect(resolveWeights({ stars: 4, commits: 3, issues: 3 })).toEqual({ stars: 0.4, commits: 0.3, issues: 0.3 });
    const w = resolveWeights({ stars: 2, commits: 2, issues: 0 });
    expect(w.stars).toBeCloseTo(0.5, 10);
    expect(w.commits).toBeCloseTo(0.5, 10);
    expect(w.issues).toBe(0);
  });

  it('非法值被忽略;全 0 或不合法时回落到默认权重', () => {
    expect(resolveWeights({ stars: -1, commits: Number.NaN, issues: 1 })).toEqual({ stars: 0, commits: 0, issues: 1 });
    expect(resolveWeights({ stars: 0, commits: 0, issues: 0 })).toEqual({ stars: 0.4, commits: 0.3, issues: 0.3 });
  });
});

describe('scoreDiscoveries(加权评分)', () => {
  // 用文档口径的真实分布:star 重尾,提交/issue 与 star 不同向
  const POOL = [
    { name: '冲星型', stars: 689, commits: 6, issues: 4 },
    { name: '活跃型', stars: 32, commits: 343, issues: 6 },
    { name: '均衡型', stars: 209, commits: 64, issues: 5 },
  ];

  it('默认权重下"冲星型"垫底:星最多但几乎不迭代,不该霸榜', () => {
    const scored = scoreDiscoveries(POOL, resolveWeights(undefined));
    for (const s of scored) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
    }
    // 这是本次改动的核心动机:689 星但只有 6 次提交的仓库排在最后
    expect(scored.map((s) => s.name)).toEqual(['活跃型', '均衡型', '冲星型']);
    expect(scored[scored.length - 1]?.stars).toBe(689); // 垫底者恰恰是 star 最高的
  });

  it('同一组数据换成纯 star 权重,"冲星型"立刻回到第一', () => {
    const scored = scoreDiscoveries(POOL, resolveWeights({ stars: 1 }));
    // 对比上一个用例:排序完全倒过来,说明加权逻辑确实在起作用
    expect(scored.map((s) => s.name)).toEqual(['冲星型', '均衡型', '活跃型']);
  });

  it('权重只看提交时,提交最多的排第一(即便 star 最低)', () => {
    const scored = scoreDiscoveries(POOL, resolveWeights({ commits: 1 }));
    expect(scored.map((s) => s.name)).toEqual(['活跃型', '均衡型', '冲星型']);
  });

  it('用 log1p 压缩重尾:指标差 10 倍不会让其余项的区分度归零', () => {
    // 若不做 log,star 项会被 100→1000 直接压成 0/1 两档;取对数后中间值仍有分数
    const pool = [
      { stars: 10, commits: 0, issues: 0 },
      { stars: 100, commits: 0, issues: 0 },
      { stars: 1000, commits: 0, issues: 0 },
    ];
    const scored = scoreDiscoveries(pool, resolveWeights({ stars: 1 }));
    const mid = scored.find((s) => s.stars === 100)!;
    // log1p 下 log(101) 刚好落在 log(11) 与 log(1001) 之间,归一化后约 0.5
    expect(mid.score).toBeGreaterThan(30);
    expect(mid.score).toBeLessThan(70);
  });

  it('所有指标相等时全部得 0 分(不会出现除零/NaN)', () => {
    const pool = [
      { stars: 5, commits: 5, issues: 5 },
      { stars: 5, commits: 5, issues: 5 },
    ];
    const scored = scoreDiscoveries(pool, resolveWeights(undefined));
    for (const s of scored) expect(s.score).toBe(0);
  });

  it('空数组返回空数组', () => {
    expect(scoreDiscoveries([], resolveWeights(undefined))).toEqual([]);
  });

  it('不改动入参(返回新数组)', () => {
    const pool = [{ stars: 1, commits: 1, issues: 1 }, { stars: 9, commits: 9, issues: 9 }];
    const snapshot = JSON.stringify(pool);
    scoreDiscoveries(pool, resolveWeights(undefined));
    expect(JSON.stringify(pool)).toBe(snapshot);
  });
});
