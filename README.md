# daily-digest-bot · 个人专属「聚合信息早报 + 晚报」

每天 **早上 8 点（早报）+ 晚上 9 点（晚报）**，自动把下面这些信息汇总成一条排版好的消息，推送到你的 **Telegram** 或**飞书**：

- 🌤 **天气**：实时预报 + 降水概率，可选接入和风天气预警
- 📅 **日历 / 课表**：任意 ICS 日历订阅链接 + 本地课表（支持周次 `1-16`、`1,3,5-8`）
- 🚀 **GitHub**：盯指定仓库的 Release；或自动**发现高星新项目**（支持"名称/描述含中文"的中文区过滤）
- 🗞 **RSS 订阅**：任意 Atom/RSS 源，HTML 自动清洗成纯文本摘要
- 🔥 **百度热搜**：直连百度热搜榜接口，每次推送 Top N 快照，新上榜词条带 🆕

跑在 **GitHub Actions** 上——**零服务器成本**，Fork 下来配几个 Secret 就能用。

```text
🌅 早报 | 2026-09-13 星期日 08:00
早上好!

🌤 天气 · 你的城市
☀️ 晴 19.2 ~ 29.4°C(当前 21.0°C)| 降水概率 10%

🚀 GitHub 高星新项目 (2)
• cn/awesome-project ⭐ 321 [TypeScript]
  一个很棒的新项目描述
  https://github.com/cn/awesome-project

🗞 订阅更新 (2)
• [阮一峰的网络日志] 科技爱好者周刊(第 xxx 期)
  http://www.ruanyifeng.com/blog/2026/09/weekly-issue-xxx.html
```

---

## 目录

1. [工作原理](#工作原理)
2. [快速开始](#快速开始)
3. [本地运行](#本地运行)
4. [配置详解](#配置详解)
5. [推送渠道接入](#推送渠道接入)
6. [定时与早晚报](#定时与早晚报)
7. [去重与状态机制](#去重与状态机制)
8. [容错设计](#容错设计)
9. [扩展:新增一个信息源](#扩展新增一个信息源)
10. [常见问题](#常见问题)

## 工作原理

```text
config/config.yaml ──┐
                     ├─→ main.ts 编排:五个信息源并发抓取 ──→ render/report.ts 渲染
Secrets(密钥) ───────┘         │ 单源故障自动降级                ├─ 纯文本(控制台/飞书)
                                ↓                                └─ Telegram HTML
                     推送成功 ──→ data/state.json 记录去重游标
                     推送失败 ──→ 状态不落盘,下次自动重推
```

每个信息源是一个独立模块（`src/modules/`），遵守统一契约：**绝不抛异常**，失败只降级；
单条订阅挂了不影响整份报告；全部失败时报告里会出现"⚠️ 模块故障"区块，告诉你哪里坏了。

## 快速开始

### 方式一：GitHub Actions 全自动（推荐）

1. **Fork 或使用本模板创建你自己的仓库**（建议 **Private**，你的订阅偏好属于个人隐私）；
2. 复制 `config/config.example.yaml` 为 `config/config.yaml`，按下面的[配置详解](#配置详解)修改
   （城市坐标、订阅源、课表等——这份文件**不含任何密钥**，可以放心提交）；
3. 仓库 **Settings → Secrets and variables → Actions** 添加推送渠道密钥（见[推送渠道接入](#推送渠道接入)）；
4. **Actions 页**启用 workflow。搞定，每天 08:00 / 21:00（北京时间）自动收到推送。

### 方式二：本地运行

要求 Node.js ≥ 18.17。

```bash
npm install
cp config/config.example.yaml config/config.yaml   # 修改为自己的配置
npm run morning -- --dry-run --force               # 只打印不推送、不写状态
```

| 参数 | 作用 |
| --- | --- |
| `--dry-run` | 只预览,不推送、不写状态 |
| `--force` | 忽略去重状态,把当前可见内容全部输出(首次配置后的完整预览) |
| `--only=weather,rss` | 只跑指定模块(`weather` `calendar` `github` `rss` `baiduhot`) |
| `--config=path` | 指定配置文件(默认 `config/config.yaml`,也可用环境变量 `CONFIG_PATH`) |

## 配置详解

配置文件是 `config/config.yaml`（由 `config/config.example.yaml` 复制修改）。**所有密钥一律走环境变量，不进配置文件。**

```yaml
timezone: Asia/Shanghai     # "今天"以此时区为准,与 Actions 机器的 UTC 无关

user:
  name: ""                  # 报告开头的称呼,如 "同学";留空则不称呼

weather:
  enabled: true
  locationName: 北京        # 仅用于展示
  latitude: 39.9042         # Open-Meteo 免费、无需 key(城市坐标自行查询)
  longitude: 116.4074
  # 可选:接入和风天气预警(免费订阅 host 用 devapi.qweather.com)
  # qweather:
  #   host: devapi.qweather.com
  #   locationId: "101010100"   # 城市 LocationID 见和风文档,key 走环境变量 QWEATHER_API_KEY

calendar:
  enabled: true
  ics:                      # ICS 日历订阅链接(Google/Apple 日历均可导出),可为空列表
    - name: 我的日历
      url: ""
  courses:                  # 课表(可选),与 ICS 合并展示
    semesterStart: "2026-09-07"   # 学期第 1 周的周一
    items:
      - name: 高等数学
        weekday: 1         # 1=周一 ... 7=周日
        start: "08:00"
        end: "09:40"
        location: 教三-101
        teacher: 张三
        weeks: "1-16"      # 周次,支持 "1,3,5-8";缺省=每周

github:
  enabled: true
  repos:                    # 模式一:盯这些仓库的 Release(owner/name),不需要就留空 []
    - microsoft/TypeScript
  includePrerelease: false
  maxPerRepo: 3
  firstRunQuiet: true       # 首次运行只记录不推送,避免把历史版本全推一遍
  discover:                 # 模式二:发现高星新项目(与 repos 可并存,也可只用其一)
    enabled: true
    minStars: 100           # star 下限
    createdWithinDays: 7    # 只看最近 N 天创建的仓库
    chineseOnly: true       # 名称/描述含中文才算"中文区"(启发式过滤)
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
  maxItems: 10              # 每次推送热搜榜 Top 10,新上榜词条带 🆕

notify:
  # enabled 缺省 = 自动:配了环境变量就发送,没配就跳过
  # enabled: true = 强制启用,缺环境变量按故障处理(任务退出码 1,便于在 CI 暴露配置遗漏)
  # enabled: false = 彻底关闭该渠道
  telegram:
    enabled: ~
  feishu:
    enabled: ~

limits:
  maxCalendarEvents: 10
  maxReleases: 8
  maxRssItems: 10
  summaryChars: 100         # Release/RSS/项目描述的摘要截断长度
```

## 推送渠道接入

两个渠道都配就都会发；只配其一就发其一。

### Telegram

1. 找 [@BotFather](https://t.me/BotFather) 发送 `/newbot` 创建机器人，拿到 **token**；
2. 与你的机器人随便对话一句，然后访问
   `https://api.telegram.org/bot<TOKEN>/getUpdates`，在返回中找到 `chat.id`；
3. 仓库 **Settings → Secrets → Actions** 添加：
   - `TELEGRAM_BOT_TOKEN` —— BotFather 给的 token
   - `TELEGRAM_CHAT_ID` —— 上一步拿到的 chat.id

### 飞书

1. 在目标群里添加「自定义机器人」（群设置 → 群机器人 → 添加），勾选**加签**，
   拿到 **webhook 地址**与**签名密钥**；
2. 添加 Secrets：`FEISHU_WEBHOOK_URL`、`FEISHU_SECRET`（未加签则不需要 SECRET）。

> 控制台渠道永远可用：报告内容始终会打印在 Actions 日志里，方便排查。

## 定时与早晚报

```yaml
on:
  schedule:
    - cron: "0 0 * * *"   # UTC 00:00 = 北京时间 08:00 → 早报
    - cron: "0 13 * * *"  # UTC 13:00 = 北京时间 21:00 → 晚报
```

- 报告是**早报还是晚报由程序按运行时刻的本地时间自动判定**（≥12 点即晚报），
  头部图标（🌅/🌙）与问候语（早上好/晚上好）随之切换，无需额外配置；
- cron 是 **UTC** 时间，换算公式：北京时间小时数 − 8；
- GitHub 定时任务可能顺延 0~30 分钟，属正常现象；
- 仓库 60 天无任何活动会停用定时任务，推个 commit 或手动 Run 一次即可恢复；
- 也可在 **Actions 页手动 Run workflow**：勾选 `dryRun` 仅预览、勾选 `force` 忽略去重做全量预览。

## 去重与状态机制

`data/state.json` 记录去重游标（RSS 已推条目哈希、已推 Release id、已发现仓库 id、热搜已见词条），
**只有推送成功后才落盘**：发送失败 → 状态不写 → 下次运行自动重推同一批内容，消息不丢。

- **CI 环境**：状态经 [actions/cache](https://github.com/actions/cache) 在两次运行间传递，
  **不写入仓库**——workflow 只需要 `contents: read` 权限，仓库历史也不会被机器人提交污染；
- **首次运行**：RSS / GitHub Release 默认"静默建档"（只记录不推送），避免把历史内容全推一遍；
  热搜与高星发现则是榜单语义，首轮直接展示当前榜单；
- **本地环境**：状态就是本地 `data/state.json`（已 gitignore）；`--dry-run` 永远不写状态。

## 容错设计

- **超时**：所有请求 10~15s 硬超时（`AbortSignal.timeout`），慢接口不会拖死任务；
- **重试**：网络错误 / 429 / 5xx 指数退避重试（带抖动、尊重 `Retry-After`）；4xx 不重试；
- **降级**：模块失败 → 报告顶部出现"⚠️ 模块故障"区块，其余区块照常；单条订阅失败 → 记入警告；
- **发送**：Telegram HTML 解析失败自动降级纯文本重发；飞书校验返回码并提示常见错误（19021 加签错误等）；
- **退出码**：所有真实渠道都失败 → 退出码 1 → Actions 标红，且状态未落盘，下次重试。

## 扩展:新增一个信息源

1. 在 `src/types.ts` 定义你的 `XxxSection` 数据结构；
2. 在 `src/modules/xxx.ts` 实现
   `export async function fetchXxx(ctx: FetchContext): Promise<ModuleResult<XxxSection>>`
   —— HTTP 走 `utils/http.ts`（自带超时重试），去重游标写在 `ctx.state` 草稿上，
   **不要 throw**，失败转成 `ok:false + error`（整体）或 `warnings`（单源）；
3. 在 `src/main.ts` 注册 runner、`src/types.ts` 的 `ReportContext` 加字段、
   `src/render/report.ts` 加一个区块；
4. 在 `tests/` 补一个测试文件。`src/modules/baiduhot.ts` 是最新的最佳参考。

## 开发与测试

```bash
npm install
npm test          # 全量单元测试(62 用例:重试/去重/渲染/日历解析/渠道降级)
npm run test:watch
npm run typecheck
```

## 常见问题

- **收不到推送**：先看 Actions 运行日志。"推送成功 1/1 个渠道"说明已发出；
  渠道侧排查见 Telegram / 飞书接入说明（403 通常是没先跟机器人对话过）。
- **飞书返回 19021**：加签的 timestamp/secret 不对；群机器人设了"关键词过滤"时，消息必须包含关键词。
- **Telegram 429**：内置重试已处理限流；消息过长会自动分块。
- **去重状态丢了/重复推送**：CI 状态在 actions/cache 里，长期不运行会被 GitHub 淘汰；
  淘汰后"首次静默"逻辑会重建基线，最多丢失一段去重记忆，不会刷屏。
- **GitHub Search API 限额**：workflow 已注入 `GITHUB_TOKEN`（5000 次/小时）；本地调试可用匿名限额（60 次/小时）。
- **和风天气预警没出现**：需要同时配置 `weather.qweather` 和 Secret `QWEATHER_API_KEY`。

## License

[MIT](LICENSE)
