/**
 * 报告图片渲染:ReportContext → PNG Buffer(失败一律返回 null,绝不抛异常)。
 *
 * 与文本版的关系:信息一致,不是像素一致。文本版用 "▌emoji" 排版,图片版用
 * 彩色竖条 + 圆角卡片呈现,更适合手机转发存档。
 *
 * 关键约束与设计:
 *  - @napi-rs/canvas 在 optionalDependencies 里,可能未安装 → 动态 require,
 *    加载失败直接返回 null,降级纯文本;
 *  - 中文字体必须自带:CI 的 Ubuntu runner 无中文字体,不注册会渲染成空白/豆腐块。
 *    三级回退:DIGEST_FONT_PATH → data/fonts/*.woff2 缓存 → CDN 下载并写缓存;
 *    三步全失败返回 null;
 *  - emoji 在无彩色 emoji 字体的 Linux 上会渲染成豆腐块,所以绘制到图上的文字
 *    统一剥离 emoji / 图形符号,改用主题色竖条、色块或文字标记([新]/星)区分;
 *  - 逐字符折行(CJK 无空格),长描述最多 2~3 行并以 … 截断;
 *  - 先测量所有卡片高度,再创建精确高度的画布,自动裁掉底部空白;
 *  - 单个卡片绘制失败只跳过该卡片,不影响整张图。
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  CalendarEvent,
  GithubDiscovery,
  GithubRelease,
  HotSearchItem,
  PersonalSection,
  ReportContext,
  ReportFailure,
  ReportKind,
  RssItem,
  WeatherInfo,
} from '../types';

/**
 * canvas 的最小结构类型(只声明本项目用到的成员)。
 *
 * 刻意不写 `typeof import('@napi-rs/canvas')`:该包在 optionalDependencies 里,
 * 装不上是**预期**情况(此时降级纯文本),但类型引用会让 tsc 直接报错、
 * 把"可选"变成"必须"。这里用局部接口把编译期与安装状态解耦。
 */
interface CanvasLike {
  getContext(type: '2d'): CanvasCtx;
  toBuffer(mime: 'image/png'): Buffer;
}

interface CanvasCtx {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textBaseline: string;
  shadowBlur: number;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  /** 较新的 canvas 才提供;调用处已做存在性兜底 */
  roundRect?(x: number, y: number, w: number, h: number, r: number): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

interface GlobalFontsLike {
  has(family: string): boolean;
  register(buf: Buffer, family?: string): boolean;
  registerFromPath(path: string, family?: string): boolean;
}

interface CanvasModule {
  createCanvas(width: number, height: number): CanvasLike;
  GlobalFonts: GlobalFontsLike;
}

/* ---------------- 常量 ---------------- */

const FONT_FAMILY = 'DigestSans';
const DEFAULT_WIDTH = 900;
const MIN_WIDTH = 420;
const MAX_WIDTH = 1600;

const PADDING = 32;
const GAP = 16;
const RADIUS = 12;
const CARD_PAD_X = 18;
const CARD_PAD_Y = 16;
const TITLE_BAR_W = 4;
const TITLE_BAR_GAP = 10;
const TITLE_LH = 27;
const TITLE_GAP = 10;
const HEADER_H = 120;
const FOOTER_LH = 20;

const CACHE_FONT = path.join('data', 'fonts', 'noto-sans-sc-400.woff2');
const FONT_URLS = [
  'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5/files/noto-sans-sc-chinese-simplified-400-normal.woff2',
  'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.0.18/files/noto-sans-sc-chinese-simplified-400-normal.woff2',
];
const FONT_TIMEOUT_MS = 30_000;

const COLORS = {
  bg: '#f6f7f9',
  card: '#ffffff',
  border: '#e6e8eb',
  text: '#1f2328',
  muted: '#6b7280',
  faint: '#9ca3af',
};
const CARD_SHADOW = 'rgba(15, 23, 42, 0.06)';

const THEME: Record<ReportKind, string> = {
  morning: '#f59e0b',
  evening: '#3b5bdb',
  quick: '#0ca678',
};
const THEME_NAME: Record<ReportKind, string> = {
  morning: '早报',
  evening: '晚报',
  quick: '快报',
};

/** 文本样式表:字体 + 行高(measure 与 draw 共用,保证高度一致) */
const STYLE = {
  h1: { font: `30px ${FONT_FAMILY}`, lh: 42 },
  h2: { font: `17px ${FONT_FAMILY}`, lh: 26 },
  title: { font: `19px ${FONT_FAMILY}`, lh: TITLE_LH },
  body: { font: `16px ${FONT_FAMILY}`, lh: 25 },
  muted: { font: `14px ${FONT_FAMILY}`, lh: 22 },
  url: { font: `13px ${FONT_FAMILY}`, lh: 19 },
  footer: { font: `13px ${FONT_FAMILY}`, lh: FOOTER_LH },
} as const;
type StyleKey = keyof typeof STYLE;

/* ---------------- 惰性加载 canvas ---------------- */

let canvasMod: CanvasModule | null | undefined;
function getCanvas(): CanvasModule | null {
  if (canvasMod !== undefined) return canvasMod;
  try {
    // 运行时动态加载:可选依赖,未安装时 catch 后返回 null
    canvasMod = require('@napi-rs/canvas') as CanvasModule;
  } catch {
    canvasMod = null;
  }
  return canvasMod;
}

/* ---------------- 字体三级回退 ---------------- */

let fontReady: boolean | undefined;

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** 第一级:DIGEST_FONT_PATH;第二级:data/fonts 缓存(优先 noto-sans-sc-400.woff2) */
function findLocalFont(): string | null {
  const envPath = process.env.DIGEST_FONT_PATH?.trim();
  if (envPath && isFile(envPath)) return envPath;

  const preferred = path.resolve(CACHE_FONT);
  if (isFile(preferred)) return preferred;
  try {
    const dir = path.dirname(preferred);
    const files = fs.readdirSync(dir);
    const hit =
      files.find((f) => f.toLowerCase() === path.basename(preferred)) ??
      files.find((f) => /\.(woff2?|ttf|otf)$/i.test(f));
    if (hit) return path.join(dir, hit);
  } catch {
    /* 目录不存在等:继续下一级 */
  }
  return null;
}

/** 第三级:CDN 候选依次尝试下载,写入本地缓存;返回字体二进制 */
async function downloadFont(): Promise<Buffer | null> {
  for (const url of FONT_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FONT_TIMEOUT_MS) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) continue;
      try {
        const target = path.resolve(CACHE_FONT);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, buf);
      } catch {
        /* 缓存写入失败也仍可从内存注册 */
      }
      return buf;
    } catch {
      /* 换下一个候选 */
    }
  }
  return null;
}

/** 注册字体(全局一次)。返回是否可以按 FONT_FAMILY 正常排版 */
async function ensureFont(mod: CanvasModule): Promise<boolean> {
  if (fontReady !== undefined) return fontReady;
  try {
    if (mod.GlobalFonts.has(FONT_FAMILY)) {
      fontReady = true;
      return true;
    }
    const local = findLocalFont();
    if (local) {
      try {
        if (mod.GlobalFonts.registerFromPath(local, FONT_FAMILY)) {
          fontReady = true;
          return true;
        }
      } catch {
        /* 落到 buffer 注册 */
      }
      try {
        const buf = fs.readFileSync(local);
        if (mod.GlobalFonts.register(buf, FONT_FAMILY)) {
          fontReady = true;
          return true;
        }
      } catch {
        /* 继续下载 */
      }
    }
    const downloaded = await downloadFont();
    if (downloaded && mod.GlobalFonts.register(downloaded, FONT_FAMILY)) {
      fontReady = true;
      return true;
    }
    fontReady = false;
    return false;
  } catch {
    fontReady = false;
    return false;
  }
}

/* ---------------- 文本清洗:剥离 emoji / 图形符号 ---------------- */

const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{FE0F}\u{200D}\u{20E3}]/gu;

/** 剥离 emoji、折叠空白;空/undefined 安全返回 '' */
function clean(input: string | undefined | null): string {
  if (input === undefined || input === null) return '';
  return String(input).replace(EMOJI_RE, '').replace(/\s+/g, ' ').trim();
}

/* ---------------- 折行工具 ---------------- */

/** CJK / 全角符号按字符断行;拉丁字母数字等尽量整词不切断 */
const CJK_CHAR = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/;
/** 视为"词内可含"的 URL 常用符号 */
const WORD_PUNCT = /[.:/_?&=#%~+@-]/;

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let word = '';
  const flush = (): void => {
    if (word) {
      tokens.push(word);
      word = '';
    }
  };
  for (const ch of text) {
    if (/\s/.test(ch)) {
      flush();
      tokens.push(' ');
    } else if (CJK_CHAR.test(ch)) {
      flush();
      tokens.push(ch);
    } else if (/[A-Za-z0-9]/.test(ch)) {
      word += ch;
    } else if (word && WORD_PUNCT.test(ch)) {
      word += ch;
    } else {
      flush();
      tokens.push(ch);
    }
  }
  flush();
  return tokens;
}

function measureText(m: CanvasCtx, font: string, text: string): number {
  m.font = font;
  return m.measureText(text).width;
}

/** 超长不可断词(如长 URL)按字符硬切 */
function hardBreak(m: CanvasCtx, font: string, token: string, maxWidth: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of token) {
    if (cur && measureText(m, font, cur + ch) > maxWidth) {
      out.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out.length > 0 ? out : [''];
}

/** 通用折行:逐 token 累加宽度,超过 maxWidth 换行 */
function wrapText(m: CanvasCtx, font: string, text: string, maxWidth: number): string[] {
  if (!text) return [];
  if (maxWidth <= 0) return [text];
  const lines: string[] = [];
  let line = '';
  let pendingSpace = false;

  for (const tok of tokenize(text)) {
    if (tok === ' ') {
      if (line) pendingSpace = true;
      continue;
    }
    if (line === '') {
      if (measureText(m, font, tok) > maxWidth) {
        const parts = hardBreak(m, font, tok, maxWidth);
        for (let i = 0; i < parts.length - 1; i++) lines.push(parts[i]);
        line = parts[parts.length - 1];
      } else {
        line = tok;
      }
      pendingSpace = false;
      continue;
    }
    const candidate = pendingSpace ? `${line} ${tok}` : line + tok;
    if (measureText(m, font, candidate) <= maxWidth) {
      line = candidate;
      pendingSpace = false;
    } else {
      lines.push(line);
      if (measureText(m, font, tok) > maxWidth) {
        const parts = hardBreak(m, font, tok, maxWidth);
        for (let i = 0; i < parts.length - 1; i++) lines.push(parts[i]);
        line = parts[parts.length - 1];
      } else {
        line = tok;
      }
      pendingSpace = false;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** 单行截断:超出 maxWidth 用 … 结尾 */
function truncate(m: CanvasCtx, font: string, text: string, maxWidth: number): string {
  if (!text || maxWidth <= 0) return text;
  if (measureText(m, font, text) <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && measureText(m, font, `${s}…`) > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

/** 限制行数:超出保留前 maxLines 行,末行以 … 截断 */
function clampLines(
  m: CanvasCtx,
  font: string,
  lines: string[],
  maxWidth: number,
  maxLines?: number,
): string[] {
  if (!maxLines || lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[kept.length - 1];
  kept[kept.length - 1] = truncate(m, font, last, maxWidth);
  return kept;
}

/* ---------------- 卡片模型 ---------------- */

interface LineSpec {
  text: string;
  style?: StyleKey;
  color?: string;
  indent?: number;
  maxLines?: number;
}

interface CardSpec {
  title?: string;
  accent: string;
  bg?: string;
  border?: string;
  titleColor?: string;
  lines: LineSpec[];
}

interface Row {
  text: string;
  font: string;
  color: string;
  lh: number;
  indent: number;
}

interface Card {
  height: number;
  draw: (c: CanvasCtx, x: number, y: number, w: number) => void;
}

function roundRectPath(c: CanvasCtx, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  if (typeof c.roundRect === 'function') {
    c.roundRect(x, y, w, h, r);
  } else {
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
}

/** 依据 spec 测量高度并生成绘制闭包;测量与绘制使用同一批已折行文本 */
function buildCard(m: CanvasCtx, spec: CardSpec, contentWidth: number): Card {
  const innerW = Math.max(40, contentWidth - CARD_PAD_X * 2);
  const titleText = spec.title
    ? truncate(m, STYLE.title.font, clean(spec.title), innerW - TITLE_BAR_W - TITLE_BAR_GAP)
    : '';
  const rows: Row[] = [];

  for (const line of spec.lines) {
    const text = clean(line.text);
    if (!text) continue;
    const key: StyleKey = line.style ?? 'body';
    const st = STYLE[key];
    const indent = line.indent ?? 0;
    const avail = innerW - indent;
    if (avail <= 8) continue;
    const wrapped = clampLines(m, st.font, wrapText(m, st.font, text, avail), avail, line.maxLines);
    for (const w of wrapped) {
      rows.push({ text: w, font: st.font, color: line.color ?? COLORS.text, lh: st.lh, indent });
    }
  }

  const hasTitle = titleText !== '';
  const hasRows = rows.length > 0;
  const height =
    CARD_PAD_Y * 2 +
    (hasTitle ? TITLE_LH : 0) +
    (hasTitle && hasRows ? TITLE_GAP : 0) +
    rows.reduce((sum, r) => sum + r.lh, 0);

  const bg = spec.bg ?? COLORS.card;
  const border = spec.border ?? COLORS.border;
  const titleColor = spec.titleColor ?? COLORS.text;

  const draw = (c: CanvasCtx, x: number, y: number, w: number): void => {
    c.save();
    c.shadowColor = CARD_SHADOW;
    c.shadowBlur = 6;
    c.shadowOffsetX = 0;
    c.shadowOffsetY = 1;
    roundRectPath(c, x, y, w, height, RADIUS);
    c.fillStyle = bg;
    c.fill();
    c.restore();

    roundRectPath(c, x + 0.5, y + 0.5, w - 1, height - 1, RADIUS);
    c.strokeStyle = border;
    c.lineWidth = 1;
    c.stroke();

    c.textBaseline = 'middle';
    let cursor = y + CARD_PAD_Y;
    if (hasTitle) {
      const barTop = cursor + TITLE_LH / 2 - 9;
      c.fillStyle = spec.accent;
      roundRectPath(c, x + CARD_PAD_X, barTop, TITLE_BAR_W, 18, 2);
      c.fill();
      c.fillStyle = titleColor;
      c.font = STYLE.title.font;
      c.fillText(titleText, x + CARD_PAD_X + TITLE_BAR_W + TITLE_BAR_GAP, cursor + TITLE_LH / 2);
      cursor += TITLE_LH;
      if (hasRows) cursor += TITLE_GAP;
    }
    for (const r of rows) {
      c.fillStyle = r.color;
      c.font = r.font;
      c.fillText(r.text, x + CARD_PAD_X + r.indent, cursor + r.lh / 2);
      cursor += r.lh;
    }
  };

  return { height, draw };
}

/* ---------------- 头部(整块主题色,白字) ---------------- */

function buildHeader(ctx: ReportContext, width: number): Card {
  const theme = THEME[ctx.reportKind] ?? THEME.morning;
  const name = THEME_NAME[ctx.reportKind] ?? '早报';
  const line1 = clean(`${name} · ${ctx.dateLabel} ${ctx.timeLabel}`);
  const line2 = clean(`${ctx.greeting}！`);

  const draw = (c: CanvasCtx, _x: number, y: number, w: number): void => {
    c.fillStyle = theme;
    c.fillRect(0, y, w, HEADER_H);
    c.textBaseline = 'middle';
    c.fillStyle = '#ffffff';
    c.font = STYLE.h1.font;
    c.fillText(truncate(c, STYLE.h1.font, line1, w - PADDING * 2), PADDING, y + 24 + STYLE.h1.lh / 2);
    c.fillStyle = 'rgba(255, 255, 255, 0.92)';
    c.font = STYLE.h2.font;
    c.fillText(
      truncate(c, STYLE.h2.font, line2, w - PADDING * 2),
      PADDING,
      y + 24 + STYLE.h1.lh + 6 + STYLE.h2.lh / 2,
    );
  };
  return { height: HEADER_H, draw };
}

/* ---------------- 各内容卡片 ---------------- */

function fmtStars(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n)}`;
}

/** 热搜热度值紧凑格式:1226970 → 122.7万,8600 → 8600 */
function fmtHeat(n: number): string {
  if (n >= 10_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, '')}万`;
  return `${Math.round(n)}`;
}

function buildFailureCard(m: CanvasCtx, failures: ReportFailure[], contentW: number): Card {
  return buildCard(
    m,
    {
      title: `模块故障 · ${failures.length} 条`,
      accent: '#e03131',
      bg: '#fff5f5',
      border: '#ffc9c9',
      titleColor: '#c92a2a',
      lines: failures.map((f) => ({
        text: `• ${clean(f.module)}：${clean(f.message)}`,
        style: 'body' as StyleKey,
        color: '#c92a2a',
        maxLines: 2,
      })),
    },
    contentW,
  );
}

function buildWeatherCard(m: CanvasCtx, w: WeatherInfo, theme: string, contentW: number): Card {
  const lines: LineSpec[] = [];
  const desc = clean(w.description);
  let main = `${desc} ｜ ${Math.round(w.tempMin)} ~ ${Math.round(w.tempMax)}°C`;
  if (w.tempNow !== undefined) main += `（当前 ${w.tempNow}°C）`;
  lines.push({ text: main, style: 'body', maxLines: 2 });
  // 增强信息用 muted 小一号:空气/降水/日出日落/穿衣,逐行只在有数据时出现
  const muted = (text: string): LineSpec => ({
    text,
    style: 'muted',
    color: COLORS.muted,
    maxLines: 2,
  });
  if (w.air) {
    const pm = w.air.pm10 !== undefined
      ? `PM2.5 ${w.air.pm25} · PM10 ${w.air.pm10}`
      : `PM2.5 ${w.air.pm25}`;
    lines.push(muted(`空气 ${w.air.level}（${pm}）`));
  }
  if (w.rainWindows && w.rainWindows.length > 0) {
    const parts = w.rainWindows
      .slice(0, 2)
      .map((r) => `${r.start}~${r.end} 最高 ${r.maxProb}%`);
    lines.push(muted(`有雨时段:${parts.join('、')}`));
  } else if (w.precipitationProb !== undefined) {
    lines.push(muted(`降水概率 ${w.precipitationProb}%`));
  }
  const sun: string[] = [];
  if (w.sunrise) sun.push(`日出 ${w.sunrise}`);
  if (w.sunset) sun.push(`日落 ${w.sunset}`);
  if (w.uvIndexMax !== undefined) sun.push(`紫外线 ${w.uvIndexMax}`);
  if (sun.length > 0) lines.push(muted(sun.join(' · ')));
  if (w.dressAdvice) lines.push(muted(w.dressAdvice));
  for (const wn of w.warnings ?? []) {
    const head = clean(wn.title || wn.level);
    const detail = clean(wn.detail);
    const text = head && detail ? `• ${head}：${detail}` : `• ${head || detail}`;
    if (clean(text) === '•') continue;
    lines.push({ text, style: 'body', color: '#c92a2a', maxLines: 2 });
  }
  return buildCard(m, { title: `天气 · ${clean(w.locationName)}`, accent: theme, lines }, contentW);
}

function eventLine(e: CalendarEvent): string {
  const time = e.end ? `${e.start}-${e.end}` : e.start;
  let line = `• ${clean(time)} ${clean(e.title)}`;
  if (e.location) line += ` @${clean(e.location)}`;
  if (e.teacher) line += ` / ${clean(e.teacher)}`;
  if (e.tag) line += ` · ${clean(e.tag)}`;
  if (e.source) line += `（${clean(e.source)}）`;
  return line;
}

function buildCalendarCard(m: CanvasCtx, events: CalendarEvent[], theme: string, contentW: number): Card {
  return buildCard(
    m,
    {
      title: `今日日程 · ${events.length} 条`,
      accent: theme,
      lines: events.map((e) => ({ text: eventLine(e), style: 'body' as StyleKey, maxLines: 2 })),
    },
    contentW,
  );
}

function buildHotCard(m: CanvasCtx, items: HotSearchItem[], theme: string, contentW: number): Card {
  return buildCard(
    m,
    {
      title: `百度热搜 · ${items.length} 条`,
      accent: theme,
      lines: items.map((it) => ({
        text: `${it.rank}. ${it.isNew ? '[新] ' : ''}${clean(it.word)}`,
        style: 'body' as StyleKey,
        maxLines: 2,
      })),
    },
    contentW,
  );
}

function buildBiliHotCard(m: CanvasCtx, items: HotSearchItem[], theme: string, contentW: number): Card {
  return buildCard(
    m,
    {
      title: `B 站热搜 · ${items.length} 条`,
      accent: theme,
      lines: items.map((it) => {
        const heat = it.heat !== undefined ? `  ${fmtHeat(it.heat)}` : '';
        return {
          text: `${it.rank}. ${it.isNew ? '[新] ' : ''}${clean(it.word)}${heat}`,
          style: 'body' as StyleKey,
          maxLines: 2,
        };
      }),
    },
    contentW,
  );
}

function buildPersonalCard(m: CanvasCtx, p: PersonalSection, theme: string, contentW: number): Card {
  const lines: LineSpec[] = [];
  for (const a of p.anniversaries) {
    const when = a.daysLeft === 0 ? '就是今天' : `还有 ${a.daysLeft} 天`;
    const years = a.years !== undefined ? ` · ${a.years} 周年` : '';
    lines.push({ text: `${clean(a.name)} ${when}（${a.nextDate}${years}）`, style: 'body', maxLines: 1 });
  }
  for (const c of p.certs) {
    const when = c.daysLeft < 0
      ? `已过期 ${-c.daysLeft} 天`
      : c.daysLeft === 0 ? '今天到期' : `还有 ${c.daysLeft} 天到期`;
    lines.push({ text: `${clean(c.name)} 证书${when}（${c.validTo}）`, style: 'body', color: '#c92a2a', maxLines: 1 });
  }
  const count = p.anniversaries.length + p.certs.length;
  return buildCard(m, { title: `提醒 · ${count} 条`, accent: theme, lines }, contentW);
}

function buildReleaseCard(m: CanvasCtx, releases: GithubRelease[], theme: string, contentW: number): Card {
  const lines: LineSpec[] = [];
  for (const r of releases) {
    lines.push({ text: `• ${clean(r.repo)} ${clean(r.tagName)}`, style: 'body', maxLines: 1 });
    if (r.summary) {
      lines.push({ text: clean(r.summary), style: 'muted', color: COLORS.muted, indent: 14, maxLines: 2 });
    }
    if (r.url) {
      lines.push({ text: clean(r.url), style: 'url', color: COLORS.faint, indent: 14, maxLines: 1 });
    }
  }
  return buildCard(m, { title: `GitHub 新 Release · ${releases.length} 条`, accent: theme, lines }, contentW);
}

function buildDiscoveryCard(m: CanvasCtx, items: GithubDiscovery[], theme: string, contentW: number): Card {
  const lines: LineSpec[] = [];
  items.forEach((d, i) => {
    // 序号 + 仓库名 + 星数/语言合并成一行:比拆两行更紧凑,同时给介绍留出视觉权重
    const meta = `星 ${fmtStars(d.stars)}${d.language ? ` · ${clean(d.language)}` : ''}`;
    lines.push({ text: `${i + 1}. ${clean(d.repo)}   ${meta}`, style: 'body', maxLines: 1 });
    // 活跃度:提交/issue/得分。取不到数据时整行省略,不让图片出现"提交 0"的假象
    const act = [
      d.commits !== undefined ? `提交 ${d.commits}` : '',
      d.issues !== undefined ? `issue ${d.issues}` : '',
      d.score !== undefined ? `得分 ${d.score.toFixed(1)}` : '',
    ].filter(Boolean);
    if (act.length > 0) {
      lines.push({ text: act.join(' · '), style: 'muted', color: COLORS.muted, indent: 14, maxLines: 1 });
    }
    // 单句介绍:固定一行,超长截断(数据层已取首句并限长)
    if (d.description) {
      lines.push({ text: clean(d.description), style: 'muted', color: COLORS.muted, indent: 14, maxLines: 1 });
    }
    if (d.url) {
      lines.push({ text: clean(d.url), style: 'url', color: COLORS.faint, indent: 14, maxLines: 1 });
    }
  });
  return buildCard(
    m,
    { title: `GitHub 新项目榜 · ${items.length} 条`, accent: theme, lines },
    contentW,
  );
}

function buildRssCard(m: CanvasCtx, items: RssItem[], theme: string, contentW: number): Card {
  const lines: LineSpec[] = [];
  for (const it of items) {
    lines.push({ text: `• [${clean(it.feedTitle)}] ${clean(it.title)}`, style: 'body', maxLines: 2 });
    if (it.summary) {
      lines.push({ text: clean(it.summary), style: 'muted', color: COLORS.muted, indent: 14, maxLines: 2 });
    }
    if (it.link) {
      lines.push({ text: clean(it.link), style: 'url', color: COLORS.faint, indent: 14, maxLines: 1 });
    }
  }
  return buildCard(m, { title: `订阅更新 · ${items.length} 条`, accent: theme, lines }, contentW);
}

function buildEmptyCard(m: CanvasCtx, theme: string, contentW: number): Card {
  return buildCard(
    m,
    {
      accent: theme,
      lines: [{ text: '今天没有新内容，一切安好', style: 'body', color: COLORS.muted, maxLines: 1 }],
    },
    contentW,
  );
}

/* ---------------- 主流程 ---------------- */

function normalizeWidth(input?: number): number {
  const n = typeof input === 'number' && Number.isFinite(input) ? Math.round(input) : DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n || DEFAULT_WIDTH));
}

function disabledByEnv(): boolean {
  const v = process.env.DIGEST_DISABLE_IMAGE;
  if (!v) return false;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

export async function renderReportImage(
  ctx: ReportContext,
  opts?: { width?: number },
): Promise<Buffer | null> {
  try {
    if (disabledByEnv()) return null;
    const mod = getCanvas();
    if (!mod) return null;
    if (!(await ensureFont(mod))) return null;
    return renderSync(mod, ctx, normalizeWidth(opts?.width));
  } catch {
    return null;
  }
}

function renderSync(mod: CanvasModule, ctx: ReportContext, width: number): Buffer | null {
  try {
    const contentW = width - PADDING * 2;
    const theme = THEME[ctx.reportKind] ?? THEME.morning;
    const probe = mod.createCanvas(Math.max(16, width), 40).getContext('2d');

    const cards: Card[] = [];
    const add = (make: () => Card): void => {
      try {
        const card = make();
        if (card && card.height > 2) cards.push(card);
      } catch {
        /* 单卡片测量失败:跳过,不影响整张图 */
      }
    };

    const failures = ctx.failures ?? [];
    if (failures.length > 0) add(() => buildFailureCard(probe, failures, contentW));
    if (ctx.weather) add(() => buildWeatherCard(probe, ctx.weather as WeatherInfo, theme, contentW));
    if (ctx.calendar?.length) add(() => buildCalendarCard(probe, ctx.calendar, theme, contentW));
    if (ctx.hotItems?.length) add(() => buildHotCard(probe, ctx.hotItems, theme, contentW));
    if (ctx.biliHot?.length) add(() => buildBiliHotCard(probe, ctx.biliHot, theme, contentW));
    if (ctx.personal && (ctx.personal.anniversaries.length > 0 || ctx.personal.certs.length > 0)) {
      add(() => buildPersonalCard(probe, ctx.personal, theme, contentW));
    }
    if (ctx.releases?.length) add(() => buildReleaseCard(probe, ctx.releases, theme, contentW));
    if (ctx.discoveries?.length) add(() => buildDiscoveryCard(probe, ctx.discoveries, theme, contentW));
    if (ctx.rss?.length) add(() => buildRssCard(probe, ctx.rss, theme, contentW));
    if (cards.length === 0) add(() => buildEmptyCard(probe, theme, contentW));

    const header = buildHeader(ctx, width);

    let y = header.height;
    const placed: { card: Card; y: number }[] = [];
    for (const card of cards) {
      y += GAP;
      placed.push({ card, y });
      y += card.height;
    }
    y += GAP;
    const footerY = y;
    y += FOOTER_LH;
    const totalH = Math.max(220, Math.ceil(y + PADDING));

    const canvas = mod.createCanvas(width, totalH);
    const c = canvas.getContext('2d');
    c.textBaseline = 'middle';
    c.fillStyle = COLORS.bg;
    c.fillRect(0, 0, width, totalH);

    try {
      header.draw(c, 0, 0, width);
    } catch {
      /* 头部失败仍继续画卡片 */
    }
    for (const p of placed) {
      try {
        p.card.draw(c, PADDING, p.y, contentW);
      } catch {
        /* 单卡片绘制失败:跳过 */
      }
    }
    try {
      c.textBaseline = 'middle';
      c.fillStyle = COLORS.faint;
      c.font = STYLE.footer.font;
      const label = clean(`生成时间 ${ctx.dateLabel} ${ctx.timeLabel}`);
      c.fillText(label, width / 2 - c.measureText(label).width / 2, footerY + FOOTER_LH / 2);
    } catch {
      /* 页脚可失败 */
    }

    return canvas.toBuffer('image/png');
  } catch {
    return null;
  }
}
