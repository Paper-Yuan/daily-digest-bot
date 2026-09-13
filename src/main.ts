/**
 * 主编排器:配置 → 并发抓取(单源故障降级)→ 渲染 → 多渠道推送 → 状态落盘。
 *
 * 退出码约定:
 *  - 0:推送成功(或 dry-run);
 *  - 1:所有真实渠道都发送失败 —— 此时状态不落盘,下次运行会重推本批内容,
 *       配合 GitHub Actions 的失败告警,用户能感知到异常。
 */

import * as path from 'path';
import { loadConfig } from './config';
import { loadState, saveStateAtomic } from './utils/state';
import { zonedParts, zhWeekday, pad2 } from './utils/date';
import type {
  BotConfig,
  BotState,
  BaiduHotSection,
  CalendarSection,
  FetchContext,
  GithubSection,
  ModuleName,
  ModuleResult,
  ReportContext,
  ReportFailure,
  RssSection,
  SectionPayload,
  WeatherSection,
} from './types';
import { fetchWeather } from './modules/weather';
import { fetchCalendar } from './modules/calendar';
import { fetchGithub } from './modules/github';
import { fetchRss } from './modules/rss';
import { fetchBaiduHot } from './modules/baiduhot';
import { renderReport } from './render/report';
import { sendConsole } from './notify/console';
import { sendTelegram } from './notify/telegram';
import { sendFeishu } from './notify/feishu';

interface CliArgs {
  dryRun: boolean;
  force: boolean;
  only?: string[];
  configPath?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force') args.force = true;
    else if (a === '--only') args.only = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--only=')) args.only = a.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--config') args.configPath = argv[++i];
    else if (a.startsWith('--config=')) args.configPath = a.slice('--config='.length);
  }
  return args;
}

/** 兜底保险:即使某个模块意外抛错,也降级为该模块失败而不是整个任务崩溃 */
async function safeRun(fn: () => Promise<ModuleResult<SectionPayload>>): Promise<ModuleResult<SectionPayload>> {
  try {
    return await fn();
  } catch (err) {
    return { ok: false, data: null, error: `意外异常: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** 把启用渠道的发送动作聚合成"至少一个成功才算成功"的结果列表 */
async function sendToChannels(
  cfg: BotConfig,
  msg: { text: string; html: string },
): Promise<{ attempted: number; okCount: number }> {
  const env = process.env;
  const attempts: { name: string; run: () => Promise<void> }[] = [];

  const tg = cfg.notify.telegram?.enabled;
  if (tg !== false) {
    const botToken = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    if (botToken && chatId) {
      attempts.push({ name: 'telegram', run: () => sendTelegram(msg, { botToken, chatId }) });
    } else if (tg === true) {
      attempts.push({
        name: 'telegram',
        run: async () => { throw new Error('已强制启用 telegram,但缺少环境变量 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID'); },
      });
    }
  }

  const fs = cfg.notify.feishu?.enabled;
  if (fs !== false) {
    const webhookUrl = env.FEISHU_WEBHOOK_URL;
    if (webhookUrl) {
      attempts.push({ name: 'feishu', run: () => sendFeishu(msg, { webhookUrl, secret: env.FEISHU_SECRET }) });
    } else if (fs === true) {
      attempts.push({
        name: 'feishu',
        run: async () => { throw new Error('已强制启用 feishu,但缺少环境变量 FEISHU_WEBHOOK_URL'); },
      });
    }
  }

  const results = await Promise.all(
    attempts.map(async (a) => ({
      name: a.name,
      ok: await a.run().then(
        () => true,
        (err) => {
          console.error(`[notify:${a.name}] 发送失败: ${err instanceof Error ? err.message : String(err)}`);
          return false;
        },
      ),
    })),
  );
  return { attempted: attempts.length, okCount: results.filter((r) => r.ok).length };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const configPath = args.configPath ?? process.env.CONFIG_PATH ?? path.resolve('config/config.yaml');
  const cfg = loadConfig(configPath);

  const now = new Date();
  const savedState = loadState(path.resolve(cfg.statePath));
  // 深拷贝成草稿:模块只在草稿上记去重游标,推送成功才落盘
  const draft: BotState = structuredClone(savedState);
  const ctx: FetchContext = { cfg, state: draft, now, force: args.force };

  const only = args.only;
  const wanted = (name: ModuleName) => !only || only.includes(name);

  const runners: { name: ModuleName; run: () => Promise<ModuleResult<SectionPayload>> }[] = [];
  if (wanted('weather') && cfg.weather.enabled !== false) runners.push({ name: 'weather', run: () => fetchWeather(ctx) });
  if (wanted('calendar') && cfg.calendar.enabled !== false) runners.push({ name: 'calendar', run: () => fetchCalendar(ctx) });
  if (wanted('github') && cfg.github.enabled !== false) runners.push({ name: 'github', run: () => fetchGithub(ctx) });
  if (wanted('rss') && cfg.rss.enabled !== false) runners.push({ name: 'rss', run: () => fetchRss(ctx) });
  if (wanted('baiduhot') && cfg.baiduhot?.enabled !== false) runners.push({ name: 'baiduhot', run: () => fetchBaiduHot(ctx) });

  // 四个信息源并发抓取,互不阻塞
  const results = await Promise.all(runners.map(async (r) => ({ name: r.name, res: await safeRun(r.run) })));

  const byName = new Map(results.map((r) => [r.name, r.res]));
  const failures: ReportFailure[] = [];
  for (const r of results) {
    if (!r.res.ok && r.res.error) failures.push({ module: r.name, message: r.res.error });
    for (const w of r.res.warnings ?? []) failures.push({ module: r.name, message: w });
  }

  const limits = cfg.limits;
  const weather = (byName.get('weather')?.data as WeatherSection | undefined)?.weather;
  const calendar = (byName.get('calendar')?.data as CalendarSection | undefined)?.events ?? [];
  const releases = ((byName.get('github')?.data as GithubSection | undefined)?.releases ?? [])
    .slice(0, limits.maxReleases ?? 8);
  const rss = ((byName.get('rss')?.data as RssSection | undefined)?.items ?? [])
    .slice(0, limits.maxRssItems ?? 10);
  const hotItems = (byName.get('baiduhot')?.data as BaiduHotSection | undefined)?.items ?? [];
  const discoveries = (byName.get('github')?.data as GithubSection | undefined)?.discoveries ?? [];

  const zp = zonedParts(now, cfg.timezone);
  // 早报(08:00 定时)/晚报(21:00 定时):以运行时刻的本地时间判定
  const isEvening = zp.hour >= 12;
  const reportCtx: ReportContext = {
    reportKind: isEvening ? 'evening' : 'morning',
    greeting: `${isEvening ? '晚上好' : '早上好'}${cfg.user?.name ? `，${cfg.user.name}` : ''}`,
    dateLabel: `${zp.year}-${pad2(zp.month)}-${pad2(zp.day)} ${zhWeekday(zp.weekday)}`,
    timeLabel: `${pad2(zp.hour)}:${pad2(zp.minute)}`,
    weather,
    calendar: calendar.slice(0, limits.maxCalendarEvents ?? 10),
    releases,
    discoveries,
    rss,
    hotItems,
    failures,
    hasContent: Boolean(weather)
      || calendar.length > 0
      || releases.length > 0
      || discoveries.length > 0
      || rss.length > 0
      || hotItems.length > 0,
  };

  const msg = renderReport(reportCtx);
  // 控制台渠道永远输出:本地调试与 CI 日志排查都靠它
  await sendConsole(msg);

  if (args.dryRun) {
    console.log('\n[dry-run] 仅预览,未推送、状态未写入。');
    return;
  }

  const { attempted, okCount } = await sendToChannels(cfg, msg);
  if (okCount > 0) {
    saveStateAtomic(path.resolve(cfg.statePath), draft);
    console.log(`\n推送成功 ${okCount}/${attempted} 个渠道,状态已写入 ${cfg.statePath}`);
  } else if (attempted > 0) {
    // 全部失败:不落盘,下次运行重推同一批内容
    console.error('\n所有渠道均发送失败,状态未写入,下次运行将重试本批内容。');
    process.exitCode = 1;
  } else {
    // 没配置任何真实渠道(仅控制台):照常落盘,避免之后重复推送
    saveStateAtomic(path.resolve(cfg.statePath), draft);
    console.log(`\n未配置真实推送渠道(仅控制台输出),状态已写入 ${cfg.statePath}`);
  }
}

main().catch((err) => {
  console.error('早报任务失败:', err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
});
