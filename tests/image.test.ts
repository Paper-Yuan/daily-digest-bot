/**
 * 图片渲染测试:PNG 产出、关闭开关、空 ctx / 超长文本的健壮性。
 *
 * 说明:中文字体走三级回退(本地缓存 → CDN)。测试要求可跑在无网络环境,
 * 若当前环境既无本地字体也无网络,则渲染按契约返回 null;
 * 此时"需要真实出图"的用例用 it.skipIf 跳过,其余健壮性用例仍会执行。
 */

import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderReportImage } from '../src/render/image';
import type { ReportContext } from '../src/types';

/** 探测运行环境是否具备出图条件(canvas 可用 + 有本地字体缓存) */
function canvasAvailable(): boolean {
  try {
    require('@napi-rs/canvas');
    return true;
  } catch {
    return false;
  }
}

function localFontAvailable(): boolean {
  const envPath = process.env.DIGEST_FONT_PATH;
  if (envPath && fs.existsSync(envPath)) return true;
  try {
    return fs
      .readdirSync(path.resolve('data/fonts'))
      .some((f) => /\.(woff2?|ttf|otf)$/i.test(f));
  } catch {
    return false;
  }
}

const canRender = canvasAvailable() && localFontAvailable();

function baseCtx(over: Partial<ReportContext> = {}): ReportContext {
  return {
    reportKind: 'morning',
    greeting: '早上好，测试用户',
    dateLabel: '2026-09-14 星期日',
    timeLabel: '08:00',
    calendar: [],
    releases: [],
    discoveries: [],
    rss: [],
    hotItems: [],
    failures: [],
    hasContent: false,
    ...over,
  };
}

const LONG_CN = '这是一段用于测试自动折行的超长中文描述，需要保证不会溢出画布也不会抛异常。'.repeat(10);

let savedDisable: string | undefined;
beforeEach(() => {
  savedDisable = process.env.DIGEST_DISABLE_IMAGE;
});
afterEach(() => {
  if (savedDisable === undefined) delete process.env.DIGEST_DISABLE_IMAGE;
  else process.env.DIGEST_DISABLE_IMAGE = savedDisable;
});

describe('renderReportImage', () => {
  it.skipIf(!canRender)('正常渲染返回 PNG Buffer 且魔数正确', async () => {
    const out = await renderReportImage(
      baseCtx({
        hasContent: true,
        weather: {
          locationName: '示例城市',
          description: '多云转阴',
          emoji: '☁️',
          tempMin: 22,
          tempMax: 31,
          tempNow: 28.8,
          precipitationProb: 51,
          warnings: [{ title: '暴雨橙色预警', detail: '局部大暴雨' }],
          source: 'open-meteo',
        },
        calendar: [
          { title: '高等数学', start: '08:00', end: '09:40', location: '教三-101', teacher: '张老师', source: '课表', tag: '第 2 周' },
        ],
        hotItems: [
          { rank: 1, word: '热搜词条甲' },
          { rank: 2, word: '新上榜词条', isNew: true },
        ],
        discoveries: [
          { repo: 'cn/cool', url: 'https://github.com/cn/cool', stars: 3210, language: 'TypeScript', description: '很酷的项目', createdAt: '2026-09-10T00:00:00Z' },
        ],
        releases: [
          { repo: 'microsoft/TypeScript', tagName: 'v5.6.0', publishedAt: '2026-09-13T10:00:00Z', url: 'https://github.com/microsoft/TypeScript/releases/tag/v5.6.0', prerelease: false, summary: '修复若干问题' },
        ],
        rss: [{ feedTitle: '阮一峰', title: '周刊第 1 期', link: 'https://example.com/1', summary: '内容摘要' }],
        failures: [{ module: 'weather', message: '请求超时' }],
      }),
      { width: 720 },
    );

    expect(out).not.toBeNull();
    const buf = out as Buffer;
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(10 * 1024);
    expect([buf[0], buf[1], buf[2], buf[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('DIGEST_DISABLE_IMAGE=1 时返回 null', async () => {
    process.env.DIGEST_DISABLE_IMAGE = '1';
    const out = await renderReportImage(
      baseCtx({
        hasContent: true,
        weather: { locationName: '示例城市', description: '晴', emoji: '☀️', tempMin: 20, tempMax: 30, warnings: [], source: 'x' },
      }),
    );
    expect(out).toBeNull();
  });

  it('极端空 ctx 不抛异常', async () => {
    const out = await renderReportImage(baseCtx());
    expect(out === null || Buffer.isBuffer(out)).toBe(true);
  });

  it('超长中文描述不会让函数抛错', async () => {
    const out = await renderReportImage(
      baseCtx({
        hasContent: true,
        weather: {
          locationName: '超长测试城市名称超长测试城市名称',
          description: LONG_CN,
          emoji: '☁️',
          tempMin: 20,
          tempMax: 30,
          precipitationProb: 80,
          warnings: [{ title: LONG_CN, detail: LONG_CN }],
          source: 'x',
        },
        calendar: [{ title: LONG_CN, start: '全天', source: '课表' }],
        hotItems: [{ rank: 1, word: LONG_CN, isNew: true }],
        rss: [{ feedTitle: LONG_CN, title: LONG_CN, link: `https://example.com/${'a'.repeat(200)}`, summary: LONG_CN }],
      }),
      { width: 640 },
    );
    expect(out === null || Buffer.isBuffer(out)).toBe(true);
    if (Buffer.isBuffer(out)) expect(out.length).toBeGreaterThan(0);
  });
});
