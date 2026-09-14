/**
 * 早报渲染:ReportContext → 纯文本 + Telegram HTML 两种版式。
 *
 * 可视性设计:
 *  - 纯文本(飞书/控制台)没有粗体,用 "▌" 竖条标记区块标题,扫读时快速定位;
 *  - 区块标题统一 "emoji 名称 · N 条" 的计数格式;
 *  - 次要信息(描述/摘要)在文本版缩进两格,在 Telegram 版用 <blockquote>
 *    渲染成左侧引用条,与主行拉开层次;引用始终单行,不会跨分块边界;
 *  - 天气拆为"天况+温度 / 降水概率"两行,温度取整,降低数字密度;
 *  - 星数用 1.6k 紧凑格式;分隔符统一全角(｜ （） ：),贴合中文排版;
 *  - html 仅用 Telegram 允许的 <b> / <a> / <blockquote> 标签,
 *    所有动态文本先经 escapeHtml,防止内容中的 & < > 破坏标签结构。
 */

import type {
  CalendarEvent,
  GithubDiscovery,
  GithubRelease,
  HotSearchItem,
  ReportContext,
  ReportFailure,
  RssItem,
  WeatherInfo,
  WeatherWarning,
} from '../types';

/** html 转义:& → &amp;、< → &lt;、> → &gt;(先替换 &,避免二次转义) */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 一个区块的两种版式(行数组,不含区块间空行) */
interface Block {
  text: string[];
  html: string[];
}

/** 文本版区块标题:▌竖条 + emoji + 名称 + 条数 */
function textTitle(emoji: string, name: string, count: number): string {
  return `▌${emoji} ${name} · ${count} 条`;
}

/** 星数紧凑格式:1610 → 1.6k,300 → 300 */
function fmtStars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${n}`;
}

/* ---------------- 头部 ---------------- */

function headerBlock(ctx: ReportContext): Block {
  const emoji = ctx.reportKind === 'evening' ? '🌙' : ctx.reportKind === 'quick' ? '⚡' : '🌅';
  const title = ctx.reportKind === 'evening' ? '晚报' : ctx.reportKind === 'quick' ? '快报' : '早报';
  const heading = `${emoji} ${title} · ${ctx.dateLabel} ${ctx.timeLabel}`;
  return {
    text: [heading, `${ctx.greeting}！`, '────────────────────'],
    html: [
      `<b>${emoji} ${title}</b> · ${escapeHtml(ctx.dateLabel)} ${escapeHtml(ctx.timeLabel)}`,
      `${escapeHtml(ctx.greeting)}！`,
    ],
  };
}

/* ---------------- 模块故障 ---------------- */

function failureBlock(failures: ReportFailure[]): Block {
  const title = '▌⚠️ 模块故障';
  // module 是固定枚举字面量,无需转义;message 可能含任意字符
  return {
    text: [title, ...failures.map((f) => `• ${f.module}：${f.message}`)],
    html: [`<b>⚠️ 模块故障</b>`, ...failures.map((f) => `• ${f.module}：${escapeHtml(f.message)}`)],
  };
}

/* ---------------- 天气 ---------------- */

function weatherLine(w: WeatherInfo): string {
  let line = `${w.emoji} ${w.description} ｜ ${Math.round(w.tempMin)} ~ ${Math.round(w.tempMax)}°C`;
  if (w.tempNow !== undefined) line += `（当前 ${w.tempNow}°C）`;
  return line;
}

/** 预警行:优先 title,缺省用 level,都缺省只显示 detail */
function warningLine(wn: WeatherWarning): string {
  const head = wn.title || wn.level || '';
  const detail = wn.detail ?? '';
  return head && detail ? `🚨 ${head}：${detail}` : `🚨 ${head || detail}`;
}

function weatherBlock(w: WeatherInfo): Block {
  const text = [`▌🌤 天气 · ${w.locationName}`, weatherLine(w)];
  const html = [`<b>🌤 天气 · ${escapeHtml(w.locationName)}</b>`, escapeHtml(weatherLine(w))];
  if (w.precipitationProb !== undefined) {
    text.push(`💧 降水概率 ${w.precipitationProb}%`);
    html.push(`💧 降水概率 ${w.precipitationProb}%`);
  }
  for (const wn of w.warnings) {
    text.push(warningLine(wn));
    const head = escapeHtml(wn.title || wn.level || '');
    const detail = escapeHtml(wn.detail ?? '');
    html.push(head && detail ? `🚨 ${head}：${detail}` : `🚨 ${head || detail}`);
  }
  return { text, html };
}

/* ---------------- 日程 ---------------- */

function eventLine(e: CalendarEvent): string {
  const time = e.end ? `${e.start}-${e.end}` : e.start;
  let line = `• ${time} ${e.title}`;
  if (e.location) line += ` @${e.location}`;
  if (e.teacher) line += ` / ${e.teacher}`;
  if (e.tag) line += ` · ${e.tag}`;
  return `${line}（${e.source}）`;
}

function calendarBlock(events: CalendarEvent[]): Block {
  const title = textTitle('📅', '今日日程', events.length);
  const html = [`<b>📅 今日日程 · ${events.length} 条</b>`];
  for (const e of events) {
    const time = e.end ? `${e.start}-${e.end}` : e.start;
    let line = `• ${escapeHtml(time)} ${escapeHtml(e.title)}`;
    if (e.location) line += ` @${escapeHtml(e.location)}`;
    if (e.teacher) line += ` / ${escapeHtml(e.teacher)}`;
    if (e.tag) line += ` · ${escapeHtml(e.tag)}`;
    html.push(`${line}（${escapeHtml(e.source)}）`);
  }
  return { text: [title, ...events.map(eventLine)], html };
}

/* ---------------- 百度热搜 ---------------- */

function hotSearchBlock(items: HotSearchItem[]): Block {
  const title = textTitle('🔥', '百度热搜', items.length);
  const text = [title];
  const html = [`<b>🔥 百度热搜 · ${items.length} 条</b>`];
  for (const it of items) {
    const flag = it.isNew ? '🆕 ' : '';
    text.push(`${it.rank}. ${flag}${it.word}`);
    // html 版把词条做成搜索链接
    const safeWord = escapeHtml(it.word);
    const wordHtml = it.url ? `<a href="${escapeHtml(it.url)}">${safeWord}</a>` : safeWord;
    html.push(`${it.rank}. ${flag}${wordHtml}`);
  }
  return { text, html };
}

/* ---------------- GitHub Releases ---------------- */

function releaseBlock(releases: GithubRelease[]): Block {
  const title = textTitle('🚀', 'GitHub 新 Release', releases.length);
  const text = [title];
  const html = [`<b>🚀 GitHub 新 Release · ${releases.length} 条</b>`];
  for (const r of releases) {
    text.push(`• ${r.repo} ${r.tagName}`);
    html.push(`• ${escapeHtml(r.repo)} ${escapeHtml(r.tagName)}`);
    if (r.summary) {
      text.push(`  ${r.summary}`);
      html.push(`<blockquote>${escapeHtml(r.summary)}</blockquote>`);
    }
    text.push(`  ${r.url}`);
    html.push(`  <a href="${escapeHtml(r.url)}">原文链接</a>`);
  }
  return { text, html };
}

/* ---------------- GitHub 高星新项目(discover) ---------------- */

function discoveryBlock(items: GithubDiscovery[]): Block {
  const title = textTitle('🚀', 'GitHub 高星新项目', items.length);
  const text = [title];
  const html = [`<b>🚀 GitHub 高星新项目 · ${items.length} 条</b>`];
  for (const d of items) {
    const meta = `⭐ ${fmtStars(d.stars)}${d.language ? ` · ${d.language}` : ''}`;
    text.push(`• ${d.repo} ${meta}`);
    if (d.description) text.push(`  ${d.description}`);
    text.push(`  ${d.url}`);
    // html 版把仓库名做成链接
    const repoHtml = `<a href="${escapeHtml(d.url)}">${escapeHtml(d.repo)}</a>`;
    html.push(`• ${repoHtml} ${escapeHtml(meta)}`);
    if (d.description) html.push(`<blockquote>${escapeHtml(d.description)}</blockquote>`);
  }
  return { text, html };
}

/* ---------------- RSS ---------------- */

function rssBlock(items: RssItem[]): Block {
  const title = textTitle('🗞', '订阅更新', items.length);
  const text = [title];
  const html = [`<b>🗞 订阅更新 · ${items.length} 条</b>`];
  for (const it of items) {
    text.push(`• [${it.feedTitle}] ${it.title}`);
    html.push(`• [${escapeHtml(it.feedTitle)}] ${escapeHtml(it.title)}`);
    if (it.summary) {
      text.push(`  ${it.summary}`);
      html.push(`<blockquote>${escapeHtml(it.summary)}</blockquote>`);
    }
    text.push(`  ${it.link}`);
    html.push(`  <a href="${escapeHtml(it.link)}">原文链接</a>`);
  }
  return { text, html };
}

/* ---------------- 组装 ---------------- */

export function renderReport(ctx: ReportContext): { text: string; html: string } {
  const blocks: Block[] = [headerBlock(ctx)];
  if (ctx.failures.length > 0) blocks.push(failureBlock(ctx.failures));
  if (ctx.weather) blocks.push(weatherBlock(ctx.weather));
  if (ctx.calendar.length > 0) blocks.push(calendarBlock(ctx.calendar));
  if (ctx.hotItems.length > 0) blocks.push(hotSearchBlock(ctx.hotItems));
  if (ctx.releases.length > 0) blocks.push(releaseBlock(ctx.releases));
  if (ctx.discoveries.length > 0) blocks.push(discoveryBlock(ctx.discoveries));
  if (ctx.rss.length > 0) blocks.push(rssBlock(ctx.rss));
  // 毫无内容也毫无故障:渲染"今日无事"版
  if (!ctx.hasContent && ctx.failures.length === 0) {
    const empty = '今天没有新内容，一切安好 🌿';
    blocks.push({ text: [empty], html: [empty] });
  }
  return {
    text: blocks.map((b) => b.text.join('\n')).join('\n\n'),
    html: blocks.map((b) => b.html.join('\n')).join('\n\n'),
  };
}
