/**
 * 天气模块:Open-Meteo 免费预报(核心)+ 和风天气预警(可选增强)。
 *
 * 失败约定:预报拿不到 → 整体 ok:false;预警只是增强信息,
 * 单独失败只往结果 warnings 里记一条,预报部分照常返回。
 */

import { httpGetJson } from '../utils/http';
import type {
  FetchContext,
  ModuleResult,
  WeatherInfo,
  WeatherSection,
  WeatherWarning,
} from '../types';

/* ---------------- WMO 天气码映射 ---------------- */

const WMO_MAP: Record<number, [description: string, emoji: string]> = {
  0: ['晴', '☀️'],
  1: ['大部晴朗', '🌤'],
  2: ['局部多云', '🌤'],
  3: ['阴', '☁️'],
  45: ['雾', '🌫'],
  48: ['雾', '🌫'],
  51: ['毛毛雨', '🌧'],
  53: ['毛毛雨', '🌧'],
  55: ['毛毛雨', '🌧'],
  56: ['冻毛毛雨', '🌧'],
  57: ['冻毛毛雨', '🌧'],
  61: ['小雨', '🌧'],
  63: ['中雨', '🌧'],
  65: ['大雨', '🌧'],
  66: ['冻雨', '🌧'],
  67: ['冻雨', '🌧'],
  71: ['小雪', '🌨'],
  73: ['中雪', '🌨'],
  75: ['大雪', '🌨'],
  77: ['霰', '🌨'],
  80: ['阵雨', '🌦'],
  81: ['阵雨', '🌦'],
  82: ['强阵雨', '🌦'],
  85: ['阵雪', '🌨'],
  86: ['阵雪', '🌨'],
  95: ['雷阵雨', '⛈'],
  96: ['雷阵雨伴冰雹', '⛈'],
  99: ['雷阵雨伴冰雹', '⛈'],
};

export function wmoCodeInfo(code: number): { description: string; emoji: string } {
  const hit = WMO_MAP[code];
  return hit ? { description: hit[0], emoji: hit[1] } : { description: '未知', emoji: '🌍' };
}

/* ---------------- 响应类型(仅声明用到的字段) ---------------- */

interface OpenMeteoResp {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  daily?: {
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: (number | null)[];
  };
}

interface QWeatherResp {
  /** HTTP 200 但 code !== '200' 仍视为业务失败 */
  code?: string;
  warning?: Array<{
    title?: string;
    level?: string;
    text?: string;
    startTime?: string;
    endTime?: string;
    typeName?: string;
  }>;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function fetchWeather(ctx: FetchContext): Promise<ModuleResult<WeatherSection>> {
  const wcfg = ctx.cfg.weather;
  const resultWarnings: string[] = [];

  // 预报:核心数据,任何失败都直接整体失败
  let info: WeatherInfo;
  try {
    const url =
      'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${wcfg.latitude}&longitude=${wcfg.longitude}` +
      '&current=temperature_2m,weather_code,wind_speed_10m' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&forecast_days=1&timezone=auto';
    const resp = await httpGetJson<OpenMeteoResp>(url, { timeoutMs: 15000 });

    const current = resp.current;
    const daily = resp.daily;
    const tempMin = daily?.temperature_2m_min?.[0];
    const tempMax = daily?.temperature_2m_max?.[0];
    if (
      !current ||
      !daily ||
      typeof tempMin !== 'number' ||
      typeof tempMax !== 'number' ||
      typeof current.temperature_2m !== 'number'
    ) {
      return { ok: false, data: null, error: '天气: 预报响应缺少必要字段' };
    }

    const wmo = wmoCodeInfo(typeof current.weather_code === 'number' ? current.weather_code : -1);
    const precip = daily.precipitation_probability_max?.[0];
    info = {
      locationName: wcfg.locationName,
      description: wmo.description,
      emoji: wmo.emoji,
      tempMin,
      tempMax,
      tempNow: current.temperature_2m,
      warnings: [],
      source: 'open-meteo',
    };
    if (typeof precip === 'number') info.precipitationProb = precip;
  } catch (err) {
    return { ok: false, data: null, error: `天气: ${errText(err)}` };
  }

  // 预警:可选,需同时满足"配置了 qweather"和"环境变量有 key"
  const qw = wcfg.qweather;
  const apiKey = process.env.QWEATHER_API_KEY;
  if (qw && apiKey) {
    try {
      const host = qw.host ?? 'devapi.qweather.com';
      const url = `https://${host}/v7/warning/now?location=${encodeURIComponent(qw.locationId)}`;
      const resp = await httpGetJson<QWeatherResp>(url, {
        timeoutMs: 15000,
        headers: { 'X-QW-Api-Key': apiKey },
      });
      if (resp.code !== '200') {
        resultWarnings.push(`预警获取失败: 和风天气返回 code=${resp.code ?? '未知'}`);
      } else {
        const list = Array.isArray(resp.warning) ? resp.warning : [];
        info.warnings = list.map((w) => {
          const item: WeatherWarning = { title: w.title ?? '' };
          if (w.level !== undefined) item.level = w.level;
          if (w.text !== undefined) item.detail = w.text;
          if (w.startTime !== undefined) item.start = w.startTime;
          if (w.endTime !== undefined) item.end = w.endTime;
          return item;
        });
      }
    } catch (err) {
      resultWarnings.push(`预警获取失败: ${errText(err)}`);
    }
  }

  return {
    ok: true,
    data: { weather: info },
    ...(resultWarnings.length > 0 ? { warnings: resultWarnings } : {}),
  };
}
