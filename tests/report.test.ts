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
    biliHot: [],
    personal: { anniversaries: [], certs: [] },
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

  it('GitHub 新项目榜区块:序号、星数紧凑格式与链接', () => {
    const ctx = baseCtx({
      hasContent: true,
      discoveries: [{
        repo: 'cn/cool', url: 'https://github.com/cn/cool', stars: 3210,
        language: 'TypeScript', description: '很酷的<b>项目', createdAt: '2026-09-10T00:00:00Z',
      }],
    });
    const { text, html } = renderReport(ctx);
    expect(text).toContain('▌🚀 GitHub 新项目榜 · 1 条');
    expect(text).toContain('1. cn/cool  ⭐ 3.2k · TypeScript');
    expect(text).toContain('  很酷的<b>项目');
    expect(html).toContain('<a href="https://github.com/cn/cool">cn/cool</a>');
    expect(html).toContain('<blockquote>很酷的&lt;b&gt;项目</blockquote>');
  });

  it('活跃度行:有提交/issue/得分时展示,缺失时整行省略', () => {
    const withAct = renderReport(baseCtx({
      hasContent: true,
      discoveries: [{
        repo: 'cn/cool', url: 'https://github.com/cn/cool', stars: 3210,
        description: '项目', createdAt: '2026-09-10T00:00:00Z',
        commits: 64, issues: 5, score: 66.91,
      }],
    }));
    expect(withAct.text).toContain('  提交 64 · issue 5 · 得分 66.9');
    expect(withAct.html).toContain('提交 64 · issue 5 · 得分 66.9');

    // 没配 token / 接口失败时不该显示"提交 0"这种假数据
    const noAct = renderReport(baseCtx({
      hasContent: true,
      discoveries: [{
        repo: 'cn/cool', url: 'https://github.com/cn/cool', stars: 3210,
        description: '项目', createdAt: '2026-09-10T00:00:00Z',
      }],
    }));
    expect(noAct.text).not.toContain('提交');
    expect(noAct.text).not.toContain('得分');
  });

  it('榜单按传入顺序编号(数据层已按得分排序)', () => {
    const { text } = renderReport(baseCtx({
      hasContent: true,
      discoveries: [
        { repo: 'a/one', url: 'https://github.com/a/one', stars: 100, createdAt: '2026-09-10T00:00:00Z', score: 90 },
        { repo: 'b/two', url: 'https://github.com/b/two', stars: 900, createdAt: '2026-09-10T00:00:00Z', score: 40 },
      ],
    }));
    const lines = text.split('\n');
    const one = lines.findIndex((l) => l.startsWith('1. a/one'));
    const two = lines.findIndex((l) => l.startsWith('2. b/two'));
    expect(one).toBeGreaterThan(-1);
    expect(two).toBeGreaterThan(one);
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

/* ---------------- 新增区块:天气增强 / B 站热搜 / 个人提醒 ---------------- */

describe('天气增强行', () => {
  const weatherBase = {
    locationName: '示例城市', description: '多云', emoji: '☁️',
    tempMin: 20, tempMax: 29, warnings: [], source: 'open-meteo',
  };

  it('空气质量:带 PM2.5/PM10 与等级词', () => {
    const { text } = renderReport(baseCtx({
      hasContent: true,
      weather: { ...weatherBase, air: { pm25: 68.2, pm10: 95.4, level: '良' } },
    }));
    expect(text).toContain('😷 空气 良（PM2.5 68.2 · PM10 95.4）');
  });

  it('只有 PM2.5 时不显示 PM10 段', () => {
    const { text } = renderReport(baseCtx({
      hasContent: true,
      weather: { ...weatherBase, air: { pm25: 12, level: '优' } },
    }));
    expect(text).toContain('😷 空气 优（PM2.5 12）');
    expect(text).not.toContain('PM10');
  });

  it('有逐小时时段时优先展示时段,不再单列概率', () => {
    const { text } = renderReport(baseCtx({
      hasContent: true,
      weather: {
        ...weatherBase,
        precipitationProb: 60,
        rainWindows: [
          { start: '14:00', end: '16:00', maxProb: 75 },
          { start: '20:00', end: '20:00', maxProb: 40 },
        ],
      },
    }));
    expect(text).toContain('🌧 有雨时段:14:00~16:00 最高 75%、20:00~20:00 最高 40%');
    expect(text).not.toContain('💧 降水概率');
  });

  it('没有时段数据时退回原来的降水概率行', () => {
    const { text } = renderReport(baseCtx({
      hasContent: true,
      weather: { ...weatherBase, precipitationProb: 40 },
    }));
    expect(text).toContain('💧 降水概率 40%');
    expect(text).not.toContain('有雨时段');
  });

  it('日出日落与紫外线合并成一行', () => {
    const { text } = renderReport(baseCtx({
      hasContent: true,
      weather: { ...weatherBase, sunrise: '05:54', sunset: '18:17', uvIndexMax: 5.7 },
    }));
    expect(text).toContain('🌅 日出 05:54 · 日落 18:17 · 紫外线 5.7');
  });

  it('穿衣建议单独一行', () => {
    const { text } = renderReport(baseCtx({
      hasContent: true,
      weather: { ...weatherBase, dressAdvice: '舒适,长袖或薄外套' },
    }));
    expect(text).toContain('👕 舒适,长袖或薄外套');
  });

  it('增强字段全部缺失时,天气区块保持原样(不出现空行)', () => {
    const { text } = renderReport(baseCtx({ hasContent: true, weather: weatherBase }));
    expect(text).not.toContain('😷');
    expect(text).not.toContain('日出'); // 不要断言 🌅:天气区块标题自带的 🌤 会误伤
    expect(text).not.toContain('👕');
    expect(text).not.toContain('有雨时段');
  });
});

describe('B 站热搜区块', () => {
  it('独立成块,带热度值与 [新] 标记', () => {
    const { text, html } = renderReport(baseCtx({
      hasContent: true,
      biliHot: [
        { rank: 1, word: '长庚伴月', heat: 1226970, isNew: true },
        { rank: 2, word: 'LPL总决赛', heat: 8600 },
      ],
    }));
    expect(text).toContain('▌📺 B 站热搜 · 2 条');
    expect(text).toContain('1. 🆕 长庚伴月  🔥122.7万');
    expect(text).toContain('2. LPL总决赛  🔥8600');
    expect(html).toContain('<b>📺 B 站热搜 · 2 条</b>');
  });

  it('无热度值时不显示热度段', () => {
    const { text } = renderReport(baseCtx({
      hasContent: true,
      biliHot: [{ rank: 1, word: '某词条' }],
    }));
    expect(text).toContain('1. 某词条');
    expect(text).not.toContain('🔥');
  });

  it('百度热搜与 B 站热搜是两个独立区块', () => {
    const { text } = renderReport(baseCtx({
      hasContent: true,
      hotItems: [{ rank: 1, word: '百度词条' }],
      biliHot: [{ rank: 1, word: 'B站词条' }],
    }));
    expect(text).toContain('▌🔥 百度热搜 · 1 条');
    expect(text).toContain('▌📺 B 站热搜 · 1 条');
  });
});

describe('个人提醒区块', () => {
  it('纪念日:今天 / 还有 N 天 / 周年', () => {
    const { text } = renderReport(baseCtx({
      hasContent: true,
      personal: {
        anniversaries: [
          { name: '生日', date: '1998-09-15', daysLeft: 0, nextDate: '2026-09-15', years: 28 },
          { name: '结婚纪念', date: '2020-10-10', daysLeft: 25, nextDate: '2026-10-10', years: 6 },
        ],
        certs: [],
      },
    }));
    expect(text).toContain('▌🎯 提醒 · 2 条');
    expect(text).toContain('🎂 生日 就是今天（2026-09-15 · 28 周年）');
    expect(text).toContain('🎂 结婚纪念 还有 25 天（2026-10-10 · 6 周年）');
  });

  it('首年不显示周年数', () => {
    const { text } = renderReport(baseCtx({
      hasContent: true,
      personal: {
        anniversaries: [{ name: '入职', date: '2026-09-20', daysLeft: 5, nextDate: '2026-09-20' }],
        certs: [],
      },
    }));
    expect(text).toContain('🎂 入职 还有 5 天（2026-09-20）');
    expect(text).not.toContain('周年');
  });

  it('证书:正常 / 今天到期 / 已过期三种措辞', () => {
    const { text } = renderReport(baseCtx({
      hasContent: true,
      personal: {
        anniversaries: [],
        certs: [
          { name: '主站', host: 'a.com', validTo: '2026-10-10', daysLeft: 25 },
          { name: '博客', host: 'b.com', validTo: '2026-09-15', daysLeft: 0 },
          { name: '旧站', host: 'c.com', validTo: '2026-09-10', daysLeft: -5 },
        ],
      },
    }));
    expect(text).toContain('🔒 主站 证书还有 25 天到期（2026-10-10）');
    expect(text).toContain('🔒 博客 证书今天到期（2026-09-15）');
    expect(text).toContain('🔒 旧站 证书已过期 5 天（2026-09-10）');
  });

  it('两块都为空时不渲染该区块', () => {
    const { text } = renderReport(baseCtx({
      hasContent: true,
      hotItems: [{ rank: 1, word: 'x' }],
      personal: { anniversaries: [], certs: [] },
    }));
    expect(text).not.toContain('🎯');
  });
});
