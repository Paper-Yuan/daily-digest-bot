/**
 * 配置加载:config/config.yaml(可经 CONFIG_PATH 覆盖) + 内置默认值深合并。
 * 密钥类信息(Telegram token、飞书 webhook 等)一律走环境变量,不进配置文件。
 */

import * as fs from 'fs';
import YAML from 'yaml';
import type { BotConfig } from './types';

export const DEFAULT_STATE_PATH = 'data/state.json';

export function defaultConfig(): BotConfig {
  return {
    timezone: 'Asia/Shanghai',
    weather: {
      enabled: true,
      locationName: '北京',
      latitude: 39.9042,
      longitude: 116.4074,
    },
    calendar: { enabled: true },
    github: {
      enabled: true,
      repos: [],
      includePrerelease: false,
      maxPerRepo: 3,
      firstRunQuiet: true,
      discover: {
        enabled: false,
        createdWithinDays: 7,
        minStars: 100,
        chineseOnly: true,
        maxItems: 10,
        firstRunQuiet: false,
      },
    },
    rss: {
      enabled: true,
      feeds: [],
      maxPerFeed: 5,
      firstRunQuiet: true,
    },
    baiduhot: {
      enabled: true,
      maxItems: 10,
    },
    notify: {},
    limits: {
      maxCalendarEvents: 10,
      maxReleases: 8,
      maxRssItems: 10,
      summaryChars: 100,
    },
    statePath: DEFAULT_STATE_PATH,
  };
}

/** 对普通对象递归合并:对象合并、数组与标量整体覆盖 */
function deepMerge<T>(base: T, override: unknown): T {
  if (override === null || override === undefined) return base;
  if (typeof base === 'object' && base !== null && !Array.isArray(base)
    && typeof override === 'object' && override !== null && !Array.isArray(override)) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
      out[key] = deepMerge(out[key], value);
    }
    return out as T;
  }
  return override as T;
}

export function loadConfig(configPath: string): BotConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch {
    throw new Error(
      `配置文件不存在: ${configPath}\n` +
      '请复制 config/config.example.yaml 为 config/config.yaml 后修改。',
    );
  }
  const user = YAML.parse(raw) ?? {};
  if (typeof user !== 'object' || Array.isArray(user)) {
    throw new Error(`配置文件格式错误,应为 YAML 映射: ${configPath}`);
  }
  const merged = deepMerge(defaultConfig(), user);
  if (!merged.timezone || typeof merged.timezone !== 'string') {
    throw new Error('配置项 timezone 不能为空,例如 "Asia/Shanghai"');
  }
  return merged;
}
