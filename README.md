# daily-digest-bot

> 🌅 每天早上醒来、晚上睡前，自动收到一条排版好的聚合报告——天气、日程、GitHub 新动态、RSS 订阅、热搜榜，推送到 Telegram 或飞书。零服务器成本，GitHub Actions 自动运行。

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A518.17-339933?logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License">
  <img src="https://github.com/Paper-Yuan/daily-digest-bot/actions/workflows/ci.yml/badge.svg" alt="CI">
</p>

## 为什么需要这个

信息分散在各个平台：日历在 Google Calendar、课表在教务系统、天气要专门打开 App、关注的技术博客和 GitHub 项目得主动去刷……每天早上要打开好几个应用才能知道"今天有什么事"。

这个 Bot 把它们**汇总成一条消息**，每天早上 8 点 + 晚上 9 点自动推送，你只需要看一眼 Telegram 或飞书：

- 🌤 **天气**：今天穿什么衣服？要不要带伞？
- 📅 **日程 / 课表**：今天有课吗？几点开会？
- 🚀 **GitHub**：关注的项目有新版本了吗？最近中文区有什么高星新项目？
- 🗞 **RSS 订阅**：阮一峰的周刊更新了吗？技术博客有新文章？
- 🔥 **百度热搜**：今天大家都在讨论什么？

跑在 GitHub Actions 上，**零服务器成本**，Fork 下来配几个密钥就能用。

---

## 长什么样

<details open>
<summary>📱 Telegram / 飞书 推送效果</summary>

```text
🌅 早报 · 2026-09-13 星期日 08:00
早上好！
────────────────────

▌🌤 天气 · 北京
☀️ 晴 ｜ 19 ~ 29°C（当前 21.0°C）
💧 降水概率 10%

▌📅 今日日程 · 2 条
• 全天 中秋假期（日历）
• 08:00-09:40 高等数学 @教三-101 · 第 1 周（课表）

▌🚀 GitHub 高星新项目 · 2 条
• cn/awesome-project ⭐ 3.2k · TypeScript
  一个很棒的新项目描述
  https://github.com/cn/awesome-project

▌🗞 订阅更新 · 1 条
• [阮一峰的网络日志] 科技爱好者周刊(第 xxx 期)
  http://www.ruanyifeng.com/blog/2026/09/weekly-issue-xxx.html

▌🔥 百度热搜 · 10 条
1. xxx热搜词条
2. 🆕 新上榜的词条
```

*Telegram 版本的摘要会渲染成带左侧竖条的引用块，视觉层次更清晰*

</details>

---

## 快速开始（3 步）

### 1. Fork 这个仓库

点击右上角 **Use this template** 或 **Fork**，建议设为 **Private**（你的订阅偏好属于个人隐私）。

### 2. 配置你想要的信息

复制 [`config/config.example.yaml`](config/config.example.yaml) 为 `config/config.yaml`，修改：

- **城市坐标**（天气）：去 [Open-Meteo](https://open-meteo.com/) 搜你的城市，复制经纬度
- **日历订阅链接**（可选）：Google Calendar / Apple 日历都能导出 ICS 链接
- **课表**（可选）：填写学期开始日期 + 每周的课程安排
- **GitHub 仓库**（可选）：填你想盯的仓库（如 `microsoft/TypeScript`），或开启高星新项目发现模式
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

**搞定！** 去 **Actions** 页启用 workflow，每天 08:00（早报）和 21:00（晚报）北京时间自动推送。也可以手动 Run 一次立即预览效果。

---

## 功能清单

| 模块 | 说明 | 亮点 |
| --- | --- | --- |
| 🌤 **天气** | Open-Meteo 免费无需 key；可选接入和风天气预警 | 实时温度 + 降水概率，出门前一眼决定穿衣 |
| 📅 **日历 / 课表** | 任意 ICS 订阅链接 + 本地课表配置 | 支持周次 `1-16`、`1,3,5-8`，自动过滤今天的事项 |
| 🚀 **GitHub** | 盯指定仓库的 Release；或自动发现高星新项目 | 可过滤"名称/描述含中文"的中文区项目 |
| 🗞 **RSS** | 任意 Atom/RSS 源，HTML 自动清洗成纯文本 | 首次运行"静默建档"，不会把历史文章全推一遍 |
| 🔥 **百度热搜** | 直连百度热搜榜接口，Top N 快照 | 新上榜词条带 🆕 标记 |
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

> 飞书自定义机器人 webhook 不支持直接传图，因此飞书渠道只发文本（图片能力仅 Telegram 可用）。

### ⚡ 随时快报

想随时看看"现在有什么"，有三种触发方式：

| 方式 | 操作 |
| --- | --- |
| **网页 / 手机 App** | Actions 页 → Run workflow → `mode` 选 `quick` |
| **一条链接（手机快捷指令/自动化）** | `POST /repos/{owner}/{repo}/actions/workflows/morning.yml/dispatches`，body `{"ref":"main","inputs":{"mode":"quick"}}` |
| **本地** | `npm run morning -- --quick --dry-run` |

**关键设计：快报是「快照」语义，不是「增量」。**

| 维度 | 早报 / 晚报 | 快报 |
| --- | --- | --- |
| 推送逻辑 | 只推上次之后的新内容 | 现在有什么就展示什么 |
| 去重状态 | 读 + 写 | **只读不写** |
| 条数上限 | 按 `limits` | 按 `quick.limits`，更精简 |
| 发布锁 | 生效 | 不生效（即时响应） |

之所以强调"不写状态"——否则会出现「下午发了条快报，把当天新文章标记为已读，第二天早报一条都没有」的隐蔽 bug。快报运行结束后所有状态改动都会被丢弃。

### 📝 项目单句介绍

GitHub 新项目自动提炼**一句话简介**：取描述的**首句**（中文句号/问号/叹号，或后接空格的英文句点），而不是把整段硬截成半句话。仓库没写描述时给「暂无简介」兜底，保证卡片信息结构一致。

---

## 工程特性

不是简单的"脚本拼接"，而是带**容错、去重、自动降级**的生产级系统：

- ✅ **单源故障不影响整份报告**：某个 RSS 源挂了？没关系，报告里会有"⚠️ 模块故障"区块告诉你哪里坏了，其余内容照常推送
- ✅ **统一 HTTP 客户端**：10s 硬超时 + 指数退避重试 + 尊重 `Retry-After`，慢接口不会拖死任务
- ✅ **去重机制"推送成功才落盘"**：发送失败 → 状态不写 → 下次运行自动重推同一批内容，消息不丢
- ✅ **CI 环境状态走 actions/cache**：不写入仓库历史，workflow 只需 `contents: read` 权限
- ✅ **Telegram HTML 自动降级**：解析失败自动切纯文本重发；飞书校验返回码并提示常见错误
- ✅ **图片渲染零依赖风险**：图像库放 `optionalDependencies`，加载失败自动退化为文本报告
- ✅ **86 个单元测试**：覆盖重试逻辑、去重机制、渲染效果、日历解析、渠道降级、发布锁、图片、简介提炼

---

## 本地运行（可选）

要求 Node.js ≥ 18.17。

```bash
npm install
cp config/config.example.yaml config/config.yaml   # 修改为自己的配置
npm run morning -- --dry-run --force               # 只打印不推送、不写状态
```

| 参数 | 作用 |
| --- | --- |
| `--dry-run` | 只预览，不推送、不写状态 |
| `--force` | 忽略去重状态，把当前可见内容全部输出（首次配置后的完整预览） |
| `--only=weather,rss` | 只跑指定模块（`weather` `calendar` `github` `rss` `baiduhot`） |
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
  discover:                 # 模式二：发现高星新项目（与 repos 可并存，也可只用其一）
    enabled: true
    minStars: 100           # star 下限
    createdWithinDays: 7    # 只看最近 N 天创建的仓库
    chineseOnly: true       # 名称/描述含中文才算"中文区"（启发式过滤）
    maxItems: 10
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

notify:
  # enabled 缺省 = 自动：配了环境变量就发送，没配就跳过
  # enabled: true = 强制启用，缺环境变量按故障处理（任务退出码 1，便于在 CI 暴露配置遗漏）
  # enabled: false = 彻底关闭该渠道
  telegram:
    enabled: ~
  feishu:
    enabled: ~

limits:
  maxCalendarEvents: 10
  maxReleases: 8
  maxRssItems: 10
  maxHotItems: 10
  summaryChars: 100         # Release/RSS/项目描述的摘要截断长度

schedule:                   # 定时发布
  morning: "08:00"          # 早报目标时刻(本地时区)
  evening: "21:00"
  lockTime: false           # true = 等到目标时刻再发(占 Actions 分钟数)
  maxWaitMinutes: 30        # lockTime=true 时的等待上限

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

```yaml
on:
  schedule:
    - cron: "0 0 * * *"   # UTC 00:00 = 北京时间 08:00 → 早报
    - cron: "0 13 * * *"  # UTC 13:00 = 北京时间 21:00 → 晚报
```

- 报告是**早报还是晚报由程序按运行时刻的本地时间自动判定**（≥12 点即晚报），头部图标（🌅/🌙）与问候语随之切换，无需额外配置；也可用 `--kind` 手动指定
- cron 是 **UTC** 时间，换算公式：北京时间小时数 − 8
- **GitHub 的定时任务是排队执行的**，高峰时段实际到达时间可能比目标晚几分钟到几十分钟 —— 这是平台行为，本项目如实接受，**不做等待补偿**（不为"准点"空耗 Actions 分钟数）
- 若确实需要尽量准点：把 cron 各提前 15~20 分钟，并设 `schedule.lockTime: true`，程序会等到目标时刻再发（代价是等待期间占用分钟数）
- **同一天同一时段只会发一次**：定时任务成功推送后记录"今日已发"；手动触发不计入该记录，所以手动预览后当天定时仍会正常送达
- 仓库 60 天无任何活动会停用定时任务，推个 commit 或手动 Run 一次即可恢复
- 也可在 **Actions 页手动 Run workflow**：可选 `mode`（自动/快报/早报/晚报），勾选 `dryRun` 仅预览、`force` 强制重发

---

## 去重机制

`data/state.json` 记录去重游标（RSS 已推条目哈希、已推 Release id、已发现仓库 id、热搜已见词条），**只有推送成功后才落盘**：

- **CI 环境**：状态经 [actions/cache](https://github.com/actions/cache) 在两次运行间传递，**不写入仓库**——workflow 只需要 `contents: read` 权限，仓库历史也不会被机器人提交污染
- **首次运行**：RSS / GitHub Release 默认"静默建档"（只记录不推送），避免把历史内容全推一遍；热搜与高星发现则是榜单语义，首轮直接展示当前榜单
- **本地环境**：状态就是本地 `data/state.json`（已 gitignore）；`--dry-run` 永远不写状态

---

## 容错设计

- **超时**：所有请求 10~15s 硬超时（`AbortSignal.timeout`），慢接口不会拖死任务
- **重试**：网络错误 / 429 / 5xx 指数退避重试（带抖动、尊重 `Retry-After`）；4xx 不重试
- **降级**：模块失败 → 报告顶部出现"⚠️ 模块故障"区块，其余区块照常；单条订阅失败 → 记入警告
- **发送**：Telegram HTML 解析失败自动降级纯文本重发；飞书校验返回码并提示常见错误（19021 加签错误等）
- **退出码**：所有真实渠道都失败 → 退出码 1 → Actions 标红，且状态未落盘，下次重试

---

## 常见问题

<details>
<summary><b>收不到推送</b></summary>

先看 Actions 运行日志。"推送成功 1/1 个渠道"说明已发出；渠道侧排查：

- **Telegram 403**：需要先跟机器人对话一句，触发 chat.id 生成
- **飞书 19021**：加签的 timestamp/secret 不对；群机器人设了"关键词过滤"时，消息必须包含关键词

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

## 扩展：新增一个信息源

1. 在 `src/types.ts` 定义你的 `XxxSection` 数据结构
2. 在 `src/modules/xxx.ts` 实现 `export async function fetchXxx(ctx: FetchContext): Promise<ModuleResult<XxxSection>>`——HTTP 走 `utils/http.ts`（自带超时重试），去重游标写在 `ctx.state` 草稿上，**不要 throw**，失败转成 `ok:false + error`
3. 在 `src/main.ts` 注册 runner、`src/types.ts` 的 `ReportContext` 加字段、`src/render/report.ts` 加一个区块
4. 在 `tests/` 补一个测试文件

`src/modules/baiduhot.ts` 是最新的最佳参考。

---

## 开发与测试

```bash
npm install
npm test          # 全量单元测试（62 用例：重试/去重/渲染/日历解析/渠道降级）
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
