# daily-digest-bot

> 🌅 每天早上醒来、晚上睡前，自动收到一条排版好的聚合报告——天气、日程、GitHub 新动态、RSS 订阅、热搜榜，推送到 Telegram / 飞书 / 钉钉 / 企业微信 / Slack。零服务器成本，GitHub Actions 自动运行。

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A518.17-339933?logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License">
  <img src="https://github.com/Paper-Yuan/daily-digest-bot/actions/workflows/ci.yml/badge.svg" alt="CI">
</p>

## 为什么需要这个

信息分散在各个平台：日历在 Google Calendar、课表在教务系统、天气要专门打开 App、关注的技术博客和 GitHub 项目得主动去刷……每天早上要打开好几个应用才能知道"今天有什么事"。

这个 Bot 把它们**汇总成一条消息**，每天早上 8 点 + 晚上 9 点自动推送，你只需要看一眼 Telegram 或群机器人（定时由 Cloudflare Worker 的 cron 准点唤起，见[定时与早晚报](#定时与早晚报)）：

- 🌤 **天气**：今天穿什么衣服？要不要带伞？
- 📅 **日程 / 课表**：今天有课吗？几点开会？
- 🚀 **GitHub**：关注的项目有新版本了吗？最近中文区冒出哪些值得看的项目？
- 🗞 **RSS 订阅**：阮一峰的周刊更新了吗？技术博客有新文章？
- 🔥 **百度热搜**：今天大家都在讨论什么？
- 📺 **B 站热搜**：二次元与赛事的热榜，带热度值
- 🎯 **个人提醒**：纪念日/生日倒计时、自建域名证书到期，只在临近时出现
- 📱 **推送渠道**：Telegram（文本 + 图片）、飞书 / 钉钉 / 企业微信 / Slack 群机器人，配了哪个发哪个

跑在 GitHub Actions 上，**零服务器成本**（定时器是 Cloudflare Worker 的免费 cron），Fork 下来配几个密钥就能用。

---

## 长什么样

<details open>
<summary>📱 推送效果（Telegram / 飞书 / 钉钉 / 企业微信 / Slack）</summary>

```text
🌅 早报 · 2026-09-13 星期日 08:00
早上好！
────────────────────

▌🌤 天气 · 北京
☀️ 晴 ｜ 19 ~ 29°C（当前 21.0°C）
😷 空气 良（PM2.5 68.2 · PM10 95.4）
🌧 有雨时段:14:00~16:00 最高 75%
🌅 日出 05:54 · 日落 18:17 · 紫外线 5.7
👕 热,短袖;早晚温差 11℃,记得加件外套

▌📅 今日日程 · 2 条
• 全天 中秋假期（日历）
• 08:00-09:40 高等数学 @教三-101 · 第 1 周（课表）

▌✨ GitHub 新项目榜 · 2 条
1. cn/awesome-project  ⭐ 3.2k · TypeScript
  提交 66 · issue 5 · 得分 60.0
  一个很棒的新项目描述
  https://github.com/cn/awesome-project

▌🗞 订阅更新 · 1 条
• [阮一峰的网络日志] 科技爱好者周刊(第 xxx 期)
  http://www.ruanyifeng.com/blog/2026/09/weekly-issue-xxx.html

▌🔥 百度热搜 · 10 条
1. xxx热搜词条
2. 🆕 新上榜的词条

▌📺 B 站热搜 · 5 条
1. 🆕 今年最后一次长庚伴月  🔥 热度 104.6万
2. LPL总决赛AL赛事语音  🔥 热度 42.3万

────────────────────
定时发送的是当日新增;想要此刻的完整快照,发 /quick 随时要一份
```

*Telegram 版本的摘要会渲染成带左侧竖条的引用块，视觉层次更清晰；其余四个渠道拿到的就是上面这份纯文本。*

</details>

---

## 快速开始（4 步）

### 1. Fork 这个仓库

点击右上角 **Use this template** 或 **Fork**，建议设为 **Private**（你的订阅偏好属于个人隐私）。

### 2. 配置你想要的信息

复制 [`config/config.example.yaml`](config/config.example.yaml) 为 `config/config.yaml`，修改：

- **城市坐标**（天气）：去 [Open-Meteo](https://open-meteo.com/) 搜你的城市，复制经纬度
- **日历订阅链接**（可选）：Google Calendar / Apple 日历都能导出 ICS 链接
- **课表**（可选）：填写学期开始日期 + 每周的课程安排
- **GitHub 仓库**（可选）：填你想盯的仓库（如 `microsoft/TypeScript`），或开启中文区新项目榜
- **RSS 订阅**（可选）：任意 Atom/RSS 源（如阮一峰的博客、少数派、V2EX）

**这份文件不含任何密钥**，可以放心提交到仓库。详细配置说明见[配置详解](#配置详解)。

### 3. 添加推送渠道密钥

去仓库的 **Settings → Secrets and variables → Actions**，添加：

<details>
<summary><b>Telegram</b>（展开查看步骤）</summary>

1. 找 [@BotFather](https://t.me/BotFather) 发送 `/newbot` 创建机器人，拿到 **token**
2. 与你的机器人随便对话一句，然后访问 `https://api.telegram.org/bot<TOKEN>/getUpdates`，在返回中找到 `chat.id`
3. 添加 Secrets：
   - `TELEGRAM_BOT_TOKEN` = BotFather 给的 token
   - `TELEGRAM_CHAT_ID` = 上一步拿到的 chat.id

</details>

<details>
<summary><b>飞书</b>（展开查看步骤）</summary>

1. 在目标群里添加「自定义机器人」（群设置 → 群机器人 → 添加），勾选**加签**，拿到 webhook 地址与签名密钥
2. 添加 Secrets：
   - `FEISHU_WEBHOOK_URL` = webhook 地址
   - `FEISHU_SECRET` = 签名密钥

</details>

<details>
<summary><b>钉钉</b>（展开查看步骤）</summary>

1. 群设置 → 智能群助手 → 添加机器人 → 自定义；安全设置勾选**加签**（或改选「自定义关键词」，填 `早报` 这类一定出现在标题里的词）
2. 添加 Secrets：
   - `DINGTALK_WEBHOOK_URL` = webhook 地址
   - `DINGTALK_SECRET` = 加签密钥（用关键词方式时不用配）

</details>

<details>
<summary><b>企业微信</b>（展开查看步骤）</summary>

1. 群聊 → 群机器人 → 添加，复制 webhook 地址（地址里的 `key` 就是凭证，没有加签）
2. 添加 Secret：`WECOM_WEBHOOK_URL` = 那条 webhook 地址

</details>

<details>
<summary><b>Slack</b>（展开查看步骤）</summary>

1. 在自己的 Slack App 里给目标频道创建 **Incoming Webhook**，复制 webhook 地址
2. 添加 Secret：`SLACK_WEBHOOK_URL` = 那条 webhook 地址

</details>

配了的渠道都会发，一个都不配也能跑（只输出到 Actions 日志）。**图片只有 Telegram 收得到**，
其余四个走 webhook 的渠道传不了本地生成的 PNG，会自动只发文本——这是降级，不算失败。

**搞定！** 手动 Run 一次 workflow 立刻预览效果（Actions 页 → Run workflow → `dryRun` 勾上只看日志）。

### 4. 让它每天自己跑（二选一，必做）

仓库里**没有**启用 GitHub 的 `on.schedule`——实测本账号的 Actions schedule 会排队 0~8 小时
（早报常在凌晨或中午才到），所以定时默认交给 Cloudflare Worker 的 cron：

| 方案 | 怎么做 | 到达时间 |
| --- | --- | --- |
| **A. Worker cron（推荐，准点）** | 按 [`cloudflare/README.md`](cloudflare/README.md) 部署那个免费 Worker，`npx wrangler deploy` | 08:00 / 21:00 准点，dispatch 后约 35 秒送达 |
| **B. GitHub schedule（零额外服务）** | 打开 `.github/workflows/morning.yml` 里注释掉的 `on.schedule` 两行 | 到点排队执行，可能晚几分钟到几小时 |

两个都配也不会重复推送：定时链路带"当日已发"幂等。细节见[定时与早晚报](#定时与早晚报)。

---

## 功能清单

| 模块 | 说明 | 亮点 |
| --- | --- | --- |
| 🌤 **天气** | Open-Meteo 免费无需 key；可选接入和风天气预警 | 空气质量 / 日出日落 / 紫外线 / 降水时段 / 穿衣建议 |
| 📅 **日历 / 课表** | 任意 ICS 订阅链接 + 本地课表配置 | 支持周次 `1-16`、`1,3,5-8`，自动过滤今天的事项 |
| 🚀 **GitHub** | 盯指定仓库的 Release；或生成中文区新项目加权榜 | 按 star/提交数/issue 数加权排名，可过滤中文区项目 |
| 🗞 **RSS** | 任意 Atom/RSS 源，HTML 自动清洗成纯文本 | 首次运行"静默建档"，不会把历史文章全推一遍 |
| 🔥 **百度热搜** | 直连百度热搜榜接口，Top N 快照 | 新上榜词条带 🆕 标记 |
| 📺 **B 站热搜** | 直连 B 站热搜榜，带热度值 | 同样有 🆕 标记，与百度热搜分块展示 |
| 🎯 **个人提醒** | 纪念日/生日倒计时、域名证书到期 | 只在临近时才出现，不刷"还有 300 天" |
| 📱 **推送渠道** | Telegram、飞书、钉钉、企业微信、Slack，配了哪个发哪个 | 并发发送、任一成功即算送达；长文按字符/字节自动分块；HTML 解析失败自动降级纯文本 |
| 🌅🌙 **早报 + 晚报** | 双定时点，头部与问候语按运行时刻自动切换 | 08:00 显示 🌅 早上好，21:00 显示 🌙 晚上好 |
| 🖼 **图片版报告** | 报告同时渲染成一张竖版信息图推送 | 手机上可一眼扫完、便于转发存档 |
| ⚡ **随时快报** | 手动或一条链接触发，即时生成当前快照 | 快照语义，不污染早晚报的去重游标 |

---

## 特色能力

### 🖼 图片版报告

报告除了文本，还会渲染成一张竖版信息图（宽 900px，高度按内容自适应）与文本**一同推送**：

- Telegram 先发图片再发文本（图文分离，文本仍可复制、链接仍可点）
- 主题色区分报告类型：早报暖橙、晚报深蓝、快报青色
- **中文字体内置获取**：按「本地字体 → 本地缓存 → CDN 下载」三级回退，CI 环境也能正常渲染
- **生成失败自动降级为纯文本**，绝不会因为没有字体或网络问题导致推送失败
- 用 `--no-image` 或 `DIGEST_DISABLE_IMAGE=1` 可关闭

> 图片只有 Telegram 收得到：飞书 / 钉钉 / 企业微信 / Slack 的 webhook 传不了本地生成的 PNG，这些渠道会自动只发文本（是降级，不算失败）。

### ⚡ 随时快报

想随时看看"现在有什么"，有三种触发方式：

| 方式 | 操作 |
| --- | --- |
| **给机器人发一条消息** | 发 `/quick`（需先部署 [`cloudflare/`](cloudflare/) 触发器，见下） |
| **网页 / 手机 App** | Actions 页 → Run workflow → `mode` 选 `quick` |
| **一条链接（手机快捷指令/自动化）** | `POST /repos/{owner}/{repo}/actions/workflows/morning.yml/dispatches`，body `{"ref":"main","inputs":{"mode":"quick"}}` |
| **本地** | `npm run morning -- --quick --dry-run` |

#### 用 Telegram 消息触发（可选）

默认做不到「给机器人发消息就出报告」——Actions 跑完就退出，没法常驻监听消息。项目在
[`cloudflare/`](cloudflare/) 提供了一个 Cloudflare Worker 触发器（免费额度足够个人使用）：

```
Telegram ──/quick──→ Cloudflare Worker ──repository_dispatch──→ GitHub Actions ──→ 推送报告
```

部署后发一条 `/quick`，约 1 分钟收到快报。Worker 只当"门铃"，**报告内容不经过它**；
带 `secret_token` 校验 + 会话白名单 + 60 秒冷却。完整步骤见
[`cloudflare/README.md`](cloudflare/README.md)。

**关键设计：快报是「快照」语义，不是「增量」。**

| 维度 | 早报 / 晚报 | 快报 |
| --- | --- | --- |
| 推送逻辑 | 只推上次之后的新内容 | 现在有什么就展示什么 |
| 去重状态 | 读 + 写 | **只读不写** |
| 条数上限 | 按 `limits` | 按 `quick.limits`，更精简 |
| 定时 | 08:00 / 21:00 | 随时，即时响应 |

之所以强调"不写状态"——否则会出现「下午发了条快报，把当天新文章标记为已读，第二天早报一条都没有」的隐蔽 bug。快报运行结束后所有状态改动都会被丢弃，所以**随便点都不会影响早晚报**。

### 📝 项目单句介绍

GitHub 新项目自动提炼**一句话简介**：取描述的**首句**（中文句号/问号/叹号，或后接空格的英文句点），而不是把整段硬截成半句话。仓库没写描述时给「暂无简介」兜底，保证卡片信息结构一致。

---

## 工程特性

不是简单的"脚本拼接"，而是带**容错、去重、自动降级**的生产级系统：

- ✅ **单源故障不影响整份报告**：某个 RSS 源挂了？没关系，报告里会有"⚠️ 模块故障"区块告诉你哪里坏了，其余内容照常推送
- ✅ **统一 HTTP 客户端**：10s 硬超时 + 指数退避重试 + 尊重 `Retry-After`，慢接口不会拖死任务
- ✅ **去重机制"推送成功才落盘"**：发送失败 → 状态不写 → 下次运行自动重推同一批内容，消息不丢
- ✅ **CI 环境状态走 actions/cache**：不写入仓库历史，workflow 只需 `contents: read` 权限
- ✅ **渠道各自容错**：Telegram HTML 解析失败自动切纯文本重发；飞书 / 钉钉 / 企业微信校验返回码并点出常见错误码；Slack 先转义 `& < >` 并关掉链接预览展开；长文按字符（Telegram）或 UTF-8 字节（中文渠道的 4096 字节上限）自动分块
- ✅ **图片渲染零依赖风险**：图像库放 `optionalDependencies`，加载失败自动退化为文本报告
- ✅ **188 个单元测试**：覆盖重试逻辑、去重机制、渲染效果、日历解析、渠道降级、发布锁、图片、简介提炼

---

## 本地运行（可选）

要求 Node.js ≥ 22.12（测试框架 vitest 5 的运行要求；CI 使用 Node 24）。

```bash
npm install
cp config/config.example.yaml config/config.yaml   # 修改为自己的配置
npm run morning -- --dry-run --force               # 只打印不推送、不写状态
```

| 参数 | 作用 |
| --- | --- |
| `--dry-run` | 只预览，不推送、不写状态 |
| `--force` | 忽略去重状态，把当前可见内容全部输出（首次配置后的完整预览） |
| `--only=weather,rss` | 只跑指定模块（`weather` `calendar` `github` `rss` `baiduhot` `bilibili` `personal`）；同名的 `client_payload.only` 走 workflow 也生效 |
| `--quick` | 生成随时快报（快照语义，不写状态） |
| `--no-image` | 跳过图片生成，只发文本 |
| `--kind=morning\|evening` | 手动指定报告类型（覆盖按时刻的自动判定） |

---

## 配置详解

配置文件是 `config/config.yaml`（由 `config/config.example.yaml` 复制修改）。**所有密钥一律走环境变量（仓库 Secrets），不进配置文件。**

<details>
<summary>完整配置示例（展开查看）</summary>

```yaml
timezone: Asia/Shanghai     # "今天"以此时区为准，与 Actions 机器的 UTC 无关

user:
  name: ""                  # 报告开头的称呼，如"同学"；留空则不称呼

weather:
  enabled: true
  locationName: 北京        # 仅用于展示
  latitude: 39.9042         # Open-Meteo 免费、无需 key（城市坐标自行查询）
  longitude: 116.4074
  # 可选：接入和风天气预警（免费订阅 host 用 devapi.qweather.com）
  # qweather:
  #   host: devapi.qweather.com
  #   locationId: "101010100"   # 城市 LocationID 见和风文档，key 走环境变量 QWEATHER_API_KEY

calendar:
  enabled: true
  ics:                      # ICS 日历订阅链接（Google/Apple 日历均可导出），可为空列表
    - name: 我的日历
      url: ""
  courses:                  # 课表（可选），与 ICS 合并展示
    semesterStart: "2026-09-07"   # 学期第 1 周的周一
    items:
      - name: 高等数学
        weekday: 1         # 1=周一 ... 7=周日
        start: "08:00"
        end: "09:40"
        location: 教三-101
        teacher: 张三
        weeks: "1-16"      # 周次，支持 "1,3,5-8"；缺省=每周

github:
  enabled: true
  repos:                    # 模式一：盯这些仓库的 Release（owner/name），不需要就留空 []
    - microsoft/TypeScript
  includePrerelease: false
  maxPerRepo: 3
  firstRunQuiet: true       # 首次运行只记录不推送，避免把历史版本全推一遍
  discover:                 # 模式二：中文区新项目加权榜（与 repos 可并存，也可只用其一）
    enabled: true
    minStars: 100           # star 下限
    createdWithinDays: 7    # 只看最近 N 天创建的仓库
    chineseOnly: true       # 名称/描述含中文且非日文才算"中文区"（启发式过滤）
    maxItems: 10
    poolSize: 200           # 参与打分的候选池：按 star 从高到低取前 N 个（上限 1000）
    weights:                # 榜单加权：star / 提交数 / issue 数
      stars: 0.4            # 只写 stars: 1 → 退回纯 star 排序（不请求活跃度数据）
      commits: 0.3
      issues: 0.3
    firstRunQuiet: false    # 首次运行直接展示当前榜单

rss:
  enabled: true
  maxPerFeed: 5
  firstRunQuiet: true
  feeds:                    # 任意 Atom/RSS 源
    - name: 阮一峰的网络日志
      url: https://www.ruanyifeng.com/blog/atom.xml

baiduhot:
  enabled: true
  maxItems: 10              # 每次推送热搜榜 Top 10，新上榜词条带 🆕

bilibili:
  enabled: false            # B 站热搜（与百度热搜分块展示）
  maxItems: 10

# 个人提醒：只在“临近”时才出现，避免天天刷“还有 300 天”。
personal:
  enabled: false
  anniversaries: []         # 纪念日/生日（每年重复）
  # - name: 生日
  #   date: "1998-03-15"
  anniversaryWithinDays: 30 # 距今天数 <= 该值才展示
  certChecks: []            # 自建域名证书到期探测（留空则不探测）
  # - name: 我的站点
  #   host: example.com
  certWarnDays: 30          # 剩余天数 <= 该值才提醒

notify:
  # enabled 缺省 = 自动：配了环境变量就发送，没配就跳过
  # enabled: true = 强制启用，缺环境变量按故障处理（任务退出码 1，便于在 CI 暴露配置遗漏）
  # enabled: false = 彻底关闭该渠道
  telegram:
    enabled: ~               # TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID（唯一收图片的渠道）
  feishu:
    enabled: ~               # FEISHU_WEBHOOK_URL (+ FEISHU_SECRET 加签)
  dingtalk:
    enabled: ~               # DINGTALK_WEBHOOK_URL (+ DINGTALK_SECRET 加签)
  wecom:
    enabled: ~               # WECOM_WEBHOOK_URL（企业微信群机器人）
  slack:
    enabled: ~               # SLACK_WEBHOOK_URL（Slack Incoming Webhook）

limits:
  maxCalendarEvents: 10
  maxReleases: 8
  maxRssItems: 10
  maxHotItems: 10
  summaryChars: 100         # Release/RSS/项目描述的摘要截断长度

schedule:                   # 定时发布：时刻只在 lockTime=true 时被程序用到
  morning: "08:00"          # 早报目标时刻（本地时区）
  evening: "21:00"          # 晚报目标时刻
  lockTime: false           # true = 在 runner 上等到目标时刻再发（占用 Actions 分钟数）
  maxWaitMinutes: 30        # lockTime=true 时的等待上限，超时则立即发送
                            # 想准点请交给 Worker 的 cron，见「定时与早晚报」

image:                      # 图片版报告
  enabled: true
  width: 900

quick:                      # 随时快报(快照语义,不写去重状态)
  enabled: true
  limits:
    maxHotItems: 5
    maxRssItems: 3
    maxReleases: 3
    maxCalendarEvents: 5
```

</details>

---

## 定时与早晚报

**准点靠 Cloudflare Worker 的 cron，不靠 GitHub 的 schedule。** 实测 GitHub 的定时任务是排队
执行的（本账号下早报常在凌晨或中午才到，排队 0~8 小时），而 `repository_dispatch` 触发后约
4 秒起跑、全程约 35 秒。所以 workflow 默认**不带** `on.schedule`，到点由 Worker 发一次 dispatch
（部署见 [`cloudflare/README.md`](cloudflare/README.md)）：

```toml
# cloudflare/wrangler.toml
[triggers]
crons = ["0 0 * * *", "0 13 * * *"]   # UTC：北京 08:00 早报 / 21:00 晚报
```

- cron 按 **UTC** 解释，换算公式：北京时间小时数 − 8；改完要 `npx wrangler deploy` 才生效
- 两处必须一致：`[triggers].crons` 与 `telegram-trigger.js` 里的 `CRON_JOBS` 键。只改前者会打一条
  「未登记的 cron 表达式」日志并且不触发（`tests/worker.test.js` 会替你盯住这个不一致）
- **不想部署 Worker？** 把 `.github/workflows/morning.yml` 里注释掉的 `on.schedule` 打开就能跑，
  只是到达时间受排队影响
- 报告是**早报还是晚报由程序按运行时刻的本地时间自动判定**（≥12 点即晚报），头部图标（🌅/🌙）与
  问候语随之切换；dispatch 的 `client_payload.mode` 也可直接指定
- **同一天同一时段只会发一次**：定时链路带 `scheduled: true`，成功推送后记录"今日已发"，重复触发
  不会重复推送；手动触发不计入该记录，所以手动预览后当天定时仍会正常送达
- `schedule.lockTime: true` 是让程序自己在 runner 上干等到目标时刻 —— 老办法，开启时必须同时把
  workflow 的 `timeout-minutes` 调到大于 `maxWaitMinutes`，否则任务会在等待中被杀掉、当天不发
- 仓库 60 天无活动会停用 GitHub 自带的 schedule（Worker 的 cron 不受影响），推个 commit 或手动
  Run 一次即可恢复
- 也可在 **Actions 页手动 Run workflow**：可选 `mode`（自动/快报/早报/晚报），勾选 `dryRun` 仅预览、`force` 强制重发

---

## 新项目榜怎么排名

`github.discover` 产出的是一个**榜单**，而不是单纯的"按星数排序"——只按 star 排，
榜单会被"冲星型"仓库占据：它们可能只有 1 次提交，却比持续迭代的工程型项目更靠前。
所以用三项指标加权：

```
得分 = ( 0.4·归一化(log1p(star)) + 0.3·归一化(log1p(提交数)) + 0.3·归一化(log1p(issue数)) ) × 100
```

- **先 `log1p` 再 min-max**：star 是重尾分布（几千 vs 几十），直接归一化会让头部独占
  1.0、其余全挤在 0 附近；取对数后中低段才拉得开，分数才有区分度
- **提交数 / issue 数**走 GraphQL 批量查询（一次 40 个仓库）。提交数在 REST 里没有便宜的
  端点，issue 计数走 REST 只能靠 Search API（限流很紧）；GraphQL 一次问完，且 `issues`
  天然不含 PR
- **归一化在整个候选池上做**（默认按 star 取前 200 个），所以得分跨天可比
- **降级**：没配 `GITHUB_TOKEN`、或 GraphQL 失败时，**不展示**这几项并退回按 star 排序，
  而不是把"取不到"显示成"0 提交"
- **调整权重**：`weights` 写什么比例都行（会自动归一化）；只写 `stars: 1` 就是纯 star
  排序，此时完全不请求活跃度数据。想多捞"低星高活跃"的项目就把 `poolSize` 调大

---

## 去重机制

`data/state.json` 记录去重游标（RSS 已推条目哈希、已推 Release id、已发现仓库 id、热搜已见词条），**只有推送成功后才落盘**：

- **CI 环境**：状态经 [actions/cache](https://github.com/actions/cache) 在两次运行间传递，**不写入仓库**——workflow 只需要 `contents: read` 权限，仓库历史也不会被机器人提交污染
- **首次运行**：RSS / GitHub Release 默认"静默建档"（只记录不推送），避免把历史内容全推一遍；热搜与新项目榜则是榜单语义，首轮直接展示当前榜单
- **本地环境**：状态就是本地 `data/state.json`（已 gitignore）；`--dry-run` 永远不写状态

---

## 容错设计

- **超时**：所有请求 10~15s 硬超时（`AbortSignal.timeout`），慢接口不会拖死任务
- **重试**：网络错误 / 429 / 5xx 指数退避重试（带抖动、尊重 `Retry-After`）；4xx 不重试
- **降级**：模块失败 → 报告顶部出现"⚠️ 模块故障"区块，其余区块照常；单条订阅失败 → 记入警告
- **发送**：Telegram HTML 解析失败自动降级纯文本重发；飞书 / 钉钉 / 企业微信校验返回码并提示常见错误（19021、310000、93000 等）；Slack 转义 `& < >` 并关掉链接展开；五个渠道并发，任一成功即算送达
- **退出码**：所有真实渠道都失败 → 退出码 1 → Actions 标红，且状态未落盘，下次重试

---

## 常见问题

<details>
<summary><b>收不到推送</b></summary>

先看 Actions 运行日志。"推送成功 1/1 个渠道"说明已发出；渠道侧排查：

- **Telegram 403**：需要先跟机器人对话一句，触发 chat.id 生成
- **飞书 19021**：加签的 timestamp/secret 不对；群机器人设了"关键词过滤"时，消息必须包含关键词
- **钉钉 310000**：安全设置没通过——加签的 timestamp/sign 不对，或"自定义关键词"没出现在标题/正文里
- **企业微信 93000**：webhook 地址里的 key 无效（机器人被删过就要重新添加）；45009 是发送频率超限
- **Slack invalid_payload / not_authed**：webhook 地址过期或没装到目标频道

</details>

<details>
<summary><b>去重状态丢了 / 重复推送</b></summary>

CI 状态在 actions/cache 里，长期不运行会被 GitHub 淘汰；淘汰后"首次静默"逻辑会重建基线，最多丢失一段去重记忆，不会刷屏。

</details>

<details>
<summary><b>GitHub Search API 限额</b></summary>

workflow 已注入 `GITHUB_TOKEN`（5000 次/小时）；本地调试可用匿名限额（60 次/小时）。

</details>

<details>
<summary><b>和风天气预警没出现</b></summary>

需要同时配置 `weather.qweather` 和 Secret `QWEATHER_API_KEY`。

</details>

---

## 扩展：新增一个信息源（完整示例）

下面以 **V2EX 热榜** 为例，从零加一个源。改动集中在 6 处，每处都只是"照葫芦画瓢加一段"，
不需要改动任何既有逻辑。单接口 JSON、带"新上榜"标记、不去重——这是最常见的一类源；
如果你要的源是 HTML，把 `httpGetJson` 换成 `httpGetText` + 解析即可（`src/modules/baiduhot.ts`
是最新的参考实现）。

### 1. 先定契约：`src/types.ts`

```ts
// ① 模块名联合里加一项（--only、故障区、runner 都用它）
export type ModuleName = 'weather' | ... | 'personal' | 'v2ex';

// ② 数据结构
export interface V2exTopic {
  rank: number;
  title: string;
  url?: string;
  /** 首次出现=true，报告里打 🆕 */
  isNew?: boolean;
}
export interface V2exSection {
  items: V2exTopic[];
}

// ③ 加进各模块返回数据的联合类型
export type SectionPayload = ... | V2exSection;

// ④ 跨运行的去重游标（只在需要"见过什么"时用）
export interface BotState {
  ...
  /** V2EX 热榜：已见过的主题 id（用于标记"新上榜"） */
  v2ex?: { seen?: string[] };
}

// ⑤ 配置项 + 挂到 BotConfig
export interface V2exConfig {
  enabled?: boolean;
  maxItems?: number;
}
export interface BotConfig {
  ...
  v2ex?: V2exConfig;
}

// ⑥ 报告上下文里多一个字段，渲染层从这里取
export interface ReportContext {
  ...
  v2ex: V2exTopic[];
}
```

### 2. 给默认值：`src/config.ts`

```ts
v2ex: {
  enabled: false,   // 新源一律默认关，别让用户升级后突然多出一块内容
  maxItems: 10,
},
```

### 3. 写抓取：`src/modules/v2ex.ts`

```ts
/**
 * V2EX 热榜：单接口 JSON，输出当前榜单快照。
 * seen 只用来打 🆕 标记，不做过滤——热榜的价值在于"今天整榜长什么样"。
 */
import { HttpError, httpGetJson } from '../utils/http';
import { pushCapped } from '../utils/state';
import type { FetchContext, ModuleResult, V2exSection, V2exTopic } from '../types';

const API_URL = 'https://www.v2ex.com/api/topics/hot.json';
const SEEN_CAP = 200;
const DEFAULT_MAX_ITEMS = 10;

interface V2exApiTopic {
  id?: unknown;
  title?: unknown;
  url?: unknown;
}

function reason(err: unknown): string {
  if (err instanceof HttpError) return `HTTP ${err.status}`;
  return err instanceof Error ? err.message : String(err);
}

export async function fetchV2ex(ctx: FetchContext): Promise<ModuleResult<V2exSection>> {
  const maxItems = ctx.cfg.v2ex?.maxItems ?? DEFAULT_MAX_ITEMS;

  if (!ctx.state.v2ex || !Array.isArray(ctx.state.v2ex.seen)) ctx.state.v2ex = { seen: [] };
  const prevSeen: string[] = ctx.state.v2ex.seen ?? [];

  let raw: V2exApiTopic[];
  try {
    raw = await httpGetJson<V2exApiTopic[]>(API_URL, { timeoutMs: 15_000 });
  } catch (err) {
    // 关键：失败是返回值，不是异常
    return { ok: false, data: null, error: `V2EX 热榜：${reason(err)}` };
  }

  const items: V2exTopic[] = [];
  let seen = prevSeen;
  // 接口哪天改成对象，这里也只是"没有可用条目"，不会炸
  for (const t of Array.isArray(raw) ? raw : []) {
    if (items.length >= maxItems) break;
    if (typeof t.title !== 'string' || !t.title.trim()) continue;
    const id = String(t.id ?? t.title);
    const item: V2exTopic = { rank: items.length + 1, title: t.title.trim() };
    if (typeof t.url === 'string' && /^https?:\/\//i.test(t.url)) item.url = t.url;
    if (!prevSeen.includes(id)) item.isNew = true;
    items.push(item);
    seen = pushCapped(seen, id, SEEN_CAP);
  }
  ctx.state.v2ex.seen = seen;

  if (items.length === 0) return { ok: false, data: null, error: 'V2EX 热榜：响应里没有可用条目' };
  return { ok: true, data: { items } };
}
```

### 4. 接进编排：`src/main.ts`

```ts
import { fetchV2ex } from './modules/v2ex';

// ① 注册 runner（和其它源并发跑）
if (wanted('v2ex') && cfg.v2ex?.enabled === true) runners.push({ name: 'v2ex', run: () => fetchV2ex(ctx) });

// ② 取结果，缺数据时给空数组而不是 undefined，渲染层就不用到处判空
const v2ex = (byName.get('v2ex')?.data as V2exSection | undefined)?.items ?? [];

// ③ 塞进报告上下文，并算进"今天有没有内容"
const reportCtx: ReportContext = { ..., v2ex, hasContent: ... || v2ex.length > 0 };
```

### 5. 排版：`src/render/report.ts`

```ts
function v2exBlock(items: V2exTopic[]): Block {
  const title = textTitle('🟠', 'V2EX 热榜', items.length);
  const text = [title];
  const html = [`<b>🟠 V2EX 热榜 · ${items.length} 条</b>`];
  items.forEach((t, i) => {
    const flag = t.isNew ? '🆕 ' : '';
    text.push(`${i + 1}. ${flag}${t.title}`);
    const safe = escapeHtml(t.title);
    // 动态文本一律先 escapeHtml：标题里一个 < 就能让 Telegram 整条消息被拒
    html.push(`${i + 1}. ${flag}${t.url ? `<a href="${escapeHtml(t.url)}">${safe}</a>` : safe}`);
  });
  return { text, html };
}

// renderReport() 里挂上（顺序即报告里的上下顺序）
if (ctx.v2ex.length > 0) blocks.push(v2exBlock(ctx.v2ex));
```

**图片版要单独加。** `src/render/image.ts` 是一张卡一个函数，不登记就只有文本版有这块内容：

```ts
if (ctx.v2ex?.length) add(() => buildV2exCard(probe, ctx.v2ex, theme, contentW));
```

`buildV2exCard` 抄 `buildBiliHotCard`（`LineSpec` 的 `style: 'title' | 'body' | 'muted'` +
`indent` + `maxLines` 就是全部排版 API），图片版会剥离 emoji，靠色块和竖条区分层次。

### 6. 配置与测试

`config/config.example.yaml` 里给一段带注释的样例（`enabled: false` 起步），
`src/modules/v2ex.ts` 配一个 `tests/v2ex.test.ts`。测试不碰网络，stub 掉 `fetch` 就够：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchV2ex } from '../src/modules/v2ex';
import { emptyState } from '../src/utils/state';
import { makeCfg } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const ctx = () => ({
  cfg: makeCfg({ v2ex: { enabled: true, maxItems: 2 } }),
  state: emptyState(),
  now: new Date('2026-09-15T08:00:00+08:00'),
  reportKind: 'morning' as const,
});

describe('fetchV2ex', () => {
  it('取当前榜并给没见过的主题打 🆕', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ id: 1, title: 'A', url: 'https://www.v2ex.com/t/1' }]), { status: 200 }),
    ));
    const res = await fetchV2ex(ctx());
    expect(res.ok).toBe(true);
    expect(res.data!.items[0]).toMatchObject({ title: 'A', isNew: true });
  });

  it('5xx 重试后仍失败时降级为 ok:false，绝不抛异常', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('down', { status: 503 })));
    await expect(fetchV2ex(ctx())).resolves.toMatchObject({ ok: false, data: null });
  });
});
```

### 验收清单

```bash
npm run typecheck && npm test                                   # CI 跑的就是这两条
npm run morning -- --only=v2ex --dry-run --no-image             # 只跑新源，只看日志
```

`--only` 点名的模块如果被 `enabled: false` 挡住，报告的「模块故障」区会直接写明"未启用"，
不会伪装成"今天没有新内容"——所以第一次跑之前记得在 `config/config.yaml` 里打开它。

### 必须遵守的四条约定

- **绝不 `throw`**：整源失败返回 `ok:false + error`，部分失败（单个 RSS 源、单个仓库）返回
  `ok:true + warnings`。两者都会自动进「模块故障」区，且不会拖垮其它源。
- **HTTP 只走 `src/utils/http.ts`**：超时、指数退避、尊重 `Retry-After` 都在那里；
  模块里裸调 `fetch` 是这个客户端文件顶部写明的硬性约定（`image.ts` 下载字体是唯一例外）。
- **状态只写 `ctx.state` 草稿**：不要自己读写文件，落盘时机由 `main.ts` 决定
  （只有推送成功才写；快报是快照语义，永远不落盘）。
- **`enabled` 是三态**：缺省=配了环境变量/依赖就自动、`true`=强制（缺配置按故障处理，
  退出码 1）、`false`=关闭。

## 扩展：再加一个推送渠道

渠道是表驱动的，加一个只要三步：

1. `src/notify/xxx.ts` 导出 `sendXxx(msg, opts, image?)`——`msg` 有 `text` 与 `html` 两版，
   非 Telegram 的渠道发 `text`；长文用 `src/notify/chunk.ts` 的 `chunkText`（按字符，
   Telegram 4096 是字符数）或 `chunkJsonBytes`（按进 JSON 请求体后的字节，
   企业微信/钉钉这类 4096 **字节** 上限的渠道用它，中文 3 字节、换行 2 字节）；
   收不了本地图片就 `console.error` 一行说明后只发文本，别抛错。
2. `src/main.ts` 的 `CHANNELS` 表里登记一行：`name`（同时是 `notify.<name>` 的配置键）、
   `required`（缺任一环境变量就自动跳过该渠道）、`send`。
3. `src/types.ts` 的 `NotifyConfig` 加一项开关，`.github/workflows/morning.yml` 的 `env`
   里加对应 Secrets，`config/config.example.yaml` 与 README 的渠道小节各补一段说明。

`src/notify/wecom.ts`（最简：无加签）和 `src/notify/dingtalk.ts`（加签：签名挂在 URL query
上）是两种典型形态的模板。

---

## 开发与测试

```bash
npm install
npm test          # 全量单元测试（188 用例：重试/去重/渲染/日历解析/渠道降级/发布锁/图片/加权评分/降水时段/倒计时/Worker）
npm run test:watch
npm run typecheck
```

---

## License

[MIT](LICENSE)

---

## Star History

如果觉得有用，欢迎 Star ⭐ 让更多人发现这个项目。

[![Star History Chart](https://api.star-history.com/svg?repos=Paper-Yuan/daily-digest-bot&type=Date)](https://star-history.com/#Paper-Yuan/daily-digest-bot&Date)
