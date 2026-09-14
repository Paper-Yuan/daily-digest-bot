# 个人聚合信息报告 / 热榜推送机器人 —— 竞品调研与差异化定位

> 调研时间：2026-09-14
> 调研方式：GitHub 搜索 + 仓库元数据（`gh api`）+ README 原文核对，所有 star 为调研当日近似值。
> 对比对象：`Paper-Yuan/daily-digest-bot`（TypeScript + GitHub Actions，零服务器，早 08:00 / 晚 21:00 双时段，天气 + ICS 日历/周次课表 + GitHub Release/高星发现 + RSS + 百度热搜，推送 Telegram / 飞书）。

---

## 1. 对比表格

| # | 项目（仓库） | star | 定位 | 信息源 | 推送渠道 | 图片报告 | 双时段 | 按需触发 | 私有信息 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | [sansan0/TrendRadar](https://github.com/sansan0/TrendRadar) | 62.2k | 多平台热榜 + AI 舆情监控（事实标杆） | 35 个平台热榜 + RSS + AI | 个人微信/企微/飞书/钉钉/TG/邮件/ntfy/bark/slack | ⚠️ 仅网页可导出图片，**IM 推送为纯文本** | ✅ `morning_evening` 预设 | ❌ 仅 workflow 手动重跑测试 | ❌ 纯公共热点 |
| 2 | [JackyST0/hotpush](https://github.com/JackyST0/hotpush) | 190 | 热榜聚合推送平台（带 Web 管理台） | 13+ 平台热榜 | TG/Discord/企微/飞书/钉钉/邮件/Webhook | ❌ | ❌ 单时段「定时摘要」 | ✅「立即推送摘要」按钮 | ❌ |
| 3 | [Rongronggg9/RSS-to-Telegram-Bot](https://github.com/Rongronggg9/RSS-to-Telegram-Bot) | 2.2k | 重度 Telegram RSS 阅读器 | RSS / Atom | Telegram | ⚠️ 转发原文图片，非报告图 | ❌ | ✅ 命令即时推送 | ❌ |
| 4 | [indes/flowerss-bot](https://github.com/indes/flowerss-bot) | 1.8k | Telegram RSS 订阅 Bot（Go） | RSS | Telegram | ❌ | ❌ | ⚠️ 订阅式 | ❌ |
| 5 | [iovxw/rssbot](https://github.com/iovxw/rssbot) | 1.7k | 轻量 Rust Telegram RSS Bot | RSS 0.9–2.0 / Atom | Telegram | ❌ | ❌ | ⚠️ 订阅式 | ❌ |
| 6 | [fengkx/NodeRSSBot](https://github.com/fengkx/NodeRSSBot) | 405 | Node.js Telegram RSS Bot | RSS | Telegram | ❌ | ❌ | ⚠️ 订阅式 | ❌ |
| 7 | [pyatyispyatil/github-releases-notify-bot](https://github.com/pyatyispyatil/github-releases-notify-bot) | 131 | GitHub Release / Tag 订阅通知 | GitHub Release/Tag | Telegram | ❌ | ❌ | ✅ `/actions` 命令即时查 | ❌ |
| 8 | [vitalets/github-trending-repos](https://github.com/vitalets/github-trending-repos) | 3.0k | Trending → GitHub Issue 通知 | GitHub Trending（按语言订阅） | GitHub 通知 / 邮件 | ❌ | ❌ 每日一次 | ❌ | ❌ |
| 9 | [bonfy/github-trending](https://github.com/bonfy/github-trending) | 1.1k | Trending → RSS / 每日榜 | GitHub Trending | RSS | ❌ | ❌ 每日一次 | ❌ | ❌ |
| 10 | [appstore-discounts/appstore-discounts](https://github.com/appstore-discounts/appstore-discounts) | 405 | App Store 降价追踪（GitHub Actions） | App Store 各区 | RSS / Telegram / 钉钉 | ❌ | ❌ 每 180 分钟一次 | ❌ | ❌ |
| 11 | [wubaiqing/zaobao](https://github.com/wubaiqing/zaobao) | 2.2k | 「每日时报」技术资讯 | HN / Medium / V2EX / 掘金 / Trending 等 | 静态站 / RSS / QQ 群 | ❌ | ❌ 每日一次 | ❌ | ❌ |
| 12 | [justlovemaki/CloudFlare-AI-Insight-Daily](https://github.com/justlovemaki/CloudFlare-AI-Insight-Daily) | 1.8k | AI 资讯日报（Gemini 摘要 + 播客） | AI 新闻 / 开源 / 论文 / 大 V | GitHub Pages | ❌ | ❌ | ❌ | ❌ |
| 13 | [vikiboss/60s](https://github.com/vikiboss/60s) | 5.7k | 「每天 60 秒读懂世界」开放 API | 公众号精选新闻 + 多平台热搜 | 无（纯 API），可返回图片 | ✅ API 可直接返回 PNG 二进制 | ❌ API 无调度 | ✅ HTTP 按需调用 | ❌ |
| 14 | [yanyaoli/daily60s](https://github.com/yanyaoli/daily60s) | 44 | 60s 新闻 → 多渠道推送（Cloudflare Workers） | 60s API | Bark / TG / Server 酱 / 钉钉 / PushPlus | ❌ 仅文本 | ❌ 每天 08:30 一次 | ✅ POST 手动触发 | ❌ |
| 15 | [Quan666/ELF_RSS](https://github.com/Quan666/ELF_RSS) | 609 | QQ 群 RSS 订阅插件 | RSS（RSSHub 友好） | QQ | ⚠️「仅图片」订阅（转发原图） | ❌ | ⚠️ 指令式 | ❌ |
| 16 | [ni5arga/DailyDigestBot](https://github.com/ni5arga/DailyDigestBot) | 34 | Reddit 每日热帖摘要 | Reddit 指定 sub | Reddit | ❌ | ❌ 每日一次 | ❌ | ❌ |
| 17 | [wahahaazhe/KnowGT](https://github.com/wahahaazhe/KnowGT) | 63 | GitHub 热榜日报（Claude Code Skill） | GitHub Trending | Claude Code 对话内输出 | ❌ | ❌ | ✅ Skill 手动调用 | ❌ |
| 18 | [ghwmx/WeiXinPost](https://github.com/ghwmx/WeiXinPost) | 54 | 微信天气 + 课表 + 上课提醒 + 晚安心语 | 天气 API + 个人课表 + 天行数据 | 微信公众号模板消息 | ❌ | ✅ 早课表 + 晚「次日课程」 | ✅ 云函数触发 workflow | ✅✅ 课表 + 上课提醒 |
| 19 | [Easyhoov/daily-morning-report](https://github.com/Easyhoov/daily-morning-report) | 0 | 早报（60s + Open-Meteo → 飞书卡片） | 60s 新闻 + Open-Meteo 天气 | 飞书卡片 | ⚠️ 卡片非图片 | ❌ 每日一次 | ❌ | ⚠️ 天气 |
| 20 | [demian85/google-calendar-telegram-bot](https://github.com/demian85/google-calendar-telegram-bot) | 42 | Google 日历管理 + 每日日程提醒 | Google Calendar | Telegram | ❌ | ❌ | ✅ 命令式 | ✅ 日程私有 |
| 21 | [521xueweihan/HelloGitHub](https://github.com/521xueweihan/HelloGitHub) | 176k | 月刊开源项目精选 | GitHub 项目 | 网页 / 公众号 / RSS | ❌ | ❌ 月更 | ❌ | ❌ |
| 22 | [enescingoz/awesome-n8n-templates](https://github.com/enescingoz/awesome-n8n-templates) | 25.4k | n8n 工作流模板合集（含报告推送类） | 用户自定 | 用户自定（TG/Gmail/Slack 等） | 视模板 | 视模板 | 视模板 | ❌ |
| 23 | [DIYgod/RSSHub](https://github.com/DIYgod/RSSHub) | 46.2k | 万能 RSS 生成路由引擎 | 「万物皆可 RSS」 | 无（只产出 RSS） | ❌ | ❌ | ✅ API 按需 | ❌ |

**许可证速查（影响我们能否抄代码）**

| 宽松（可借鉴代码，保留声明即可） | 强 Copyleft（避免直接抄代码） | 未声明 License |
|---|---|---|
| hotpush (MIT)、flowerss-bot (MIT)、rssbot (Unlicense)、NodeRSSBot (MIT)、releases-notify-bot (MIT)、github-trending (MIT)、appstore-discounts (MIT)、zaobao (MIT)、60s (MIT)、KnowGT (MIT)、DailyDigestBot (MIT) | TrendRadar (GPL-3.0)、RSS-to-Telegram-Bot (AGPL-3.0)、RSSHub (AGPL-3.0)、ELF_RSS (GPL-3.0)、CloudFlare-AI-Insight-Daily (GPL-3.0) | WeiXinPost、daily-morning-report、google-calendar-telegram-bot、vitalets/github-trending-repos、HelloGitHub (CC BY-NC-ND 4.0，禁止商用/演绎) |

> 注：第 22、23 项属于「生态/上游」而非同类竞品，列出用于说明「重度定制用户会转向 RSSHub + n8n」这一事实。

---

## 2. 重叠分析：哪些已被做得很好，我们**不该**重复造

诚实讲，我们这个方向的大部分「公共信息聚合」能力已经被高度商品化：

1. **多平台热榜聚合与推送——彻底红海，直接放弃竞争。**
   `sansan0/TrendRadar` 62.2k star，覆盖 35 个平台、AI 关键词/自然语言筛选、AI 翻译、AI 简报到手、MCP 架构、Docker/GitHub Actions/本地三种部署、8+ 推送渠道、可视化配置编辑器、网页版报告 + 时段冲突检测。我们在热榜维度只有**百度热搜**一个源，去拼「平台数量/AI 摘要」是自杀式竞争。**结论：百度热搜只作为「个人报告里的一个模块」存在，绝不宣传为热榜聚合工具。**

2. **RSS → Telegram/QQ 订阅——成熟到没有缝隙。**
   RSS-to-Telegram-Bot（2.2k）、flowerss-bot（1.8k）、rssbot（1.7k）、NodeRSSBot（405）、ELF_RSS（609）都支持多用户订阅管理、关键词过滤、OPML、Instant View、图片/视频转发、去重、Docker 部署。我们**不该**去做「订阅管理界面、多用户、OPML 导入、RSS 全文解析引擎」这些事；RSS 对我们只是五个信息源之一，用现成解析库即可。

3. **GitHub Trending 订阅 / Release 通知——标准件，已有多个 1k+ 项目。**
   vitalets/github-trending-repos（3.0k，按语言邮件/Issue 订阅）、bonfy/github-trending（1.1k，Trending→RSS）、releases-notify-bot（131，TG 命令式查 Release + Tag）。我们的「盯仓库 Release + 发现高星新项目 + 中文区过滤」属于**组合上的微创新**，单点不稀缺，不要把它当作核心卖点。

4. **每日定时文本早报——廉价且同质化。**
   60s API（5.7k）+ daily60s（44）+ daily-morning-report + 各种 `daily-news-digest` 模板，都在做「定时拉一条公共新闻推给你」。单纯的「每日一条文本早报」**没有差异化空间**。

5. **AI 摘要/翻译/播客化——已被 TrendRadar、CloudFlare-AI-Insight-Daily 等占满。**
   如果我们要加 AI，最多是「个人报告的口语化建议」，而不是通用 AI 舆情分析。

**一句话：公共信息（热榜/RSS/新闻/Trending）的采集与推送已被做到饱和，任何以「聚合更多源」为卖点的路线都打不过 TrendRadar。**

---

## 3. 差异化建议：真正稀缺的组合在哪里

盘完 23 个项目，**没有任何一个**同时具备这四点，而且其中两点在开源圈几乎空白：

- **个人日程/课表（ICS + 周次）** 只有 WeiXinPost（54 star，微信、无图片、无公共源）和 google-calendar-telegram-bot（42 star，只有日历、无早报）碰过 → **个人日程中心 + 公共信息合并**是真实空白。
- **个性化图片版报告直推 IM** 几乎没有：TrendRadar 只能「在网页上点保存图片」（README 明确是网页导出功能，IM 推送为文本），60s 能返回图片但那是**固定公共图**，不是「你的日历+天气+热点」合成图 → **私有化合成图**是稀缺组合。
- **早晚双时段** 只有 TrendRadar 的 `morning_evening` 预设和 WeiXinPost 的「早课表+晚安」，且都不含个人日历 → 「锁定时段的个人早晚报」稀缺。
- **按需快报** 有先例但零散：daily60s 的 POST 触发、hotpush 的「立即推送」按钮、WeiXinPost 的云函数触发 workflow → 组合到个人报告上仍是空白。

### 可直接用于 README 的定位宣传语（3–5 条）

1. **「不是又一个热榜机器人。」** —— 把明天第一节课、下一场会议、当地天气、仓库 Release 和今日热搜，合成一张只属于你的报告。
2. **「趋势一眼看完，图像替你说话。」** —— 早报与晚报都渲染成一张可转发、可存档的信息图，而不是又要往下滑的满屏文本。
3. **「08:00 出门前速览，21:00 睡前复盘。」** —— 两个锁定时刻，把公共信息折进你的个人作息里。
4. **「任何时候，一句话就来一份快报。」** —— 手动或用一条链接触发，几秒内即时生成当下这一刻的个人摘要。
5. **「零服务器，私有只属于你。」** —— 全程跑在 GitHub Actions，课表、日历、天气只进入你自己的 Telegram / 飞书，不经任何第三方服务器。

> 推荐主打第 1 + 2 条：**「个人日程中心 × 图片版报告」**是竞品矩阵里唯一的真正空位；第 3、4 条是强化差异的功能点，第 5 条是可信度背书。

---

## 4. 对我们的功能设计建议

### 4.1 值得借鉴的设计

- **从 WeiXinPost 学到的最大教训（直接关系「发布时间锁定」）**：其 README 明确指出 **GitHub Actions 定时任务在高峰期会排队延迟 20–40 分钟**，无法满足准时需求；作者用「腾讯云函数在目标时间前 2 分钟触发 workflow」来绕开。**我们的「08:00 / 21:00 发布锁定」不能只依赖 `schedule.cron`**：要么接受并明确公示 ±延迟，要么引入一个轻量外部触发器（如 Cloudflare Workers Cron 调 `workflow_dispatch`）来真正锁时。这是本项目最容易翻车的卖点。
- **从 TrendRadar 学到的工程细节**：per-period 去重（`once`）、时段冲突检测、跨午夜时段、工作日/周末差异化调度、多通道**分批推送**（README 提到钉钉有容量限制会导致推送失败）。我们的「单源故障降级」可以再补一条「单通道故障降级 / 分片推送」。
- **从 daily60s 学到的触发模式**：定时（Cron Triggers）+ 手动（向 Worker URL `POST`）双模式——这正是我们「快报」的标准架构范式。
- **从 hotpush 学到的交互**：在定时摘要之外提供「立即推送摘要」按钮，降低用户验证成本。
- **从 60s 学到的图片方案**：API 直接返回 `image/png` 二进制（`?encoding=image`），说明「服务端渲染成图再直传」是成熟低成本路线；我们可用 HTML→截图（Playwright/`puppeteer-core`）或 `satori`+`resvg` 生成报告图。
- **从 daily-morning-report 学到的架构**：数据采集脚本 → AI/组装 → 卡片发送脚本 三段解耦，便于单独测试（与我们的「近百个单元测试」理念一致）。
- **从 RSS-to-Telegram-Bot 学到的细节**：长图作为文件发送以防 Telegram 压缩导致不可读；emoji 图片替换。

### 4.2 常见坑（务必规避）

1. **GitHub Actions cron 延迟与跳过**：免费额度下高峰期排队、间隔低于 5 分钟可能被跳过；cron 是 UTC，需换算北京时间。→ 早/晚报时间要留余量，或在文档里如实说明。
2. **状态丢失导致重复/漏推**：`actions/cache` 有淘汰风险。我们「推送成功才落盘 + cache 传递」方向正确，建议再加「以最近 N 天已推送 ID 为准 + 可配置的重发窗口」兜底，并借鉴 TrendRadar 的 per-period 去重语义。
3. **图片报告的三个硬约束**：Telegram `sendPhoto` 有大小限制（约 5MB）且会压缩长图；飞书需区分「图片消息」与「交互卡片」，卡片内嵌图片走上传素材拿 `image_key`；中文字体缺失会渲染成方块——生成图片时务必内嵌/指定中文字体。
4. **ICS 私密信息的解析坑**：时区（TZID）、全天事件、重复事件 RRULE、周次课表（第 N 周单双周）语义千奇百怪；建议把解析失败降级为「原始摘要文本」而不是整份报告失败（沿用我们单源降级思路）。
5. **第三方源脆弱性**：百度热搜字段/反爬会变、Open-Meteo 字段、GitHub API 限流未鉴权 60 次/小时（用 token 可到 5000）。要做请求级容错 + 缓存兜底（我们已有统一 HTTP 容错，保持）。
6. **Secret 与隐私边界**：零服务器方案里，日历/课表内容会经过 Actions 运行日志风险区，务必 `::add-mask::` / 不 echo 敏感字段；飞书/TG 只推送到用户私聊，避免默认发群。
7. **不要为了「源多」而稀释定位**：竞品已证明「源的数量」打不过 TrendRadar，把工程预算投入**个人数据建模 + 图片渲染 + 调度可靠性**回报更高。

---

## 5. 结论（一句话）

公共信息聚合赛道已被 TrendRadar（62k）等吃透，**不应正面竞争**；真正的空位是「**个人日程/课表 + 天气 + 公共热点的私有化合成**」与「**个性化图片版报告直推 IM**」的交集，再叠加「**定时锁点 + 按需快报**」——目前没有任何开源项目同时做到这四点，这就是 `daily-digest-bot` 应主打的差异化定位。
