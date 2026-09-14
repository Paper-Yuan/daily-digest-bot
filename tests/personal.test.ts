/** 个人提醒:纪念日倒计时(含 2/29 边界)与证书到期解析 */

import { describe, expect, it } from 'vitest';
import { daysUntil, nextAnniversary, parseCertValidTo } from '../src/modules/personal';

describe('nextAnniversary(每年重复的倒计时)', () => {
  it('今年还没到 -> 算到今年', () => {
    const r = nextAnniversary('1998-03-15', '2026-09-15');
    expect(r).toEqual({ nextDate: '2027-03-15', daysLeft: 181 });
  });

  it('今年已经过了 -> 算到明年', () => {
    const r = nextAnniversary('1998-03-15', '2026-06-01');
    expect(r?.nextDate).toBe('2027-03-15');
  });

  it('就是今天 -> 0 天', () => {
    const r = nextAnniversary('1998-09-15', '2026-09-15');
    expect(r).toEqual({ nextDate: '2026-09-15', daysLeft: 0 });
  });

  it('今天已过生日当天再跑(次日)-> 顺延一年', () => {
    const r = nextAnniversary('1998-09-15', '2026-09-16');
    expect(r?.nextDate).toBe('2027-09-15');
    expect(r?.daysLeft).toBe(364);
  });

  it('2月29日在平年归到 2月28日(不溢出成 3月1日)', () => {
    // 2027 不是闰年,生日 2/29 应落在 2/28 而不是 3/1
    const r = nextAnniversary('2000-02-29', '2027-02-01');
    expect(r?.nextDate).toBe('2027-02-28');
    expect(r?.daysLeft).toBe(27);
  });

  it('闰年 2月29日正常保留', () => {
    const r = nextAnniversary('2000-02-29', '2028-02-01');
    expect(r?.nextDate).toBe('2028-02-29');
  });

  it('跨年边界(12月31日 -> 次年1月1日)', () => {
    const r = nextAnniversary('2000-01-01', '2026-12-31');
    expect(r).toEqual({ nextDate: '2027-01-01', daysLeft: 1 });
  });

  it('日期格式非法返回 null 而不是抛错', () => {
    expect(nextAnniversary('98-3-15', '2026-09-15')).toBeNull();
    expect(nextAnniversary('1998-13-01', '2026-09-15')).toBeNull();
    expect(nextAnniversary('', '2026-09-15')).toBeNull();
    expect(nextAnniversary('1998-03-15', 'bad')).toBeNull();
  });

  it('月份日期的天数按当月实际天数取(4月31日 -> 4月30日)', () => {
    const r = nextAnniversary('2000-04-31', '2026-04-01');
    expect(r?.nextDate).toBe('2026-04-30');
  });
});

describe('parseCertValidTo(证书时间解析)', () => {
  it('解析 ASN.1 时间格式', () => {
    const d = parseCertValidTo('Dec 10 12:00:00 2026 GMT');
    expect(d).not.toBeNull();
    expect(d?.toISOString().slice(0, 10)).toBe('2026-12-10');
  });

  it('解析 ISO 格式(部分实现会给 ISO)', () => {
    const d = parseCertValidTo('2026-12-10T12:00:00Z');
    expect(d?.toISOString().slice(0, 10)).toBe('2026-12-10');
  });

  it('无法解析返回 null(不产生 Invalid Date)', () => {
    expect(parseCertValidTo('')).toBeNull();
    expect(parseCertValidTo('not a date')).toBeNull();
  });
});

describe('daysUntil(整天差)', () => {
  it('按日期算整天,不受具体时刻影响', () => {
    const from = new Date('2026-09-15T23:59:00Z');
    const to = new Date('2026-09-16T00:01:00Z');
    expect(daysUntil(to, from)).toBe(1);
  });

  it('已过期返回负数', () => {
    expect(daysUntil(new Date('2026-09-10T00:00:00Z'), new Date('2026-09-15T00:00:00Z'))).toBe(-5);
  });

  it('同一天返回 0', () => {
    expect(daysUntil(new Date('2026-09-15T01:00:00Z'), new Date('2026-09-15T20:00:00Z'))).toBe(0);
  });
});
