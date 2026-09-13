/** 时区与周次工具:跨时区"今天"的语义正确性 */

import { describe, expect, it } from 'vitest';
import {
  currentWeek,
  parseYmd,
  weekRangeMatch,
  zonedDayStart,
  zonedParts,
  zhWeekday,
} from '../src/utils/date';

describe('zonedParts', () => {
  it('UTC 时间换算到北京时区', () => {
    const p = zonedParts(new Date('2026-09-13T00:30:00Z'), 'Asia/Shanghai');
    expect(p).toMatchObject({ year: 2026, month: 9, day: 13, hour: 8, minute: 30, weekday: 0 });
  });

  it('UTC 16:00 前后分属北京的两个日期', () => {
    const before = zonedParts(new Date('2026-09-12T15:59:00Z'), 'Asia/Shanghai');
    const after = zonedParts(new Date('2026-09-12T16:01:00Z'), 'Asia/Shanghai');
    expect(before.day).toBe(12);
    expect(after.day).toBe(13);
    expect(zhWeekday(after.weekday)).toBe('星期日');
  });
});

describe('zonedDayStart', () => {
  it('北京 2026-09-13 零点 = UTC 前一天 16:00', () => {
    expect(zonedDayStart(2026, 9, 13, 'Asia/Shanghai').toISOString()).toBe('2026-09-12T16:00:00.000Z');
  });
});

describe('currentWeek / weekRangeMatch', () => {
  const start = { year: 2026, month: 9, day: 7 }; // 周一

  it('开学当周为第 1 周,次周为第 2 周', () => {
    expect(currentWeek(start, new Date('2026-09-09T04:00:00Z'), 'Asia/Shanghai')).toBe(1);
    expect(currentWeek(start, new Date('2026-09-16T04:00:00Z'), 'Asia/Shanghai')).toBe(2);
  });

  it('开学前为 0 或负数', () => {
    expect(currentWeek(start, new Date('2026-09-05T04:00:00Z'), 'Asia/Shanghai')).toBeLessThanOrEqual(0);
  });

  it('周次表达式解析', () => {
    expect(weekRangeMatch('1-16', 1)).toBe(true);
    expect(weekRangeMatch('1-16', 16)).toBe(true);
    expect(weekRangeMatch('1-16', 17)).toBe(false);
    expect(weekRangeMatch('2-16', 1)).toBe(false);
    expect(weekRangeMatch('1,3,5-8', 3)).toBe(true);
    expect(weekRangeMatch('1,3,5-8', 4)).toBe(false);
    expect(weekRangeMatch(undefined, 99)).toBe(true); // 缺省=每周
  });

  it('parseYmd 校验格式', () => {
    expect(parseYmd('2026-09-07')).toEqual({ year: 2026, month: 9, day: 7 });
    expect(parseYmd('2026/09/07')).toBeNull();
  });
});
