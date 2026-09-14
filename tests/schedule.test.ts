/** 发布锁纯函数:时区换算、等待上限、当日幂等 */

import { describe, expect, it } from 'vitest';
import type { BotState } from '../src/types';
import {
  alreadySentToday,
  markSent,
  parseHm,
  slotForHour,
  targetTime,
  waitMillis,
} from '../src/schedule';

const TZ = 'Asia/Shanghai';

describe('parseHm', () => {
  it('解析合法时刻(含单位数小时)', () => {
    expect(parseHm('08:00')).toEqual({ hour: 8, minute: 0 });
    expect(parseHm('21:00')).toEqual({ hour: 21, minute: 0 });
    expect(parseHm('7:05')).toEqual({ hour: 7, minute: 5 });
  });

  it('非法输入一律返回 null', () => {
    for (const bad of ['', '8', '08:60', '24:00', 'abc', '-1:00']) {
      expect(parseHm(bad)).toBeNull();
    }
  });
});

describe('slotForHour', () => {
  it('12 点为早晚报分界', () => {
    expect(slotForHour(0)).toBe('morning');
    expect(slotForHour(11)).toBe('morning');
    expect(slotForHour(12)).toBe('evening');
    expect(slotForHour(23)).toBe('evening');
  });
});

describe('targetTime', () => {
  it('北京当日 08:00 = UTC 00:00(不受 runner 本地时区影响)', () => {
    const now = new Date('2026-09-12T23:40:00Z'); // 北京 2026-09-13 07:40
    const target = targetTime({ hour: 8, minute: 0 }, now, TZ);
    expect(target.toISOString()).toBe('2026-09-13T00:00:00.000Z');
  });

  it('北京当日 21:00 = UTC 13:00', () => {
    const now = new Date('2026-09-12T23:40:00Z');
    const target = targetTime({ hour: 21, minute: 0 }, now, TZ);
    expect(target.toISOString()).toBe('2026-09-13T13:00:00.000Z');
  });
});

describe('waitMillis', () => {
  it('早于目标 20 分钟且上限 30 分钟 → 返回 20 分钟', () => {
    const now = new Date(0);
    const target = new Date(20 * 60_000);
    expect(waitMillis(now, target, 30 * 60_000)).toBe(20 * 60_000);
  });

  it('已晚于目标 → 0', () => {
    expect(waitMillis(new Date(60_000), new Date(0), 30 * 60_000)).toBe(0);
  });

  it('恰好等于目标 → 0', () => {
    expect(waitMillis(new Date(0), new Date(0), 30 * 60_000)).toBe(0);
  });

  it('超出等待上限 → null(放弃等待)', () => {
    const now = new Date(0);
    const target = new Date(40 * 60_000);
    expect(waitMillis(now, target, 30 * 60_000)).toBeNull();
  });

  it('maxWaitMs<=0 时:需等待返回 null,已到点返回 0', () => {
    expect(waitMillis(new Date(0), new Date(60_000), 0)).toBeNull();
    expect(waitMillis(new Date(0), new Date(0), 0)).toBe(0);
  });
});

describe('alreadySentToday / markSent', () => {
  it('空 state → false;标记后 → true', () => {
    const state: BotState = { version: 1 };
    expect(alreadySentToday(state, 'morning', '2026-09-13')).toBe(false);
    markSent(state, 'morning', '2026-09-13');
    expect(alreadySentToday(state, 'morning', '2026-09-13')).toBe(true);
  });

  it('日期不匹配(记录的是昨天)→ false', () => {
    const state: BotState = { version: 1, sends: { morning: '2026-09-12' } };
    expect(alreadySentToday(state, 'morning', '2026-09-13')).toBe(false);
  });

  it('sends 值类型异常 → false 且不抛', () => {
    const bad = { version: 1, sends: { morning: undefined, evening: 42 } } as unknown as BotState;
    expect(alreadySentToday(bad, 'morning', '2026-09-13')).toBe(false);
    expect(alreadySentToday(bad, 'evening', '2026-09-13')).toBe(false);
  });

  it('sends 缺失时 markSent 能安全创建', () => {
    const state: BotState = { version: 1 };
    expect(state.sends).toBeUndefined();
    markSent(state, 'evening', '2026-09-13');
    expect(state.sends).toEqual({ evening: '2026-09-13' });
    expect(alreadySentToday(state, 'evening', '2026-09-13')).toBe(true);
  });
});
