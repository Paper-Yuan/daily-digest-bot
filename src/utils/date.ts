/**
 * 时区工具。
 *
 * GitHub Actions 的 runner 跑在 UTC,直接用 Date 会把"今天"算错一天。
 * 所有"今天/周几/第几周"的判断都通过 IANA 时区名(如 Asia/Shanghai)换算,
 * 让定时任务无论在哪台机器上跑,日期语义都与用户一致。
 */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0=周日,1=周一 ... 6=周六 */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const ZH_WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

/** 把 Date 拆到指定时区的年月日时分秒与周几 */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = getFormatter(timeZone).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // 某些 ICU 版本会用 '24' 表示午夜
  const hourRaw = get('hour');
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: hourRaw === '24' ? 0 : Number(hourRaw),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

/** date 在 timeZone 下与 (y, m, d) 是否同一天 */
export function isSameZonedDay(
  date: Date,
  y: number,
  m: number,
  d: number,
  timeZone: string,
): boolean {
  const p = zonedParts(date, timeZone);
  return p.year === y && p.month === m && p.day === d;
}

function tzOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/** 指定时区下 y-m-d 那天 00:00 对应的 UTC 时刻(两次迭代消除 DST 误差) */
export function zonedDayStart(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day);
  let ts = utcGuess - tzOffsetMs(new Date(utcGuess), timeZone);
  ts = utcGuess - tzOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

export function zhWeekday(weekday: number): string {
  return ZH_WEEKDAYS[weekday] ?? '';
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 解析 'YYYY-MM-DD',失败返回 null */
export function parseYmd(
  s: string,
): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** 当前是学期第几周(semesterStart 为第 1 周周一);早于开学返回 <=0 */
export function currentWeek(
  semesterStart: { year: number; month: number; day: number },
  now: Date,
  timeZone: string,
): number {
  const start = zonedDayStart(semesterStart.year, semesterStart.month, semesterStart.day, timeZone).getTime();
  const p = zonedParts(now, timeZone);
  const today = zonedDayStart(p.year, p.month, p.day, timeZone).getTime();
  return Math.floor((today - start) / 86_400_000 / 7) + 1;
}

/** 周次表达式匹配:"1-16" / "1,3,5-8";空/undefined 表示每周都命中 */
export function weekRangeMatch(range: string | undefined, week: number): boolean {
  if (!range || !range.trim()) return true;
  for (const part of range.split(',')) {
    const seg = part.trim();
    if (!seg) continue;
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(seg);
    if (!m) continue;
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (week >= from && week <= to) return true;
  }
  return false;
}

/** 指定时区下的 'HH:mm' */
export function zonedTimeLabel(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}
