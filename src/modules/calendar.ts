/**
 * 日历/课表模块:ICS 订阅源 + 本地课表(周次过滤)。
 *
 * 失败约定:单个 ICS 源失败只记 warnings 继续跑下一个;重复事件(RRULE)
 * 展开失败单独降级为仅收非重复事件;全部配置源都失败且没有任何事件时才
 * 整体 ok:false。
 */

import * as ical from 'node-ical';
import { httpGetText } from '../utils/http';
import {
  currentWeek,
  isSameZonedDay,
  pad2,
  parseYmd,
  weekRangeMatch,
  zonedDayStart,
  zonedParts,
  zonedTimeLabel,
} from '../utils/date';
import type {
  CalendarEvent,
  CalendarSection,
  FetchContext,
  IcsSource,
  ModuleResult,
} from '../types';

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 目标时区下的日期串 'YYYY-MM-DD',用于 exdate 比对 */
function dayKey(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/**
 * 收集 exdate 里被排除的日期。node-ical 的 exdate 结构不规整(键是 UTC ISO
 * 日期串、值是 Date),不能直接用键比对——UTC 键在正偏移时区下会比"本地日"
 * 错一天导致误删,所以统一取值再换算到目标时区的日期。
 */
function exdateDays(exdate: unknown, tz: string): Set<string> {
  const days = new Set<string>();
  const collect = (val: unknown) => {
    if (val instanceof Date) days.add(dayKey(val, tz));
  };
  if (exdate instanceof Date) {
    collect(exdate);
  } else if (exdate && typeof exdate === 'object') {
    for (const val of Object.values(exdate as Record<string, unknown>)) collect(val);
  }
  return days;
}

/**
 * 校正 rrule.js 的时间帧怪癖:node-ical 交给 rrule 的 dtstart 与 between
 * 返回的时刻都带"伪 UTC"帧,不同 DTSTART 形态(Z 绝对时间 / 浮动 / TZID)
 * 的锚点还不一致(实测 UTC+8 机器上 Z 形态整体 +8h,浮动/TZID 锚在 UTC 墙钟)。
 * 校正策略(三种形态实测均恢复正确):发生日期取 between 结果的 UTC 日期分量,
 * 时刻取原始 DTSTART 的本机本地时分,按本机本地时间重新构造真实时刻。
 * 已知限制:跨时区 TZID 的重复事件展示时刻为近似值(rrule.js 上游限制)。
 */
function correctOccurrence(occ: Date, originStart: Date): Date {
  return new Date(
    occ.getUTCFullYear(),
    occ.getUTCMonth(),
    occ.getUTCDate(),
    originStart.getHours(),
    originStart.getMinutes(),
    originStart.getSeconds(),
  );
}

/** "今天"的时间窗与年月日快照 */
interface DayWindow {
  tz: string;
  year: number;
  month: number;
  day: number;
  dayStart: Date;
  dayEnd: Date;
}

/** 把 VEvent 转成 CalendarEvent;occurrence 是重复事件当天展开出的发生时刻 */
function icsEvent(
  v: ical.VEvent,
  source: string,
  rt: DayWindow,
  occurrence?: Date,
): CalendarEvent {
  const allDay = v.datetype === 'date';
  // 非重复事件在调用前已确保 start 是 Date,重复事件用当天展开出的发生时刻
  const start = (occurrence ?? v.start) as Date;
  const end = v.end as Date | undefined;
  const location = typeof v.location === 'string' ? v.location.trim() : '';

  const ev: CalendarEvent = {
    title: (typeof v.summary === 'string' && v.summary.trim()) || '(无标题)',
    start: allDay ? '全天' : zonedTimeLabel(start, rt.tz),
    source,
  };
  if (!allDay && end instanceof Date) ev.end = zonedTimeLabel(end, rt.tz);
  if (location) ev.location = location;
  return ev;
}

/** 拉取并解析单个 ICS 源,返回今天(目标时区)的事件;抛错由调用方记录降级 */
async function fetchIcsSource(
  src: IcsSource,
  rt: DayWindow,
  warnings: string[],
): Promise<CalendarEvent[]> {
  const source = src.name || '日历';
  const text = await httpGetText(src.url, { timeoutMs: 15000 });
  const parsed = await ical.async.parseICS(text);

  const plain: ical.VEvent[] = [];
  const recurring: ical.VEvent[] = [];
  for (const comp of Object.values(parsed)) {
    if (comp.type !== 'VEVENT') continue;
    if (comp.rrule) recurring.push(comp);
    else plain.push(comp);
  }

  const events: CalendarEvent[] = [];

  // 非重复事件:开始时刻落在"今天"才收
  for (const v of plain) {
    const start = v.start as Date | undefined;
    if (
      !(start instanceof Date) ||
      !isSameZonedDay(start, rt.year, rt.month, rt.day, rt.tz)
    ) {
      continue;
    }
    events.push(icsEvent(v, source, rt));
  }

  // 重复事件:在今日时间窗内展开,再按 exdate 剔除;展开失败降级为只留非重复部分
  for (const v of recurring) {
    try {
      const rrule = v.rrule;
      if (!rrule) continue;
      const excluded = exdateDays(v.exdate, rt.tz);
      // between 含首尾边界,dayEnd 恰好是明日午夜,再用 isSameZonedDay 兜一道
      for (const raw of rrule.between(rt.dayStart, rt.dayEnd, true)) {
        const occ = correctOccurrence(raw, v.start as Date);
        if (!isSameZonedDay(occ, rt.year, rt.month, rt.day, rt.tz)) continue;
        if (excluded.has(dayKey(occ, rt.tz))) continue;
        events.push(icsEvent(v, source, rt, occ));
      }
    } catch (err) {
      warnings.push(`日历源 ${source}: 重复事件展开失败(${errText(err)}),已忽略其重复事件`);
    }
  }

  return events;
}

export async function fetchCalendar(ctx: FetchContext): Promise<ModuleResult<CalendarSection>> {
  const cfg = ctx.cfg.calendar;
  const tz = ctx.cfg.timezone;
  const zp = zonedParts(ctx.now, tz);
  const dayStart = zonedDayStart(zp.year, zp.month, zp.day, tz);
  const rt: DayWindow = {
    tz,
    year: zp.year,
    month: zp.month,
    day: zp.day,
    dayStart,
    dayEnd: new Date(dayStart.getTime() + 86_400_000),
  };

  const warnings: string[] = [];
  const events: CalendarEvent[] = [];
  let sourceCount = 0;
  let failedCount = 0;

  /* ---- ICS 订阅源 ---- */
  for (const src of cfg.ics ?? []) {
    if (!src.url) continue; // url 为空直接跳过,不算失败
    sourceCount++;
    try {
      events.push(...(await fetchIcsSource(src, rt, warnings)));
    } catch (err) {
      failedCount++;
      warnings.push(`日历源 ${src.name || '日历'}: ${errText(err)}`);
    }
  }

  /* ---- 课表 ---- */
  const courseItems = cfg.courses?.items ?? [];
  if (courseItems.length > 0) {
    sourceCount++;
    const semesterStart = cfg.courses?.semesterStart;
    const ymd = semesterStart ? parseYmd(semesterStart) : null;
    // 周次算不出来时不做周次过滤;配置了但格式错才算子源失败
    const week = ymd ? currentWeek(ymd, ctx.now, tz) : null;
    if (!ymd) {
      warnings.push(
        semesterStart
          ? `课表: semesterStart "${semesterStart}" 无法解析,未按周次过滤`
          : '课表: 未配置 semesterStart,未按周次过滤',
      );
      if (semesterStart) failedCount++;
    }
    for (const item of courseItems) {
      // 配置约定 weekday 为 1-7(周一=1,周日=7),而 zonedParts 的 weekday 是 0-6(周日=0)
      const courseWeekday = zp.weekday === 0 ? 7 : zp.weekday;
      if (item.weekday !== courseWeekday) continue;
      if (week !== null && !weekRangeMatch(item.weeks, week)) continue;
      const ev: CalendarEvent = {
        title: item.name,
        start: item.start,
        end: item.end,
        source: '课表',
      };
      if (item.location) ev.location = item.location;
      if (item.teacher) ev.teacher = item.teacher;
      if (week !== null) ev.tag = `第 ${week} 周`;
      events.push(ev);
    }
  }

  /* ---- 去重与排序 ---- */
  // ICS 与课表撞车时只留一份
  const seen = new Set<string>();
  const deduped: CalendarEvent[] = [];
  for (const ev of events) {
    const key = [ev.title, ev.start, ev.end ?? '', ev.location ?? '', ev.source].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(ev);
  }
  // 全天事件排最前;'HH:mm' 定长可直接字符串比较
  deduped.sort((a, b) => {
    const aAllDay = a.start === '全天' ? 0 : 1;
    const bAllDay = b.start === '全天' ? 0 : 1;
    if (aAllDay !== bAllDay) return aAllDay - bAllDay;
    return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
  });

  const result: ModuleResult<CalendarSection> = { ok: true, data: { events: deduped } };
  if (warnings.length > 0) result.warnings = warnings;
  // 所有配置源都失败且颗粒无收才整体失败;部分成功/无事发生都算 ok
  if (sourceCount > 0 && failedCount === sourceCount && deduped.length === 0) {
    result.ok = false;
    result.data = null;
    result.error = '日历: 全部来源拉取失败';
  }
  return result;
}
