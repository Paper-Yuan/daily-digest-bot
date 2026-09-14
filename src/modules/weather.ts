/**
 * 天气模块:Open-Meteo 免费预报(核心)+ 和风天气预警(可选增强)。
 *
 * 失败约定:预报拿不到 → 整体 ok:false;其余都是增强信息,单独失败只往
 * warnings 里记一条,预报部分照常返回:
 *  - 和风天气预警(需 QWEATHER_API_KEY)
 *  - 空气质量(另一个 Open-Meteo 主机,可用性独立)
 *  - 日出日落 / 紫外线 / 逐小时降水(与预报同一个请求,拿到就用)
 */

import { httpGetJson } from '../utils/http';
import { pad2 } from '../utils/date';
import type {
  AirQuality,
  FetchContext,
  ModuleResult,
  RainWindow,
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
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: (number | null)[];
    sunrise?: (string | null)[];
    sunset?: (string | null)[];
    uv_index_max?: (number | null)[];
  };
  hourly?: {
    time?: string[];
    precipitation_probability?: (number | null)[];
    precipitation?: (number | null)[];
  };
}

interface AirQualityResp {
  current?: {
    pm2_5?: number;
    pm10?: number;
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

/* ---------------- 空气质量:浓度 -> 等级 ---------------- */

/**
 * PM2.5 浓度(μg/m³,24 小时均值口径)对应的等级词,参照中国 HJ 633-2012 分级:
 * ≤35 优 / ≤75 良 / ≤115 轻度 / ≤150 中度 / ≤250 重度 / >250 严重。
 *
 * 为什么报浓度+等级而不是 AQI 数字:严格 AQI 要算六项污染物的 IAQI 再取最大,
 * 这里只取到 PM2.5,报出来的"AQI"会偏低、反而不准。浓度与等级是诚实的。
 */
export function pm25Level(pm25: number): string {
  if (!Number.isFinite(pm25) || pm25 < 0) return '未知';
  if (pm25 <= 35) return '优';
  if (pm25 <= 75) return '良';
  if (pm25 <= 115) return '轻度污染';
  if (pm25 <= 150) return '中度污染';
  if (pm25 <= 250) return '重度污染';
  return '严重污染';
}

/* ---------------- 穿衣建议:纯温度推导 ---------------- */

/**
 * 按"当天最高/最低温"给一句穿衣建议。
 * 用最高温决定"白天穿多少"、用温差决定"要不要带外套",不做任何联网查询。
 * 纯函数,便于测试不同温度段的边界。
 */
export function dressAdvice(tempMin: number, tempMax: number): string {
  if (!Number.isFinite(tempMin) || !Number.isFinite(tempMax)) return '';
  const d = tempMax - tempMin;
  let base: string;
  if (tempMax >= 30) base = '炎热,短袖短裤';
  else if (tempMax >= 25) base = '热,短袖';
  else if (tempMax >= 20) base = '舒适,长袖或薄外套';
  else if (tempMax >= 15) base = '微凉,夹克或薄毛衣';
  else if (tempMax >= 10) base = '凉,厚外套';
  else if (tempMax >= 5) base = '冷,毛衣加外套';
  else if (tempMax >= 0) base = '很冷,羽绒服';
  else base = '严寒,厚羽绒 + 保暖配件';
  // 昼夜温差大(>=10℃)时提醒早晚加衣
  if (d >= 10) return `${base};早晚温差 ${Math.round(d)}℃,记得加件外套`;
  return base;
}

/* ---------------- 逐小时降水 -> 连续时段 ---------------- */

/** HH:MM -> 小时数;用于判断时段是否已经过去 */
export function hourOf(hm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hm);
  return m ? Number(m[1]) : -1;
}

/**
 * 把逐小时降水数据合并成连续时段。
 *
 * 为什么要合并:逐小时直接列会刷屏("09:00 40% / 10:00 55% / 11:00 45%")，
 * 合并成"09:00-11:00 有雨,最高 55%"才是能直接用的信息。
 *
 * @param times 逐小时时间戳(ISO 本地时间,形如 2026-09-15T14:00)
 * @param probs 对应的降水概率(%)
 * @param mms   对应的降水量(mm),可为空数组
 * @param today 只统计这一天的数据(YYYY-MM-DD)
 * @param threshold 概率达到多少才算"有雨",默认 30
 * @param fromHour 只保留结束时刻不早于该小时的时段(-1 = 不过滤),用于"晚报只看今晚之后"
 */
export function mergeRainWindows(
  times: string[],
  probs: (number | null)[],
  mms: (number | null)[] | undefined,
  today: string,
  threshold = 30,
  fromHour = -1,
): RainWindow[] {
  const out: RainWindow[] = [];
  let cur: { startH: number; endH: number; maxProb: number; mm: number } | null = null;

  const flush = (): void => {
    if (!cur) return;
    const w: RainWindow = {
      start: `${pad2(cur.startH)}:00`,
      end: `${pad2(cur.endH)}:00`,
      maxProb: Math.round(cur.maxProb),
    };
    if (cur.mm > 0) w.mm = Math.round(cur.mm * 10) / 10;
    out.push(w);
    cur = null;
  };

  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (!t.startsWith(today)) continue;
    const hm = t.slice(11, 16);
    const h = hourOf(hm);
    if (h < 0) continue;
    const p = probs[i];
    const wet = typeof p === 'number' && p >= threshold;
    if (wet) {
      const mmRaw = mms?.[i];
      const mm = typeof mmRaw === 'number' && Number.isFinite(mmRaw) ? mmRaw : 0;
      // 必须与上一小时紧邻才算同一段:数据缺小时(或本就不连续)时不能并成一段,
      // 否则会出现"08:00~21:00 有雨"这种把整天空档都算进去的假象
      if (cur && h === cur.endH + 1) {
        cur.endH = h;
        cur.maxProb = Math.max(cur.maxProb, p);
        cur.mm += mm;
      } else {
        flush();
        cur = { startH: h, endH: h, maxProb: p, mm };
      }
    } else {
      flush();
    }
  }
  flush();

  // 晚报场景:已经过去的时段不必再提醒(保留仍在进行/即将开始的)
  if (fromHour < 0) return out;
  return out.filter((w) => hourOf(w.end) >= fromHour);
}

/* ---------------- 预报接口 ---------------- */

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
      ',sunrise,sunset,uv_index_max' +
      '&hourly=precipitation_probability,precipitation' +
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

    // 日出日落 / 紫外线:接口返回 ISO 本地时间(带 timezone=auto),取 HH:MM 即可
    const sunrise = daily.sunrise?.[0];
    const sunset = daily.sunset?.[0];
    if (typeof sunrise === 'string' && sunrise.length >= 16) info.sunrise = sunrise.slice(11, 16);
    if (typeof sunset === 'string' && sunset.length >= 16) info.sunset = sunset.slice(11, 16);
    const uv = daily.uv_index_max?.[0];
    if (typeof uv === 'number') info.uvIndexMax = Math.round(uv * 10) / 10;

    // 逐小时降水:合并成连续时段。晚报只保留此刻之后的,避免提醒已经过去的雨
    const h = resp.hourly;
    const day = daily.time?.[0];
    if (h?.time?.length && Array.isArray(h.precipitation_probability) && day) {
      const fromHour = ctx.reportKind === 'evening' ? ctx.now.getHours() : -1;
      const windows = mergeRainWindows(
        h.time,
        h.precipitation_probability,
        h.precipitation,
        day,
        30,
        fromHour,
      );
      if (windows.length > 0) info.rainWindows = windows;
    }

    // 穿衣建议:纯温度推导,永远可用
    const advice = dressAdvice(tempMin, tempMax);
    if (advice) info.dressAdvice = advice;
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

  // 空气质量:另一个 Open-Meteo 主机,可用性独立于主预报,失败只记警告
  if (wcfg.airQuality !== false) {
    try {
      const url =
        'https://air-quality-api.open-meteo.com/v1/air-quality' +
        `?latitude=${wcfg.latitude}&longitude=${wcfg.longitude}` +
        '&current=pm2_5,pm10&timezone=auto';
      const resp = await httpGetJson<AirQualityResp>(url, { timeoutMs: 15000 });
      const pm25 = resp.current?.pm2_5;
      if (typeof pm25 === 'number' && Number.isFinite(pm25)) {
        const air: AirQuality = { pm25: Math.round(pm25 * 10) / 10, level: pm25Level(pm25) };
        const pm10 = resp.current?.pm10;
        if (typeof pm10 === 'number' && Number.isFinite(pm10)) air.pm10 = Math.round(pm10 * 10) / 10;
        info.air = air;
      } else {
        resultWarnings.push('空气质量获取失败: 响应缺少 PM2.5');
      }
    } catch (err) {
      resultWarnings.push(`空气质量获取失败: ${errText(err)}`);
    }
  }

  return {
    ok: true,
    data: { weather: info },
    ...(resultWarnings.length > 0 ? { warnings: resultWarnings } : {}),
  };
}
