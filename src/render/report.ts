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
  PersonalSection,
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

/** 热搜热度值紧凑格式:1226970 → 122.7万,8600 → 8600 */
function fmtHeat(n: number): string {
  if (n >= 10_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, '')}万`;
  return `${Math.round(n)}`;
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

/**
 * 天气增强行的组装:空气质量 / 日出日落 / 紫外线 / 降水时段 / 穿衣建议。
 * 返回行数组,文本版与 html 版共用(它们内容一致,只是 html 需要转义)。
 * 每项都只在有数据时出现 —— 取不到就不显示,不留空占位。
 */
function weatherExtraLines(w: WeatherInfo): string[] {
  const lines: string[] = [];
  if (w.air) {
    const pm = w.air.pm10 !== undefined
      ? `PM2.5 ${w.air.pm25} · PM10 ${w.air.pm10}`
      : `PM2.5 ${w.air.pm25}`;
    lines.push(`😷 空气 ${w.air.level}（${pm}）`);
  }
  if (w.rainWindows && w.rainWindows.length > 0) {
    // 只列前两段,避免雨天时段太多把报告撑长
    const parts = w.rainWindows
      .slice(0, 2)
      .map((r) => `${r.start}~${r.end} 最高 ${r.maxProb}%`);
    lines.push(`🌧 有雨时段:${parts.join('、')}`);
  } else if (w.precipitationProb !== undefined) {
    // 没有逐小时数据时退回原来的概率展示
    lines.push(`💧 降水概率 ${w.precipitationProb}%`);
  }
  const sun: string[] = [];
  if (w.sunrise) sun.push(`日出 ${w.sunrise}`);
  if (w.sunset) sun.push(`日落 ${w.sunset}`);
  if (w.uvIndexMax !== undefined) sun.push(`紫外线 ${w.uvIndexMax}`);
  if (sun.length > 0) lines.push(`🌅 ${sun.join(' · ')}`);
  if (w.dressAdvice) lines.push(`👕 ${w.dressAdvice}`);
  return lines;
}

function weatherBlock(w: WeatherInfo): Block {
  const text = [`▌🌤 天气 · ${w.locationName}`, weatherLine(w)];
  const html = [`<b>🌤 天气 · ${escapeHtml(w.locationName)}</b>`, escapeHtml(weatherLine(w))];
  for (const line of weatherExtraLines(w)) {
    text.push(line);
    html.push(escapeHtml(line));
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

/* ---------------- B 站热搜 ---------------- */

function biliHotBlock(items: HotSearchItem[]): Block {
  const title = textTitle('📺', 'B 站热搜', items.length);
  const text = [title];
  const html = [`<b>📺 B 站热搜 · ${items.length} 条</b>`];
  for (const it of items) {
    const flag = it.isNew ? '🆕 ' : '';
    // 热度值用 k 压缩(1226970 -> 122.7万 太长,统一 w 单位)
    const heat = it.heat !== undefined ? `  🔥${fmtHeat(it.heat)}` : '';
    text.push(`${it.rank}. ${flag}${it.word}${heat}`);
    const safeWord = escapeHtml(it.word);
    html.push(`${it.rank}. ${flag}${safeWord}${escapeHtml(heat)}`);
  }
  return { text, html };
}

/* ---------------- 个人提醒(纪念日 / 证书) ---------------- */

function personalBlock(p: PersonalSection): Block {
  const count = p.anniversaries.length + p.certs.length;
  const title = textTitle('🎯', '提醒', count);
  const text = [title];
  const html = [`<b>🎯 提醒 · ${count} 条</b>`];
  for (const a of p.anniversaries) {
    const when = a.daysLeft === 0 ? '就是今天' : `还有 ${a.daysLeft} 天`;
    const years = a.years !== undefined ? ` · ${a.years} 周年` : '';
    text.push(`🎂 ${a.name} ${when}（${a.nextDate}${years}）`);
    html.push(`🎂 ${escapeHtml(a.name)} ${escapeHtml(when)}（${escapeHtml(a.nextDate + years)}）`);
  }
  for (const c of p.certs) {
    const when = c.daysLeft < 0
      ? `已过期 ${-c.daysLeft} 天`
      : c.daysLeft === 0 ? '今天到期' : `还有 ${c.daysLeft} 天到期`;
    text.push(`🔒 ${c.name} 证书${when}（${c.validTo}）`);
    html.push(`🔒 ${escapeHtml(c.name)} 证书${escapeHtml(when)}（${escapeHtml(c.validTo)}）`);
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

/* ---------------- GitHub 新项目榜(discover) ---------------- */

/** 活跃度行:只有拿到数据的项才出现,没配 token/接口失败时整行省略 */
function activityLine(d: GithubDiscovery): string | undefined {
  const parts = [
    d.commits !== undefined ? `提交 ${d.commits}` : '',
    d.issues !== undefined ? `issue ${d.issues}` : '',
    d.score !== undefined ? `得分 ${d.score.toFixed(1)}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function discoveryBlock(items: GithubDiscovery[]): Block {
  // 榜首即是打分最高的项目,带序号才读得出"这是榜单"
  const title = textTitle('🚀', 'GitHub 新项目榜', items.length);
  const text = [title];
  const html = [`<b>🚀 GitHub 新项目榜 · ${items.length} 条</b>`];
  items.forEach((d, i) => {
    const meta = `⭐ ${fmtStars(d.stars)}${d.language ? ` · ${d.language}` : ''}`;
    const rank = `${i + 1}.`;
    text.push(`${rank} ${d.repo}  ${meta}`);
    // html 版把仓库名做成链接(文本版下一行单独给出 URL,便于复制)
    const repoHtml = `<a href="${escapeHtml(d.url)}">${escapeHtml(d.repo)}</a>`;
    html.push(`${rank} ${repoHtml} ${escapeHtml(meta)}`);
    const act = activityLine(d);
    if (act) {
      text.push(`  ${act}`);
      html.push(escapeHtml(act));
    }
    if (d.description) {
      text.push(`  ${d.description}`);
      html.push(`<blockquote>${escapeHtml(d.description)}</blockquote>`);
    }
    text.push(`  ${d.url}`);
  });
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
  if (ctx.biliHot.length > 0) blocks.push(biliHotBlock(ctx.biliHot));
  if (ctx.personal.anniversaries.length > 0 || ctx.personal.certs.length > 0) {
    blocks.push(personalBlock(ctx.personal));
  }
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
