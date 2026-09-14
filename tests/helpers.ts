/** 测试公共工具:构造完整 BotConfig */

import type { BotConfig } from '../src/types';

export function makeCfg(over: Partial<BotConfig> = {}): BotConfig {
  return {
    timezone: 'Asia/Shanghai',
    weather: { enabled: false, locationName: '北京', latitude: 39.9, longitude: 116.4 },
    calendar: { enabled: true },
    github: { enabled: true, repos: [] },
    rss: { enabled: true, feeds: [] },
    baiduhot: { enabled: true, maxItems: 10 },
    notify: {},
    limits: { maxCalendarEvents: 10, maxReleases: 8, maxRssItems: 10, summaryChars: 100 },
    schedule: {},
    image: {},
    quick: {},
    statePath: 'data/state.json',
    ...over,
  };
}
