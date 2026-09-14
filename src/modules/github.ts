/**
 * GitHub 模块:两个可并存的子功能。
 *
 * 1) releases:盯指定仓库的最新 Release(拉 /releases,按 id 跨运行去重);
 * 2) discover:通过 Search API 发现最近创建、高 star 的新项目,
 *    可用中文启发式(名称/描述含 CJK 字符)过滤出"中文区"项目。
 *
 * 两种模式的失败互不拖累:单部分失败记入 warnings,两部分全失败才判模块失败。
 * 去重游标写在 ctx.state 草稿上,由 main 决定落盘。绝不向调用方抛异常。
 */

import { HttpError, httpGetJson } from '../utils/http';
import { pushCapped, pushCappedNumber } from '../utils/state';
import type {
  FetchContext,
  GithubDiscovery,
  GithubRelease,
  GithubRepoState,
  GithubSection,
  ModuleResult,
} from '../types';

/** GitHub Releases API 的单个元素(只声明用到的字段) */
interface GhApiRelease {
  id: number;
  tag_name: string;
  name?: string;
  body?: string;
  prerelease: boolean;
  draft: boolean;
  published_at?: string;
  html_url: string;
}

/** Search API 的仓库元素(只声明用到的字段) */
interface SearchApiRepo {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  created_at: string;
  fork: boolean;
}

const TIMEOUT_MS = 15_000;
const PER_PAGE = 10;
const SEARCH_PER_PAGE = 50;
/** 游标上限 */
const SEEN_CAP = 50;
const DISCOVERY_SEEN_CAP = 300;
const DEFAULT_MAX_PER_REPO = 3;
const DEFAULT_SUMMARY_CHARS = 100;
/** 新项目"单句介绍"的长度上限(图片按单行渲染,过长会被截断) */
const INTRO_MAX_CHARS = 52;
const DEFAULT_DISCOVER = {
  createdWithinDays: 7,
  minStars: 100,
  chineseOnly: true,
  maxItems: 10,
  firstRunQuiet: false,
};

/**
 * 清洗 Release 正文为纯文本摘要:
 * 去 Markdown 图片 / 链接留文本 / 去 HTML 标签 / 空白折叠 / 截断。
 * 空结果返回 undefined,由调用方处理(summary 为可选字段)。
 */
export function cleanReleaseSummary(
  body: string | undefined,
  maxChars: number,
): string | undefined {
  if (!body) return undefined;
  let s = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // Markdown 图片整段删除(须先于链接处理)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接只保留文本
    .replace(/<[^>]+>/g, '') // 去 HTML 标签
    .replace(/\s+/g, ' ') // 换行/连续空白折叠为单个空格
    .trim();
  if (!s) return undefined;
  if (s.length > maxChars) s = `${s.slice(0, maxChars)}…`;
  return s;
}

/** 运行时校验 API 元素,剔除字段缺失/类型不符的脏数据 */
function isRelease(v: unknown): v is GhApiRelease {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'number' &&
    typeof o.tag_name === 'string' &&
    typeof o.html_url === 'string'
  );
}

function isSearchRepo(v: unknown): v is SearchApiRepo {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'number' &&
    typeof o.full_name === 'string' &&
    typeof o.html_url === 'string' &&
    typeof o.created_at === 'string'
  );
}

/** ISO 时间转时间戳;解析失败按 0(排序时沉底) */
function pubTs(iso: string | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
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

/** API 元素 -> 输出结构(published_at 已在上游过滤保证存在) */
function toRelease(r: GhApiRelease, repo: string, summaryChars: number): GithubRelease {
  return {
    repo,
    tagName: r.tag_name,
    name: r.name || undefined,
    publishedAt: r.published_at as string,
    url: r.html_url,
    prerelease: r.prerelease === true,
    summary: cleanReleaseSummary(r.body, summaryChars),
  };
}

/**
 * 把仓库描述规整为"单句介绍":去 Markdown/HTML、折叠空白、只取第一句、按上限截断。
 *
 * 为什么取首句而非整段:新项目卡片按"一行"展示介绍,整段描述会被硬截成半句话
 * (如 "…支持 Clash/Mihomo 智能分流、Shadowrocket、sing-box、本地 VLE"),可读性差。
 * 取首个句末标点之前的内容,保证是一句完整的话。
 * 注意:中文的逗号/顿号是句内停顿,不作为断句依据,否则会把一句话切碎。
 */
export function toOneLineIntro(
  desc: string | undefined | null,
  maxChars: number,
): string | undefined {
  if (!desc) return undefined;
  const s = desc
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // Markdown 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接留文本
    .replace(/<[^>]+>/g, '') // HTML 标签
    .replace(/[\r\n]+/g, ' ') // 换行先折成空格,避免多行描述串味
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return undefined;
  // 断句:中文句末标点(。！？；)直接断;**英文句点只在"后接空格或结尾"时才算句末**,
  // 避免把 v1.2、Node.js、U.S. 这类内部含点的写法切断。
  const breaker = /^.*?(?:[。！？；]|\.(?=\s|$))/;
  const hit = breaker.exec(s)?.[0]?.trim();
  let out = hit || s;
  if (out.length > maxChars) out = `${out.slice(0, maxChars)}…`;
  return out || undefined;
}

/** 统一给 GitHub API 用的请求头(带 token 提升限额) */function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

/* ---------------- releases:盯指定仓库 ---------------- */

interface PartResult<T> {
  items: T;
  warnings: string[];
  failed: boolean;
  cause?: string;
}

async function fetchReleasesPart(
  ctx: FetchContext,
  repos: string[],
): Promise<PartResult<GithubRelease[]>> {
  const warnings: string[] = [];
  const cfg = ctx.cfg.github;
  const force = ctx.force === true;
  const quiet = cfg.firstRunQuiet !== false; // 默认 true
  const includePrerelease = cfg.includePrerelease === true; // 默认 false
  const maxPerRepo = cfg.maxPerRepo ?? DEFAULT_MAX_PER_REPO;
  const summaryChars = ctx.cfg.limits.summaryChars ?? DEFAULT_SUMMARY_CHARS;

  // 去重游标只写草稿,是否落盘由 main 决定
  if (!ctx.state.github) ctx.state.github = {};
  if (!ctx.state.github.repos) ctx.state.github.repos = {};
  const repoStates = ctx.state.github.repos;

  const out: GithubRelease[] = [];
  let firstCause: string | undefined;
  let okCount = 0;

  for (const repo of repos) {
    if (!/^[^/]+\/[^/]+$/.test(repo)) {
      const cause = '格式不合规,应为 owner/name';
      warnings.push(`仓库 ${repo}: ${cause}`);
      firstCause ??= cause;
      continue;
    }

    // 本次拉到(已过滤)的全部 Release,按 published_at 倒序;保留原始 id 供去重
    let fetched: GhApiRelease[];
    try {
      const raw = await httpGetJson<unknown>(
        `https://api.github.com/repos/${repo}/releases?per_page=${PER_PAGE}`,
        { timeoutMs: TIMEOUT_MS, headers: githubHeaders() },
      );
      if (!Array.isArray(raw)) throw new Error('响应格式异常(非数组)');
      fetched = (raw as unknown[])
        .filter(isRelease)
        .filter(
          (r) =>
            r.draft !== true && // 跳过 draft
            !!r.published_at && // 跳过无发布时间的
            !(r.prerelease === true && !includePrerelease), // 按配置跳过 prerelease
        )
        .sort((a, b) => pubTs(b.published_at) - pubTs(a.published_at));
    } catch (err) {
      const cause = errCause(err);
      warnings.push(`仓库 ${repo}: ${cause}`);
      firstCause ??= cause;
      continue;
    }
    okCount += 1;

    // ---- 去重:状态键为 repo 字符串 ----
    const prev = repoStates[repo];
    // seenIds 损坏(非数组)时按新仓库处理,保证模块不抛异常
    const existing: GithubRepoState | undefined =
      prev && Array.isArray(prev.seenIds) ? prev : undefined;

    let fresh: GhApiRelease[];
    if (!force && existing) {
      // 老仓库:只有未推送过的才算新
      fresh = fetched.filter((r) => !existing.seenIds.includes(r.id));
    } else if (!force && !existing && quiet) {
      // 新仓库 + 静默模式:首次只记录不推送,避免把历史版本全推一遍
      fresh = [];
    } else {
      // force 全量预览,或新仓库非静默:当前可见的全部视为新
      fresh = fetched;
    }

    // 本次拉到的所有 id(含未输出的)都记入 seenIds,避免下轮重复
    const st: GithubRepoState = existing ?? { seenIds: [] };
    let seen = st.seenIds;
    for (const r of fetched) seen = pushCappedNumber(seen, r.id, SEEN_CAP);
    st.seenIds = seen;
    st.lastPublishedAt = fetched[0]?.published_at ?? st.lastPublishedAt;
    repoStates[repo] = st;

    out.push(...fresh.slice(0, maxPerRepo).map((r) => toRelease(r, repo, summaryChars)));
  }

  if (okCount === 0) {
    return { items: [], warnings, failed: true, cause: firstCause ?? '未知原因' };
  }
  return { items: out, warnings, failed: false };
}

/* ---------------- discover:发现高星新项目 ---------------- */

/** 名称/描述含 CJK 字符视为"中文区"项目(启发式) */
const CJK_RE = /[\u4e00-\u9fff]/;

async function discoverPart(
  ctx: FetchContext,
): Promise<PartResult<GithubDiscovery[]>> {
  const d = ctx.cfg.github.discover ?? {};
  const minStars = d.minStars ?? DEFAULT_DISCOVER.minStars;
  const days = d.createdWithinDays ?? DEFAULT_DISCOVER.createdWithinDays;
  const chineseOnly = d.chineseOnly ?? DEFAULT_DISCOVER.chineseOnly;
  const maxItems = d.maxItems ?? DEFAULT_DISCOVER.maxItems;
  // discover 默认首次就推当前榜单("新项目发现"语义下首轮内容即有价值)
  const quiet = d.firstRunQuiet ?? DEFAULT_DISCOVER.firstRunQuiet;
  const force = ctx.force === true;

  if (!ctx.state.github) ctx.state.github = {};
  if (!ctx.state.github.discovery || !Array.isArray(ctx.state.github.discovery.seenIds)) {
    ctx.state.github.discovery = { seenIds: [] };
  }
  const prevSeen: number[] = ctx.state.github.discovery.seenIds ?? [];

  const since = new Date(ctx.now.getTime() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const q = `created:>=${since} stars:>=${minStars}`;
  const url =
    'https://api.github.com/search/repositories' +
    `?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${SEARCH_PER_PAGE}`;

  let candidates: SearchApiRepo[];
  try {
    const resp = await httpGetJson<{ items?: unknown }>(url, {
      timeoutMs: TIMEOUT_MS,
      headers: githubHeaders(),
    });
    if (!Array.isArray(resp.items)) throw new Error('搜索响应格式异常(非数组)');
    candidates = (resp.items as unknown[])
      .filter(isSearchRepo)
      .filter((r) => r.fork !== true); // 排除 fork
  } catch (err) {
    return { items: [], warnings: [], failed: true, cause: errCause(err) };
  }

  // 全量候选 id 记入游标(含被中文过滤掉的):之后切换 chineseOnly 也不会重复推
  let seen = prevSeen;
  for (const r of candidates) seen = pushCappedNumber(seen, r.id, DISCOVERY_SEEN_CAP);
  ctx.state.github.discovery.seenIds = seen;

  // 首次静默:只建立基线,不推送
  if (!force && prevSeen.length === 0 && quiet) {
    return { items: [], warnings: [], failed: false };
  }

  const freshBase = candidates.filter(
    (r) => !chineseOnly || CJK_RE.test(`${r.full_name} ${r.description ?? ''}`),
  );
  // force 是全量预览语义:忽略 seen,当前可见的都输出
  const fresh = (force ? freshBase : freshBase.filter((r) => !prevSeen.includes(r.id)))
    .slice(0, maxItems);

  const items: GithubDiscovery[] = fresh.map((r) => {
    const item: GithubDiscovery = {
      repo: r.full_name,
      url: r.html_url,
      stars: r.stargazers_count,
      createdAt: r.created_at,
    };
    if (r.language) item.language = r.language;
    // 单句介绍:描述取首句;仓库没写描述时给一句兜底,保证卡片信息结构一致
    item.description = toOneLineIntro(r.description, INTRO_MAX_CHARS) ?? '暂无简介';
    return item;
  });
  return { items, warnings: [], failed: false };
}

/* ---------------- 编排:两部分可并存 ---------------- */

export async function fetchGithub(
  ctx: FetchContext,
): Promise<ModuleResult<GithubSection>> {
  const warnings: string[] = [];
  const causes: string[] = [];
  const releases: GithubRelease[] = [];
  const discoveries: GithubDiscovery[] = [];
  let parts = 0;
  let okParts = 0;

  const repos = ctx.cfg.github.repos ?? [];
  if (repos.length > 0) {
    parts += 1;
    const r = await fetchReleasesPart(ctx, repos);
    releases.push(...r.items);
    warnings.push(...r.warnings);
    if (r.failed) causes.push(`全部仓库拉取失败(${r.cause ?? '未知原因'})`);
    else okParts += 1;
  }

  if (ctx.cfg.github.discover?.enabled === true) {
    parts += 1;
    const d = await discoverPart(ctx);
    discoveries.push(...d.items);
    warnings.push(...d.warnings);
    if (d.failed) causes.push(`新项目发现失败(${d.cause ?? '未知原因'})`);
    else okParts += 1;
  }

  if (parts === 0) {
    return {
      ok: true,
      data: { releases: [], discoveries: [] },
      warnings: ['未配置 github.repos,且 discover 未启用'],
    };
  }
  if (okParts === 0) {
    return { ok: false, data: null, error: `GitHub: ${causes.join('; ')}`, warnings };
  }

  releases.sort((a, b) => pubTs(b.publishedAt) - pubTs(a.publishedAt));
  return { ok: true, data: { releases, discoveries }, warnings };
}
