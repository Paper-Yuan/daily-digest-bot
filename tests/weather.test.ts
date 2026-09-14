/** 天气增强:空气质量分级、穿衣建议、逐小时降水合并成时段 */

import { describe, expect, it } from 'vitest';
import { dressAdvice, mergeRainWindows, pm25Level, wmoCodeInfo } from '../src/modules/weather';

describe('pm25Level(PM2.5 浓度 -> 等级)', () => {
  it('按 HJ 633-2012 的 PM2.5 分级取边界值', () => {
    expect(pm25Level(0)).toBe('优');
    expect(pm25Level(35)).toBe('优'); // 边界含在"优"
    expect(pm25Level(35.1)).toBe('良');
    expect(pm25Level(75)).toBe('良');
    expect(pm25Level(76)).toBe('轻度污染');
    expect(pm25Level(115)).toBe('轻度污染');
    expect(pm25Level(116)).toBe('中度污染');
    expect(pm25Level(150)).toBe('中度污染');
    expect(pm25Level(151)).toBe('重度污染');
    expect(pm25Level(250)).toBe('重度污染');
    expect(pm25Level(251)).toBe('严重污染');
  });

  it('非法输入返回未知而不是抛错', () => {
    expect(pm25Level(Number.NaN)).toBe('未知');
    expect(pm25Level(-1)).toBe('未知');
    expect(pm25Level(Number.POSITIVE_INFINITY)).toBe('未知');
  });
});

describe('dressAdvice(温度 -> 穿衣建议)', () => {
  it('按最高温给出对应档位', () => {
    expect(dressAdvice(26, 31)).toContain('短袖');
    expect(dressAdvice(20, 26)).toContain('短袖');
    expect(dressAdvice(16, 21)).toContain('长袖');
    expect(dressAdvice(11, 16)).toContain('夹克');
    expect(dressAdvice(6, 11)).toContain('厚外套');
    expect(dressAdvice(1, 6)).toContain('毛衣');
    expect(dressAdvice(-4, 1)).toContain('羽绒');
  });

  it('昼夜温差 >=10℃ 时追加提醒外套', () => {
    const wide = dressAdvice(12, 24); // 温差 12
    expect(wide).toContain('温差');
    expect(wide).toContain('外套');
    expect(dressAdvice(18, 25)).not.toContain('温差'); // 温差 7,不提醒
  });

  it('非法温度返回空串(不产出垃圾建议)', () => {
    expect(dressAdvice(Number.NaN, 20)).toBe('');
    expect(dressAdvice(10, Number.NaN)).toBe('');
  });
});

describe('mergeRainWindows(逐小时降水 -> 连续时段)', () => {
  const DAY = '2026-09-15';
  const mk = (hours: number[]): string[] =>
    hours.map((h) => `${DAY}T${String(h).padStart(2, '0')}:00`);

  it('连续超阈值的时段合并成一段,并取最高概率', () => {
    // 9/10/11 点有雨,12 点转晴
    const out = mergeRainWindows(
      mk([8, 9, 10, 11, 12]),
      [0, 40, 55, 45, 10],
      undefined,
      DAY,
    );
    expect(out).toEqual([{ start: '09:00', end: '11:00', maxProb: 55 }]);
  });

  it('被干燥小时隔开的两段雨分别输出', () => {
    const out = mergeRainWindows(
      mk([8, 9, 10, 11, 12, 13]),
      [0, 50, 60, 0, 45, 50],
      undefined,
      DAY,
    );
    expect(out.map((r) => `${r.start}-${r.end}`)).toEqual(['09:00-10:00', '12:00-13:00']);
  });

  it('累计降水量只在有值时带上', () => {
    const out = mergeRainWindows(
      mk([9, 10]),
      [50, 60],
      [1.2, 2.35],
      DAY,
    );
    expect(out[0]?.mm).toBeCloseTo(3.6, 5); // 1.2 + 2.35 = 3.55 -> 四舍五入 3.6
    const noMm = mergeRainWindows(mk([9]), [50], undefined, DAY);
    expect(noMm[0]?.mm).toBeUndefined();
  });

  it('阈值可调:低于阈值的毛毛雨不产出时段', () => {
    expect(mergeRainWindows(mk([9]), [20], undefined, DAY, 30)).toEqual([]);
    expect(mergeRainWindows(mk([9]), [20], undefined, DAY, 10)).toHaveLength(1);
  });

  it('只统计指定日期的数据(跨天数据不混入)', () => {
    const times = ['2026-09-14T23:00', '2026-09-15T00:00', '2026-09-16T01:00'];
    const out = mergeRainWindows(times, [90, 90, 90], undefined, DAY);
    expect(out).toEqual([{ start: '00:00', end: '00:00', maxProb: 90 }]);
  });

  it('fromHour 用于晚报:过滤掉已经结束的时段', () => {
    const times = mk([8, 9, 20, 21]);
    const probs = [80, 80, 80, 80];
    // 两段:08-09 与 20-21
    const all = mergeRainWindows(times, probs, undefined, DAY);
    expect(all.map((r) => r.start)).toEqual(['08:00', '20:00']);
    // 晚上 18 点发报:上午那段已过,只留晚上的
    const evening = mergeRainWindows(times, probs, undefined, DAY, 30, 18);
    expect(evening.map((r) => r.start)).toEqual(['20:00']);
    // 进行中的时段要保留(结束时刻 >= 当前小时)
    const during = mergeRainWindows(times, probs, undefined, DAY, 30, 9);
    expect(during.map((r) => r.start)).toEqual(['08:00', '20:00']);
  });

  it('空数据与全 null 不抛错', () => {
    expect(mergeRainWindows([], [], undefined, DAY)).toEqual([]);
    expect(mergeRainWindows(mk([9, 10]), [null, null], undefined, DAY)).toEqual([]);
  });
});

describe('wmoCodeInfo', () => {
  it('已知码给出描述与 emoji,未知码兜底', () => {
    expect(wmoCodeInfo(0)).toEqual({ description: '晴', emoji: '☀️' });
    expect(wmoCodeInfo(9999).description).toBe('未知');
  });
});
