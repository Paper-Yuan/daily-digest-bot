/**
 * 全局共享类型定义(所有模块的唯一契约来源)。
 *
 * 设计约定:
 *  - 每个抓取模块"绝不向 main 抛异常":失败用 ModuleResult.ok=false + error 表达,
 *    保证单个信息源故障不会拖垮整份早报(部分降级,能发多少发多少)。
 *  - 去重游标写在 draft 状态上,只有"推送成功"后才由 main 落盘,
 *    避免发送失败导致信息被永久去重掉。
 *  - 模块内部对单个子源(单个 RSS 源/单个仓库)的失败只记入 warnings,不算整体失败。
 */

export type ModuleName = 'weather' | 'calendar' | 'github' | 'rss' | 'baiduhot' | 'bilibili' | 'personal';

/** 报告类型:早报 / 晚报 / 随时快报 */
export type ReportKind = 'morning' | 'evening' | 'quick';

/** 所有抓取模块的统一返回结构 */
export interface ModuleResult<T> {
  ok: boolean;
  /** 成功时的业务数据 */
  data: T | null;
  /** ok=false 时的人类可读失败原因(会出现在早报"模块故障"区) */
  error?: string;
  /** 部分成功时的附加说明(如某个 RSS 源失败但其余正常) */
  warnings?: string[];
}

/** 抓取上下文。state 是草稿:模块可写入去重游标,由 main 决定是否落盘 */
export interface FetchContext {
  cfg: BotConfig;
  state: BotState;
  now: Date;
  /** force=true:忽略去重状态,把当前可见的内容全部输出(用于预览) */
  force?: boolean;
  /**
   * 报告类型。模块可据此调整"当下是否还说得出":例如晚报不必再提醒
   * 今天上午已经下过的雨。缺省按早报处理。
   */
  reportKind?: ReportKind;
}

/* ---------------- 天气 ---------------- */

export interface WeatherWarning {
  title: string;
  level?: string;
  detail?: string;
  start?: string;
  end?: string;
}

/**
 * 空气质量。
 * 只给 PM2.5/PM10 浓度与等级词,不给"AQI 数字"——真正的 AQI 要取各项污染物
 * 的最大 IAQI,仅凭 PM2.5 算出来的数会偏低,不如直接报浓度 + 等级诚实。
 */
export interface AirQuality {
  /** PM2.5 浓度 μg/m³ */
  pm25: number;
  /** PM10 浓度 μg/m³(可选;沙尘天比 PM2.5 更有参考价值) */
  pm10?: number;
  /** 等级词:优 / 良 / 轻度污染 / 中度污染 / 重度污染 / 严重污染 */
  level: string;
}

/** 一段连续的降水时间(相邻小时合并,避免逐小时刷屏) */
export interface RainWindow {
  /** 起始时刻,本地 HH:MM */
  start: string;
  /** 结束时刻,本地 HH:MM(含该小时) */
  end: string;
  /** 时段内最高降水概率 0-100 */
  maxProb: number;
  /** 时段内累计降水量 mm(可选) */
  mm?: number;
}

export interface WeatherInfo {
  locationName: string;
  description: string;
  emoji: string;
  tempMin: number;
  tempMax: number;
  /** 当前温度,°C(可选) */
  tempNow?: number;
  /** 降水概率 0-100(可选) */
  precipitationProb?: number;
  /** 日出时刻,本地 HH:MM(可选) */
  sunrise?: string;
  /** 日落时刻,本地 HH:MM(可选) */
  sunset?: string;
  /** 当日紫外线指数最大值(可选) */
  uvIndexMax?: number;
  /** 空气质量(可选;取不到时不展示) */
  air?: AirQuality;
  /** 今日尚未过去的降水时段(可选;晚报只显示之后的) */
  rainWindows?: RainWindow[];
  /** 穿衣建议(可选;由温度推导,不联网) */
  dressAdvice?: string;
  warnings: WeatherWarning[];
  source: string;
}

export interface WeatherSection {
  weather: WeatherInfo;
}

/* ---------------- 日历 / 课表 ---------------- */

export interface CalendarEvent {
  title: string;
  /** 'HH:mm',全天事件为 '全天' */
  start: string;
  /** 'HH:mm',全天事件可缺省 */
  end?: string;
  location?: string;
  teacher?: string;
  /** 来源名,如 '课表'、ICS 源的 name */
  source: string;
  /** 附加标记,如 '第 2 周' */
  tag?: string;
}

export interface CalendarSection {
  events: CalendarEvent[];
}

/* ---------------- GitHub Releases ---------------- */

export interface GithubRelease {
  /** owner/name */
  repo: string;
  tagName: string;
  name?: string;
  /** ISO 时间 */
  publishedAt: string;
  url: string;
  prerelease: boolean;
  /** 清洗截断后的说明文本 */
  summary?: string;
}

export interface GithubSection {
  releases: GithubRelease[];
  /** 发现的中文区高 star 新项目 */
  discoveries: GithubDiscovery[];
}

/** 通过 GitHub Search API 发现的新项目 */
export interface GithubDiscovery {
  /** full_name,如 vercel/next.js */
  repo: string;
  url: string;
  stars: number;
  language?: string;
  /** 清洗截断后的描述 */
  description?: string;
  /** 仓库创建时间,ISO */
  createdAt: string;
  /**
   * 默认分支历史提交总数、issue 总数(不含 PR)。
   * 取不到活跃度数据时留空 —— 此时报告不展示该项,排序退化为按 star。
   */
  commits?: number;
  issues?: number;
  /** 加权得分(0~100),用于排序;仅在拿到活跃度数据时才有意义 */
  score?: number;
}

/* ---------------- RSS ---------------- */

export interface RssItem {
  feedTitle: string;
  title: string;
  link: string;
  /** ISO 时间(可选) */
  publishedAt?: string;
  /** 清洗为纯文本并截断的摘要 */
  summary?: string;
}

export interface RssSection {
  items: RssItem[];
}

/* ---------------- 百度热搜 ---------------- */

/**
 * 热搜是"榜单"语义:每次运行输出当前 Top N 快照,不做增量去重;
 * isNew 用历史 seen 记录判断"新上榜",给用户一个变化的信号。
 */
export interface HotSearchItem {
  /** 名次,从 1 开始 */
  rank: number;
  word: string;
  /** 搜索结果链接(可选) */
  url?: string;
  /** 相比上次运行是否新上榜 */
  isNew?: boolean;
  /** 热度值(部分榜单接口提供,如 B 站) */
  heat?: number;
}

export interface BaiduHotSection {
  items: HotSearchItem[];
}

export interface BiliHotSection {
  items: HotSearchItem[];
}

/* ---------------- 个人向提醒 ---------------- */

export interface AnniversaryInfo {
  name: string;
  /** 配置里的原始日期 YYYY-MM-DD */
  date: string;
  /** 距下次发生还有几天(0 = 就是今天) */
  daysLeft: number;
  /** 下次发生的日期 YYYY-MM-DD */
  nextDate: string;
  /** 第几周年(已过首年时给出,如 "1 周年") */
  years?: number;
}

export interface CertInfo {
  name: string;
  host: string;
  /** 证书到期日 YYYY-MM-DD */
  validTo: string;
  /** 剩余天数(负数表示已过期) */
  daysLeft: number;
}

export interface PersonalSection {
  /** 临近的纪念日/生日 */
  anniversaries: AnniversaryInfo[];
  /** 临近到期的证书 */
  certs: CertInfo[];
}

export type SectionPayload =
  | WeatherSection
  | CalendarSection
  | GithubSection
  | RssSection
  | BaiduHotSection
  | BiliHotSection
  | PersonalSection;

/* ---------------- 配置 ---------------- */

export interface WeatherConfig {
  enabled?: boolean;
  locationName: string;
  latitude: number;
  longitude: number;
  /** 可选:接入和风天气预警,key 走环境变量 QWEATHER_API_KEY */
  qweather?: { host?: string; locationId: string };
  /** 空气质量(Open-Meteo,免费无需 key);默认开启,设为 false 可关 */
  airQuality?: boolean;
}

export interface IcsSource {
  name?: string;
  url: string;
}

export interface CourseItem {
  name: string;
  /** 1-7,周一=1 */
  weekday: number;
  /** 'HH:mm' */
  start: string;
  /** 'HH:mm' */
  end: string;
  location?: string;
  teacher?: string;
  /** 周次,如 "1-16" / "1,3,5-8",缺省表示每周都上 */
  weeks?: string;
}

export interface CalendarConfig {
  enabled?: boolean;
  ics?: IcsSource[];
  courses?: {
    /** 学期第 1 周的周一,格式 YYYY-MM-DD */
    semesterStart?: string;
    items?: CourseItem[];
  };
}

export interface GithubDiscoverConfig {
  enabled?: boolean;
  /** 只看最近 N 天创建的仓库,默认 7 */
  createdWithinDays?: number;
  /** star 数下限,默认 100 */
  minStars?: number;
  /** 只推描述/名称含中文的项目(中文区启发式过滤),默认 true */
  chineseOnly?: boolean;
  maxItems?: number;
  /** 首次运行直接展示当前榜单(默认 false,即首次就推);true 则首次只记录 */
  firstRunQuiet?: boolean;
  /**
   * 参与打分的候选池大小(按 star 从高到低取,默认 200,上限 1000)。
   * 池子越大越能捞到"星不多但迭代猛"的项目,代价是每次运行多几次 Search API 调用。
   */
  poolSize?: number;
  /**
   * 活跃度加权:三项指标各占多少权重(默认 star 0.4 / commit 0.3 / issue 0.3)。
   * commit 与 issue 权重都为 0 时不请求活跃度数据;三项全 0 则回落默认权重。
   */
  weights?: DiscoveryWeights;
}

export interface DiscoveryWeights {
  stars: number;
  commits: number;
  issues: number;
}

export interface GithubConfig {
  enabled?: boolean;
  /** 盯具体仓库的 Release;为空则不推 Release(可只用 discover) */
  repos: string[];
  includePrerelease?: boolean;
  maxPerRepo?: number;
  /** 首次运行只记录不推送,避免刷屏(默认 true) */
  firstRunQuiet?: boolean;
  /** 发现中文区高 star 新项目 */
  discover?: GithubDiscoverConfig;
}

export interface RssFeed {
  name?: string;
  url: string;
}

export interface RssConfig {
  enabled?: boolean;
  feeds: RssFeed[];
  maxPerFeed?: number;
  /** 首次运行只记录不推送,避免刷屏(默认 true) */
  firstRunQuiet?: boolean;
}

export interface BaiduHotConfig {
  enabled?: boolean;
  /** 展示条数,默认 10 */
  maxItems?: number;
}

export interface BiliHotConfig {
  enabled?: boolean;
  /** 展示条数,默认 10 */
  maxItems?: number;
}

export interface AnniversaryConfig {
  /** 显示名,如 "生日" */
  name: string;
  /** 日期 YYYY-MM-DD,每年重复 */
  date: string;
}

export interface CertCheckConfig {
  name: string;
  host: string;
  /** 默认 443 */
  port?: number;
}

export interface PersonalConfig {
  enabled?: boolean;
  /** 纪念日/生日(每年重复) */
  anniversaries?: AnniversaryConfig[];
  /** 只在距今天数 <= 该值时展示,默认 30(避免"还有 300 天"这种噪音) */
  anniversaryWithinDays?: number;
  /** 域名证书到期检查 */
  certChecks?: CertCheckConfig[];
  /** 只在剩余天数 <= 该值时展示,默认 30 */
  certWarnDays?: number;
  /** 单次 TLS 探测超时毫秒数,默认 8000 */
  certTimeoutMs?: number;
}

export interface NotifyConfig {
  /** enabled 缺省 = 自动:配了环境变量就发,没配就静默跳过;true = 强制启用,缺环境变量视为故障 */
  telegram?: { enabled?: boolean };
  feishu?: { enabled?: boolean };
}

export interface LimitsConfig {
  maxCalendarEvents?: number;
  maxReleases?: number;
  maxRssItems?: number;
  /** 热搜条数上限(覆盖 baiduhot.maxItems) */
  maxHotItems?: number;
  /** B 站热搜条数上限(覆盖 bilibili.maxItems) */
  maxBiliItems?: number;
  /** 摘要截断字符数 */
  summaryChars?: number;
}

/**
 * 发布时间锁定。
 * 仅对 --scheduled(CI 定时)运行生效:定时任务会提前一点触发,进程等到目标时刻再发,
 * 保证不会早于设定时间;并记录"当日该时段已发送",避免定时与手动触发重复推送。
 */
export interface ScheduleConfig {
  /** 早报目标发布时间(本地时区),如 "08:00" */
  morning?: string;
  /** 晚报目标发布时间(本地时区),如 "21:00" */
  evening?: string;
  /** true(默认)= 早于目标时刻则等待到点再发;false = 立即发送不等 */
  lockTime?: boolean;
  /** 单次等待上限(分钟,默认 30):超过则不再等待直接发送,避免长时间占用 CI */
  maxWaitMinutes?: number;
}

/** 报告图片(与文本一同推送;生成失败自动降级为仅文本) */
export interface ImageConfig {
  enabled?: boolean;
  /** 图片宽度(px),默认 900 */
  width?: number;
  /** 字体文件地址(可覆盖内置默认值);下载失败只会跳过图片,不影响文本推送 */
  fontUrl?: string;
}

/** 随时快报:手动/URL 触发的即时报告,不受发布锁限制,条数更精简 */
export interface QuickConfig {
  enabled?: boolean;
  /** 覆盖 limits 中的条数上限 */
  limits?: LimitsConfig;
}

export interface BotConfig {
  /** IANA 时区名,如 Asia/Shanghai。"今天"以此为准 */
  timezone: string;
  user?: { name?: string };
  weather: WeatherConfig;
  calendar: CalendarConfig;
  github: GithubConfig;
  rss: RssConfig;
  baiduhot: BaiduHotConfig;
  /** B 站热搜榜单(可选) */
  bilibili?: BiliHotConfig;
  /** 个人向提醒:纪念日倒计时 / 域名证书到期 */
  personal?: PersonalConfig;
  notify: NotifyConfig;
  limits: LimitsConfig;
  /** 发布时间锁定(早报/晚报目标时刻与当日去重锁) */
  schedule: ScheduleConfig;
  /** 图片版报告 */
  image: ImageConfig;
  /** 随时快报 */
  quick: QuickConfig;
  /** 状态文件路径,默认 data/state.json */
  statePath: string;
}

/* ---------------- 状态(去重游标,持久化为 JSON) ---------------- */

export interface GithubRepoState {
  /** 已推送过的 release id,最新追加在尾部 */
  seenIds: number[];
  lastPublishedAt?: string;
}

export interface RssFeedState {
  /** 已推送过的条目 hash(link 摘要),最新追加在尾部 */
  seen: string[];
  lastCheck?: string;
}

export interface BotState {
  version: 1;
  github?: {
    repos?: Record<string, GithubRepoState>;
    /** 已推送过的"发现"仓库 id */
    discovery?: { seenIds?: number[] };
  };
  rss?: { feeds?: Record<string, RssFeedState> };
  /** 百度热搜:已见过的词条(用于标记"新上榜") */
  baidu?: { seen?: string[] };
  /** B 站热搜:已见过的词条(用于标记"新上榜") */
  bilibili?: { seen?: string[] };
  /** 发布锁:各时段最近一次成功发送的本地日期(YYYY-MM-DD) */
  sends?: { morning?: string; evening?: string };
}

/* ---------------- 报告渲染 ---------------- */

export interface ReportFailure {
  module: ModuleName | 'notify';
  message: string;
}

export interface ReportContext {
  /** 'morning' 早报 / 'evening' 晚报 / 'quick' 随时快报(渲染头部与问候语随之变化) */
  reportKind: ReportKind;
  greeting: string;
  /** '2026-09-13 星期日' */
  dateLabel: string;
  /** '08:00' */
  timeLabel: string;
  weather?: WeatherInfo;
  calendar: CalendarEvent[];
  releases: GithubRelease[];
  discoveries: GithubDiscovery[];
  rss: RssItem[];
  hotItems: HotSearchItem[];
  /** B 站热搜(B 站榜单,与百度热搜分开成块) */
  biliHot: HotSearchItem[];
  /** 个人向提醒(纪念日倒计时 / 证书到期) */
  personal: PersonalSection;
  failures: ReportFailure[];
  /** 是否有任何实质内容(决定渲染"今日无事"版) */
  hasContent: boolean;
}
