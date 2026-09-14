/**
 * 发布锁与快报的纯函数工具。
 *
 * 契约:
 *  - 全部为纯函数(除 markSent 原地修改传入的 state);不做 IO、不打日志、不抛异常。
 *  - 时区换算一律复用 utils/date.ts 的 zonedParts / zonedDayStart,不自行实现,
 *    这样在 UTC 的 CI runner 上"今天"的语义依然正确。
 */

import type { BotState } from './types';
import { zonedDayStart, zonedParts } from './utils/date';

export type Slot = 'morning' | 'evening';

/** 解析 'HH:mm';非法输入(格式错/小时>23/分钟>59/空)返回 null */
export function parseHm(s: string): { hour: number; minute: number } | null {
  if (typeof s !== 'string') return null;
  // 允许单位数小时(如 '7:05'),分钟必须两位,以免 '8:5' 被误判为合法
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** 本地小时 → 时段:<12 点算早报,否则晚报 */
export function slotForHour(hour: number): Slot {
  return hour < 12 ? 'morning' : 'evening';
}

/**
 * 目标发布时刻(今天,指定时区)对应的绝对时间。
 *
 * 关键约束:绝不能用 new Date(y, m, d, h, min) —— 那会按进程本地时区解释,
 * 在 UTC 的 CI 上算出的就不是用户所在时区的目标时刻。必须由 zonedDayStart
 * 取到"该时区当天 00:00 的绝对时刻",再叠加时分偏移。
 */
export function targetTime(
  hm: { hour: number; minute: number },
  now: Date,
  tz: string,
): Date {
  const p = zonedParts(now, tz);
  const dayStart = zonedDayStart(p.year, p.month, p.day, tz);
  const hour = Number.isFinite(hm.hour) ? hm.hour : 0;
  const minute = Number.isFinite(hm.minute) ? hm.minute : 0;
  return new Date(dayStart.getTime() + hour * 3_600_000 + minute * 60_000);
}

/**
 * 还需等待的毫秒数:
 *  - now 已到/已过 target → 0
 *  - now 早于 target → 正数差值
 *  - 差值 > maxWaitMs → null(调用方据此放弃等待、立即发送)
 *  - maxWaitMs <= 0:表示不接受任何等待 —— 若确实需要等待则返回 null,
 *    否则(已到点)仍返回 0;即"不等待上限"不是"无限等待"。
 */
export function waitMillis(now: Date, target: Date, maxWaitMs: number): number | null {
  const diff = target.getTime() - now.getTime();
  // 非法日期(NaN)无法判断,保守视为放弃等待
  if (!Number.isFinite(diff)) return null;
  if (diff <= 0) return 0;
  if (maxWaitMs <= 0) return null;
  if (diff > maxWaitMs) return null;
  return diff;
}

/** 当日该时段是否已成功发送 */
export function alreadySentToday(state: BotState, slot: Slot, todayYmd: string): boolean {
  // state.sends 可能缺失,值也可能是任意类型(手改状态文件),都不能崩
  const sends = state?.sends;
  if (!sends || typeof sends !== 'object') return false;
  const value = sends[slot];
  return typeof value === 'string' && value === todayYmd;
}

/** 记录当日该时段已成功发送(原地修改 state.sends) */
export function markSent(state: BotState, slot: Slot, todayYmd: string): void {
  if (!state || typeof state !== 'object') return;
  if (!state.sends || typeof state.sends !== 'object') state.sends = {};
  state.sends[slot] = todayYmd;
}
