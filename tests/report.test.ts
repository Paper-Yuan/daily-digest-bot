/** 早报渲染:text/html 双版式、转义、空内容版 */

import { describe, expect, it } from 'vitest';
import { escapeHtml, renderReport } from '../src/render/report';
import type { ReportContext } from '../src/types';

function baseCtx(over: Partial<ReportContext> = {}): ReportContext {
  return {
    reportKind: 'morning',
    greeting: '早上好，同学',
    dateLabel: '2026-09-13 星期日',
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

describe('renderReport', () => {
  it('包含各区块、计数与格式化细节', () => {
    const ctx = baseCtx({
      hasContent: true,
      weather: {
        locationName: '北京', description: '多云', emoji: '☁️',
        tempMin: 22, tempMax: 29, tempNow: 23.4, precipitationProb: 40,
        warnings: [{ title: '暴雨橙色预警', detail: '局部大暴雨' }],
        source: 'open-meteo',
      },
      calendar: [
        { title: '中秋假期', start: '全天', source: '日历' },
        { title: '高等数学', start: '08:00', end: '09:40', location: '教三-101', source: '课表', tag: '第 1 周' },
      ],
      releases: [{
        repo: 'microsoft/TypeScript', tagName: 'v5.6.0',
        publishedAt: '2026-09-12T10:00:00Z',
        url: 'https://github.com/microsoft/TypeScript/releases/tag/v5.6.0',
        prerelease: false, summary: '修复若干问题',
      }],
      rss: [{ feedTitle: '阮一峰', title: '周刊第 1 期', link: 'https://example.com/1', summary: '内容摘要' }],
    });

    const { text, html } = renderReport(ctx);
    expect(text).toContain('🌅 早报 · 2026-09-13 星期日 08:00');
    expect(text).toContain('早上好，同学！');
    expect(text).toContain('────────────────────');
    expect(text).toContain('▌🌤 天气 · 北京');
    expect(text).toContain('☁️ 多云 ｜ 22 ~ 29°C（当前 23.4°C）');
    expect(text).toContain('💧 降水概率 40%');
    expect(text).toContain('🚨 暴雨橙色预警：局部大暴雨');
    expect(text).toContain('▌📅 今日日程 · 2 条');
    expect(text).toContain('• 全天 中秋假期（日历）');
    expect(text).toContain('• 08:00-09:40 高等数学 @教三-101 · 第 1 周（课表）');
    expect(text).toContain('▌🚀 GitHub 新 Release · 1 条');
    expect(text).toContain('• microsoft/TypeScript v5.6.0');
    expect(text).toContain('https://github.com/microsoft/TypeScript/releases/tag/v5.6.0');
    expect(text).toContain('▌🗞 订阅更新 · 1 条');
    expect(text).toContain('• [阮一峰] 周刊第 1 期');

    expect(html).toContain('<b>🌤 天气 · 北京</b>');
    expect(html).toContain('<a href="https://github.com/microsoft/TypeScript/releases/tag/v5.6.0">原文链接</a>');
    expect(html).toContain('<b>🗞 订阅更新 · 1 条</b>');
    expect(html).toContain('<blockquote>内容摘要</blockquote>');
  });

  it('动态文本中的 HTML 字符被转义,防止标签破坏', () => {
    const ctx = baseCtx({
      hasContent: true,
      rss: [{ feedTitle: 'F', title: 'A<b>c & d', link: 'https://e.com/?a=1&b=2' }],
    });
    const { html } = renderReport(ctx);
    expect(html).toContain('A&lt;b&gt;c &amp; d');
    expect(html).toContain('href="https://e.com/?a=1&amp;b=2"');
    expect(html).not.toContain('<b>c');
  });

  it('空内容渲染"今日无事"版', () => {
    const { text } = renderReport(baseCtx());
    expect(text).toContain('今天没有新内容，一切安好 🌿');
    expect(text).not.toContain('今日日程');
    expect(text).not.toContain('模块故障');
  });

  it('故障区只出现一次且列出模块与原因', () => {
    const withFailure = renderReport(baseCtx({
      hasContent: true,
      failures: [{ module: 'weather', message: '超时' }, { module: 'rss', message: 'HTTP 503' }],
    }));
    expect(withFailure.text).toContain('▌⚠️ 模块故障');
    expect(withFailure.text).toContain('• weather：超时');
    expect(withFailure.text).toContain('• rss：HTTP 503');

    const clean = renderReport(baseCtx({ hasContent: true }));
    expect(clean.text).not.toContain('模块故障');
  });

  it('晚报头部与问候语', () => {
    const { text, html } = renderReport(baseCtx({
      reportKind: 'evening',
      greeting: '晚上好，同学',
      hasContent: true,
      weather: { locationName: '示例城市', description: '阴', emoji: '☁️', tempMin: 20, tempMax: 28, warnings: [], source: 'open-meteo' },
    }));
    expect(text).toContain('🌙 晚报 · 2026-09-13 星期日 08:00');
    expect(text).toContain('晚上好，同学！');
    expect(html).toContain('<b>🌙 晚报</b> ·');
  });

  it('GitHub 高星新项目区块:星数紧凑格式与链接', () => {
    const ctx = baseCtx({
      hasContent: true,
      discoveries: [{
        repo: 'cn/cool', url: 'https://github.com/cn/cool', stars: 3210,
        language: 'TypeScript', description: '很酷的<b>项目', createdAt: '2026-09-10T00:00:00Z',
      }],
    });
    const { text, html } = renderReport(ctx);
    expect(text).toContain('▌🚀 GitHub 高星新项目 · 1 条');
    expect(text).toContain('• cn/cool ⭐ 3.2k · TypeScript');
    expect(text).toContain('  很酷的<b>项目');
    expect(html).toContain('<a href="https://github.com/cn/cool">cn/cool</a>');
    expect(html).toContain('<blockquote>很酷的&lt;b&gt;项目</blockquote>');
  });

  it('百度热搜区块:数字编号、🆕 标记与 html 链接', () => {
    const ctx = baseCtx({
      hasContent: true,
      hotItems: [
        { rank: 1, word: '热搜词条A', url: 'https://m.baidu.com/s?word=A' },
        { rank: 2, word: '热搜<b>词条B', isNew: true },
      ],
    });
    const { text, html } = renderReport(ctx);
    expect(text).toContain('▌🔥 百度热搜 · 2 条');
    expect(text).toContain('1. 热搜词条A');
    expect(text).toContain('2. 🆕 热搜<b>词条B');
    expect(html).toContain('<a href="https://m.baidu.com/s?word=A">热搜词条A</a>');
    expect(html).toContain('🆕 热搜&lt;b&gt;词条B');
  });

  it('escapeHtml 行为', () => {
    expect(escapeHtml('a&b<c>d')).toBe('a&amp;b&lt;c&gt;d');
  });
});
