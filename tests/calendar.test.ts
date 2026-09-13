/** 日历/课表模块:周次过滤、ICS 解析(普通/全天/重复)、单源失败降级 */

import { describe, expect, it, vi } from 'vitest';
import { fetchCalendar } from '../src/modules/calendar';
import { emptyState } from '../src/utils/state';
import { makeCfg } from './helpers';
import type { BotConfig, FetchContext } from '../src/types';

// 固定"现在":2026-09-13 08:30(北京,星期日),学期第 1 周(2026-09-07 开学)
const NOW = new Date('2026-09-13T00:30:00Z');

const SAMPLE_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//CN',
  'BEGIN:VEVENT',
  'UID:plain-1@test',
  'DTSTART:20260913T020000Z',
  'DTEND:20260913T033000Z',
  'SUMMARY:团队周会',
  'LOCATION:会议室A',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:allday-1@test',
  'DTSTART;VALUE=DATE:20260913',
  'SUMMARY:中秋假期',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:weekly-1@test',
  'DTSTART:20260830T013000Z',
  'DTEND:20260830T023000Z',
  'RRULE:FREQ=WEEKLY;BYDAY=SU',
  'SUMMARY:周例跑',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:not-today@test',
  'DTSTART:20260914T010000Z',
  'SUMMARY:明天的事',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

vi.mock('../src/utils/http', () => ({
  httpGetText: vi.fn(async (url: string) => {
    if (url.includes('bad.example.com')) throw new Error('HTTP 503');
    return SAMPLE_ICS;
  }),
}));

function calCtx(cfg: BotConfig, force = false): FetchContext {
  return { cfg, state: emptyState(), now: NOW, force };
}

describe('课表周次过滤', () => {
  it('按 weekday 与 weeks 过滤,当前为第 1 周', async () => {
    const cfg = makeCfg({
      calendar: {
        enabled: true,
        courses: {
          semesterStart: '2026-09-07',
          items: [
            { name: '周一数学', weekday: 1, start: '08:00', end: '09:40' },
            { name: '周日英语', weekday: 7, start: '10:00', end: '11:40', location: '外语楼' },
            { name: '周日体育', weekday: 7, start: '14:00', end: '15:40', weeks: '2-16' },
            { name: '周日班会', weekday: 7, start: '16:00', end: '16:40', weeks: '1,3,5' },
          ],
        },
      },
    });

    const res = await fetchCalendar(calCtx(cfg));
    expect(res.ok).toBe(true);
    expect(res.data?.events.map((e) => e.title)).toEqual(['周日英语', '周日班会']);
    expect(res.data?.events[0]).toMatchObject({
      start: '10:00', end: '11:40', location: '外语楼', tag: '第 1 周', source: '课表',
    });
  });
});

describe('ICS 解析', () => {
  it('普通/全天/每周重复事件命中今天,明天的事件被排除', async () => {
    const cfg = makeCfg({ calendar: { enabled: true, ics: [{ name: '测试日历', url: 'https://cal.example.com/x.ics' }] } });

    const res = await fetchCalendar(calCtx(cfg));
    expect(res.ok).toBe(true);
    const titles = res.data?.events.map((e) => e.title) ?? [];
    expect(titles).toContain('中秋假期');
    expect(titles).toContain('团队周会');
    expect(titles).toContain('周例跑');
    expect(titles).not.toContain('明天的事');

    const events = res.data?.events ?? [];
    const weekly = events.find((e) => e.title === '周例跑');
    expect(weekly?.start).toBe('09:30'); // 2026-09-13 当天展开出的发生时刻
    const meeting = events.find((e) => e.title === '团队周会');
    expect(meeting).toMatchObject({ start: '10:00', end: '11:30', location: '会议室A', source: '测试日历' });
  });

  it('全天事件排在最前', async () => {
    const cfg = makeCfg({ calendar: { enabled: true, ics: [{ url: 'https://cal.example.com/x.ics' }] } });
    const res = await fetchCalendar(calCtx(cfg));
    const events = res.data?.events ?? [];
    expect(events[0]?.start).toBe('全天');
  });

  it('单个源失败降级为 warning,其余源正常', async () => {
    const cfg = makeCfg({
      calendar: {
        enabled: true,
        ics: [
          { name: '坏源', url: 'https://bad.example.com/a.ics' },
          { name: '好源', url: 'https://cal.example.com/x.ics' },
        ],
      },
    });
    const res = await fetchCalendar(calCtx(cfg));
    expect(res.ok).toBe(true);
    expect(res.warnings?.join('\n')).toContain('日历源 坏源: HTTP 503');
    expect(res.data?.events.length).toBeGreaterThan(0);
  });

  it('全部源失败且无事件时整体失败', async () => {
    const cfg = makeCfg({ calendar: { enabled: true, ics: [{ name: '坏源', url: 'https://bad.example.com/a.ics' }] } });
    const res = await fetchCalendar(calCtx(cfg));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('全部来源拉取失败');
  });
});
