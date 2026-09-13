/**
 * 早报渲染:ReportContext → 纯文本 + Telegram HTML 两种版式。
 *
 * 设计要点:
 *  - renderReport 是纯函数:无副作用、不改入参,相同输入必得相同输出;
 *  - text 与 html 同构:每个区块同时产出两种版式,信息一致、只有排版不同;
 *  - html 仅用 Telegram 允许的 <b> / <a> 标签,所有动态文本先经 escapeHtml,
 *    防止内容中的 & < > 破坏标签结构导致发送失败;
 *  - 空区块整体省略,区块之间以一个空行分隔。
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

/* ---------------- 头部 ---------------- */

function headerBlock(ctx: ReportContext): Block {
  const emoji = ctx.reportKind === 'evening' ? '🌙' : '🌅';
  const title = ctx.reportKind === 'evening' ? '晚报' : '早报';
  return {
    text: [`${emoji} ${title} | ${ctx.dateLabel} ${ctx.timeLabel}`, `${ctx.greeting}!`],
    html: [
      `${emoji} ${title} | ${escapeHtml(ctx.dateLabel)} ${escapeHtml(ctx.timeLabel)}`,
      `${escapeHtml(ctx.greeting)}!`,
    ],
  };
}

/* ---------------- 模块故障 ---------------- */

function failureBlock(failures: ReportFailure[]): Block {
  const title = '⚠️ 模块故障';
  // module 是固定枚举字面量,无需转义;message 可能含任意字符
  return {
    text: [title, ...failures.map((f) => `• ${f.module}: ${f.message}`)],
    html: [`<b>${title}</b>`, ...failures.map((f) => `• ${f.module}: ${escapeHtml(f.message)}`)],
  };
}

/* ---------------- 天气 ---------------- */

function weatherLine(w: WeatherInfo): string {
  let line = `${w.emoji} ${w.description} ${w.tempMin} ~ ${w.tempMax}°C`;
  if (w.tempNow !== undefined) line += `(当前 ${w.tempNow}°C)`;
  if (w.precipitationProb !== undefined) line += `| 降水概率 ${w.precipitationProb}%`;
  return line;
}

/** 预警行:优先 title,缺省用 level,都缺省只显示 detail */
function warningLine(wn: WeatherWarning): string {
  const head = wn.title || wn.level || '';
  const detail = wn.detail ?? '';
  return head && detail ? `🚨 ${head}: ${detail}` : `🚨 ${head || detail}`;
}

function weatherBlock(w: WeatherInfo): Block {
  let htmlLine = `${w.emoji} ${escapeHtml(w.description)} ${w.tempMin} ~ ${w.tempMax}°C`;
  if (w.tempNow !== undefined) htmlLine += `(当前 ${w.tempNow}°C)`;
  if (w.precipitationProb !== undefined) htmlLine += `| 降水概率 ${w.precipitationProb}%`;
  const htmlWarnings = w.warnings.map((wn) => {
    const head = escapeHtml(wn.title || wn.level || '');
    const detail = escapeHtml(wn.detail ?? '');
    return head && detail ? `🚨 ${head}: ${detail}` : `🚨 ${head || detail}`;
  });
  return {
    text: [`🌤 天气 · ${w.locationName}`, weatherLine(w), ...w.warnings.map(warningLine)],
    html: [`<b>🌤 天气 · ${escapeHtml(w.locationName)}</b>`, htmlLine, ...htmlWarnings],
  };
}

/* ---------------- 日程 ---------------- */

function eventLine(e: CalendarEvent): string {
  const time = e.end ? `${e.start}-${e.end}` : e.start;
  let line = `• ${time} ${e.title}`;
  if (e.location) line += ` @${e.location}`;
  if (e.teacher) line += ` / ${e.teacher}`;
  if (e.tag) line += ` · ${e.tag}`;
  return `${line}(${e.source})`; // 末尾括号注明来源,'日历' 也照写
}

function calendarBlock(events: CalendarEvent[]): Block {
  const title = `📅 今日日程 (${events.length})`;
  const html = [`<b>${title}</b>`];
  for (const e of events) {
    const time = e.end ? `${e.start}-${e.end}` : e.start;
    let line = `• ${escapeHtml(time)} ${escapeHtml(e.title)}`;
    if (e.location) line += ` @${escapeHtml(e.location)}`;
    if (e.teacher) line += ` / ${escapeHtml(e.teacher)}`;
    if (e.tag) line += ` · ${escapeHtml(e.tag)}`;
    html.push(`${line}(${escapeHtml(e.source)})`);
  }
  return { text: [title, ...events.map(eventLine)], html };
}

/* ---------------- 百度热搜 ---------------- */

function hotSearchBlock(items: HotSearchItem[]): Block {
  const title = `🔥 百度热搜 (${items.length})`;
  const text = [title];
  const html = [`<b>${title}</b>`];
  for (const it of items) {
    const flag = it.isNew ? '🆕 ' : '';
    text.push(`• ${it.rank}. ${flag}${it.word}`);
    // html 版把词条做成搜索链接,纯文本版保持简洁不带 URL
    const safeWord = escapeHtml(it.word);
    const wordHtml = it.url ? `<a href="${escapeHtml(it.url)}">${safeWord}</a>` : safeWord;
    html.push(`• ${it.rank}. ${flag}${wordHtml}`);
  }
  return { text, html };
}

/* ---------------- GitHub Releases ---------------- */

function releaseBlock(releases: GithubRelease[]): Block {
  const title = `🚀 GitHub 新 Release (${releases.length})`;
  const text = [title];
  const html = [`<b>${title}</b>`];
  for (const r of releases) {
    text.push(`• ${r.repo} ${r.tagName}`);
    if (r.summary) text.push(`  ${r.summary}`);
    text.push(`  ${r.url}`);
    html.push(`• ${escapeHtml(r.repo)} ${escapeHtml(r.tagName)}`);
    if (r.summary) html.push(`  ${escapeHtml(r.summary)}`);
    html.push(`  <a href="${escapeHtml(r.url)}">原文链接</a>`);
  }
  return { text, html };
}

/* ---------------- GitHub 高星新项目(discover) ---------------- */

function discoveryBlock(items: GithubDiscovery[]): Block {
  const title = `🚀 GitHub 高星新项目 (${items.length})`;
  const text = [title];
  const html = [`<b>${title}</b>`];
  for (const d of items) {
    const meta = [`⭐ ${d.stars}`, d.language ? `[${d.language}]` : '']
      .filter(Boolean)
      .join(' ');
    text.push(`• ${d.repo} ${meta}`);
    if (d.description) text.push(`  ${d.description}`);
    text.push(`  ${d.url}`);
    // html 版把仓库名做成链接
    const repoHtml = `<a href="${escapeHtml(d.url)}">${escapeHtml(d.repo)}</a>`;
    html.push(`• ${repoHtml} ${escapeHtml(meta)}`);
    if (d.description) html.push(`  ${escapeHtml(d.description)}`);
  }
  return { text, html };
}

/* ---------------- RSS ---------------- */

function rssBlock(items: RssItem[]): Block {
  const title = `🗞 订阅更新 (${items.length})`;
  const text = [title];
  const html = [`<b>${title}</b>`];
  for (const it of items) {
    text.push(`• [${it.feedTitle}] ${it.title}`);
    if (it.summary) text.push(`  ${it.summary}`);
    text.push(`  ${it.link}`);
    html.push(`• [${escapeHtml(it.feedTitle)}] ${escapeHtml(it.title)}`);
    if (it.summary) html.push(`  ${escapeHtml(it.summary)}`);
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
    const empty = '今天没有新内容,一切安好 🌿';
    blocks.push({ text: [empty], html: [empty] });
  }
  return {
    text: blocks.map((b) => b.text.join('\n')).join('\n\n'),
    html: blocks.map((b) => b.html.join('\n')).join('\n\n'),
  };
}
