/**
 * 主编排器:配置 → 发布锁 → 并发抓取(单源故障降级)→ 渲染(文本+图片)→ 多渠道推送 → 状态落盘。
 *
 * 三种报告:
 *  早报/晚报  定时触发,启用发布锁(cron 提前启动,等到目标时刻精确发布 + 当日幂等)
 *  快报       手动/API 即时触发,**快照语义**:展示当前内容但绝不写去重状态
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
  BiliHotSection,
  CalendarSection,
  FetchContext,
  GithubSection,
  LimitsConfig,
  ModuleName,
  ModuleResult,
  PersonalSection,
  ReportContext,
  ReportFailure,
  ReportKind,
  RssSection,
  SectionPayload,
  WeatherSection,
} from './types';
import {
  alreadySentToday,
  markSent,
  parseHm,
  slotForHour,
  targetTime,
  waitMillis,
} from './schedule';
import { fetchWeather } from './modules/weather';
import { fetchCalendar } from './modules/calendar';
import { fetchGithub } from './modules/github';
import { fetchRss } from './modules/rss';
import { fetchBaiduHot } from './modules/baiduhot';
import { fetchBiliHot } from './modules/bilibili';
import { fetchPersonal } from './modules/personal';
import { renderReport } from './render/report';
import { renderReportImage } from './render/image';
import { sendConsole } from './notify/console';
import { sendTelegram } from './notify/telegram';
import { sendFeishu } from './notify/feishu';

interface CliArgs {
  dryRun: boolean;
  force: boolean;
  only?: string[];
  configPath?: string;
  /** CI 定时调用:启用发布锁(等待到点 + 当日幂等) */
  scheduled: boolean;
  /** 随时快报:快照语义,不写去重状态 */
  quick: boolean;
  /** 跳过图片生成 */
  noImage: boolean;
  /** 仅本次覆盖目标发布时间,调试用 */
  at?: string;
  /** 手动指定报告类型(覆盖按运行时刻的自动判定),用于 Actions 手动选择早报/晚报 */
  kind?: 'morning' | 'evening';
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    dryRun: false,
    force: false,
    scheduled: false,
    quick: false,
    noImage: false,
  };
  const takeValue = (a: string, prefix: string, next: () => string | undefined): string | undefined =>
    a.startsWith(`${prefix}=`) ? a.slice(prefix.length + 1) : next();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force') args.force = true;
    else if (a === '--scheduled') args.scheduled = true;
    else if (a === '--quick') args.quick = true;
    else if (a === '--no-image') args.noImage = true;
    else if (a === '--only' || a.startsWith('--only=')) {
      args.only = (takeValue(a, '--only', () => argv[++i]) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--config' || a.startsWith('--config=')) {
      args.configPath = takeValue(a, '--config', () => argv[++i]);
    } else if (a === '--at' || a.startsWith('--at=')) {
      args.at = takeValue(a, '--at', () => argv[++i]);
    } else if (a === '--kind' || a.startsWith('--kind=')) {
      const v = takeValue(a, '--kind', () => argv[++i]);
      if (v === 'morning' || v === 'evening') args.kind = v;
      else console.error(`[args] 忽略无法识别的 --kind 值:"${v}"(仅支持 morning / evening)`);
    }
  }
  return args;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  image: Buffer | null,
): Promise<{ attempted: number; okCount: number }> {
  const env = process.env;
  const attempts: { name: string; run: () => Promise<void> }[] = [];

  const tg = cfg.notify.telegram?.enabled;
  if (tg !== false) {
    const botToken = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    if (botToken && chatId) {
      attempts.push({ name: 'telegram', run: () => sendTelegram(msg, { botToken, chatId }, image) });
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
      attempts.push({ name: 'feishu', run: () => sendFeishu(msg, { webhookUrl, secret: env.FEISHU_SECRET }, image) });
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

/** 发布锁:等待到目标时刻。返回 false 表示"今日已发送,应跳过本次" */
async function applyPublishLock(
  cfg: BotConfig,
  savedState: BotState,
  args: CliArgs,
  kind: ReportKind,
  now: Date,
  tz: string,
  todayYmd: string,
): Promise<boolean> {
  // 快报即时响应,不受发布锁约束
  if (kind === 'quick') return true;

  // 时段以实际要发的报告类型为准(--kind 覆盖时也一致),避免手动指定晚报却按早报时段去重
  const slot = kind;

  if (!args.force && alreadySentToday(savedState, slot, todayYmd)) {
    console.log(`[lock] 今日${slot === 'morning' ? '早报' : '晚报'}已成功发送过,跳过本次(如需强制重发请加 --force)`);
    return false;
  }

  const target = args.at ?? cfg.schedule?.[slot];
  if (cfg.schedule?.lockTime !== true) {
    // 未启用发布锚:cron 定在目标时刻直接发送,接受 GitHub 排队带来的到达时间波动
    console.log(`[lock] 未启用发布锚(lockTime=false),立即发送`);
    return true;
  }

  const hm = target ? parseHm(target) : null;
  if (!hm) {
    if (target) console.error(`[lock] 目标时间 "${target}" 无法解析,立即发送`);
    return true;
  }

  const targetAt = targetTime(hm, now, tz);
  const maxWaitMs = (cfg.schedule?.maxWaitMinutes ?? 30) * 60_000;
  const wait = waitMillis(now, targetAt, maxWaitMs);
  if (wait === null) {
    console.log(`[lock] 距离目标时刻 ${target} 超过等待上限 ${maxWaitMs / 60_000} 分钟,放弃等待,立即发送`);
    return true;
  }
  if (wait > 0) {
    console.log(`[lock] 等待 ${(wait / 60_000).toFixed(1)} 分钟,计划于 ${target}(${tz}) 发布`);
    await sleep(wait);
  } else {
    console.log(`[lock] 已到目标时刻 ${target},立即发送`);
  }
  return true;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const configPath = args.configPath ?? process.env.CONFIG_PATH ?? path.resolve('config/config.yaml');
  const cfg = loadConfig(configPath);

  const now = new Date();
  const zp = zonedParts(now, cfg.timezone);
  const todayYmd = `${zp.year}-${pad2(zp.month)}-${pad2(zp.day)}`;
  const kind: ReportKind = args.quick
    ? 'quick'
    : args.kind ?? (slotForHour(zp.hour) === 'morning' ? 'morning' : 'evening');

  const savedState = loadState(path.resolve(cfg.statePath));

  // 发布锁仅在定时运行时生效(手动/本地/快报都不等待)
  if (args.scheduled) {
    const go = await applyPublishLock(cfg, savedState, args, kind, now, cfg.timezone, todayYmd);
    if (!go) return;
  }

  // 快报是快照语义:忽略去重展示当前内容,且运行结束后**丢弃**所有状态改动,
  // 避免"下午发个快报把新内容标记成已读,第二天早报就空了"
  const isSnapshot = args.quick;
  const draft: BotState = structuredClone(savedState);
  const ctx: FetchContext = {
    cfg,
    state: draft,
    now,
    force: args.force || isSnapshot,
    reportKind: kind,
  };

  const only = args.only;
  const wanted = (name: ModuleName) => !only || only.includes(name);

  const runners: { name: ModuleName; run: () => Promise<ModuleResult<SectionPayload>> }[] = [];
  if (wanted('weather') && cfg.weather.enabled !== false) runners.push({ name: 'weather', run: () => fetchWeather(ctx) });
  if (wanted('calendar') && cfg.calendar.enabled !== false) runners.push({ name: 'calendar', run: () => fetchCalendar(ctx) });
  if (wanted('github') && cfg.github.enabled !== false) runners.push({ name: 'github', run: () => fetchGithub(ctx) });
  if (wanted('rss') && cfg.rss.enabled !== false) runners.push({ name: 'rss', run: () => fetchRss(ctx) });
  if (wanted('baiduhot') && cfg.baiduhot?.enabled !== false) runners.push({ name: 'baiduhot', run: () => fetchBaiduHot(ctx) });
  if (wanted('bilibili') && cfg.bilibili?.enabled === true) runners.push({ name: 'bilibili', run: () => fetchBiliHot(ctx) });
  if (wanted('personal') && cfg.personal?.enabled === true) runners.push({ name: 'personal', run: () => fetchPersonal(ctx) });

  // 各信息源并发抓取,互不阻塞
  const results = await Promise.all(runners.map(async (r) => ({ name: r.name, res: await safeRun(r.run) })));

  const byName = new Map(results.map((r) => [r.name, r.res]));
  const failures: ReportFailure[] = [];
  for (const r of results) {
    if (!r.res.ok && r.res.error) failures.push({ module: r.name, message: r.res.error });
    for (const w of r.res.warnings ?? []) failures.push({ module: r.name, message: w });
  }

  // 快报用更精简的条数上限(quick.limits 覆盖 limits 的同名字段)
  const limits: LimitsConfig = isSnapshot
    ? { ...cfg.limits, ...(cfg.quick?.limits ?? {}) }
    : cfg.limits;

  const weather = (byName.get('weather')?.data as WeatherSection | undefined)?.weather;
  const calendar = (byName.get('calendar')?.data as CalendarSection | undefined)?.events ?? [];
  const releases = ((byName.get('github')?.data as GithubSection | undefined)?.releases ?? [])
    .slice(0, limits.maxReleases ?? 8);
  const rss = ((byName.get('rss')?.data as RssSection | undefined)?.items ?? [])
    .slice(0, limits.maxRssItems ?? 10);
  const hotItems = (byName.get('baiduhot')?.data as BaiduHotSection | undefined)?.items ?? [];
  const biliHot = (byName.get('bilibili')?.data as BiliHotSection | undefined)?.items ?? [];
  const personal = (byName.get('personal')?.data as PersonalSection | undefined) ?? { anniversaries: [], certs: [] };
  const discoveries = (byName.get('github')?.data as GithubSection | undefined)?.discoveries ?? [];
  const hotLimited = limits.maxHotItems ? hotItems.slice(0, limits.maxHotItems) : hotItems;
  const biliLimited = limits.maxBiliItems ? biliHot.slice(0, limits.maxBiliItems) : biliHot;

  const greetingBase = kind === 'morning' ? '早上好' : kind === 'evening' ? '晚上好' : '你好';
  const reportCtx: ReportContext = {
    reportKind: kind,
    greeting: `${greetingBase}${cfg.user?.name ? `，${cfg.user.name}` : ''}`,
    dateLabel: `${zp.year}-${pad2(zp.month)}-${pad2(zp.day)} ${zhWeekday(zp.weekday)}`,
    timeLabel: `${pad2(zp.hour)}:${pad2(zp.minute)}`,
    weather,
    calendar: calendar.slice(0, limits.maxCalendarEvents ?? 10),
    releases,
    discoveries,
    rss,
    hotItems: hotLimited,
    biliHot: biliLimited,
    personal,
    failures,
    hasContent: Boolean(weather)
      || calendar.length > 0
      || releases.length > 0
      || discoveries.length > 0
      || rss.length > 0
      || hotLimited.length > 0
      || biliLimited.length > 0
      || personal.anniversaries.length > 0
      || personal.certs.length > 0,
  };

  const msg = renderReport(reportCtx);

  // 图片失败一律降级为纯文本,绝不因此中断推送
  let image: Buffer | null = null;
  if (cfg.image?.enabled !== false && !args.noImage) {
    try {
      image = await renderReportImage(reportCtx, { width: cfg.image?.width });
    } catch (err) {
      console.error(`[image] 生成失败,降级为纯文本: ${err instanceof Error ? err.message : String(err)}`);
      image = null;
    }
    if (image) console.log(`[image] 已生成报告图片(${(image.length / 1024).toFixed(1)} KB)`);
    else console.log('[image] 未生成图片,本次仅发送文本报告');
  }

  // 控制台渠道永远输出:本地调试与 CI 日志排查都靠它
  await sendConsole(msg, image);

  if (args.dryRun) {
    console.log('\n[dry-run] 仅预览,未推送、状态未写入。');
    return;
  }

  const { attempted, okCount } = await sendToChannels(cfg, msg, image);
  const slot = kind === 'quick' ? null : kind;
  if (okCount > 0) {
    // 快报是快照:不写状态,不占用早晚报的去重游标
    if (isSnapshot) {
      console.log(`\n快报已推送 ${okCount}/${attempted} 个渠道(快照语义,未写入去重状态)`);
    } else {
      // 仅定时运行记录"当日已发":手动运行不记录,保证你手动触发后当天定时仍会正常送达
      if (slot && args.scheduled) markSent(draft, slot, todayYmd);
      saveStateAtomic(path.resolve(cfg.statePath), draft);
      console.log(`\n推送成功 ${okCount}/${attempted} 个渠道,状态已写入 ${cfg.statePath}`);
    }
  } else if (attempted > 0) {
    // 全部失败:不落盘,下次运行重推同一批内容
    console.error('\n所有渠道均发送失败,状态未写入,下次运行将重试本批内容。');
    process.exitCode = 1;
  } else {
    // 没配置任何真实渠道(仅控制台):照常落盘,避免之后重复推送
    if (!isSnapshot) {
      if (slot && args.scheduled) markSent(draft, slot, todayYmd);
      saveStateAtomic(path.resolve(cfg.statePath), draft);
      console.log(`\n未配置真实推送渠道(仅控制台输出),状态已写入 ${cfg.statePath}`);
    }
  }
}

main().catch((err) => {
  console.error('报告任务失败:', err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
});
