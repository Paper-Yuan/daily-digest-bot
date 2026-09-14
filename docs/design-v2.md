# v2 设计方案:图片报告 · 发布锁 · 随时快报

> 版本:v1(2026-09-13) → v2(本文件对应实现)

## 一、总体目标

在 v1(五源聚合 + 早报晚报 + 双渠道 + 容错去重)基础上,补三块能力:

| # | 需求 | 要解决的真实痛点 |
| --- | --- | --- |
| 1 | **图片版报告** | 文本报告十几行,手机上不直观、不适合转发存档 |
| 2 | **发布时刻锁定** | GitHub Actions 定时会顺延 0~30 分钟,"8 点早报"可能 8:25 才到 |
| 3 | **随时快报** | 只在早晚两个点推送,临时想看看"现在有什么"做不到 |

---

## 二、改动 1:图片版报告

### 数据流

```
ReportContext ──→ renderReportImage(ctx, opts) ──→ Buffer(PNG) | null
                        │                              │
                        │ 失败/无字体 → null            └─→ 渠道发送(与文本一同)
                        └─ 降级:仅发送文本报告          ──→ Telegram sendPhoto
                                                          飞书:忽略图片(webhook 不支持)
                                                          控制台:存 data/out/*.png
```

### 技术选型与验证结论

- **渲染库**:`@napi-rs/canvas`(预编译原生库,无系统依赖;已实测安装成功并渲染 CJK)
- **中文字体**:**必须内置下载逻辑** —— 实测 GitHub Actions 的 Ubuntu runner 默认不含中文字体,
  不注册字体会渲染成空白/豆腐块。策略为三级回退:
  1. 环境变量 `DIGEST_FONT_PATH` 指定的本地字体(自托管场景)
  2. 本地缓存 `data/fonts/*.woff2`(CI 由 actions/cache 一并缓存,避免每次重复下载)
  3. 从 CDN 候选列表依次尝试下载(@fontsource 的 Noto Sans SC,已验证 200 / 1.1MB)
  - 三步全失败 → **返回 null**,降级纯文本。图片永远不能成为推送失败的原因。
- **字体体积**:Noto Sans SC 全量约 1.1MB。缓存到 `data/fonts/`,与 state 共用 cache。

### 版式

单张竖图,宽 900px(可配),自动裁剪底部空白:

```
┌──────────────────────────────┐
│ 🌅 早报   2026-09-13 星期日 08:00 │  ← 头部:渐变底/主题色随类型变化
│ 早上好!                        │
├──────────────────────────────┤
│ 🌤 天气 · 示例城市                  │  ← 卡片:标题 + 内容行
│ ☁️ 阴 ｜ 23 ~ 32°C(当前 28.8°C) │
│ 💧 降水概率 51%                 │
├──────────────────────────────┤
│ 🔥 百度热搜 · 10 条             │
│ 1. 词条…                       │
│ 2. 🆕 新上榜…                   │
├──────────────────────────────┤
│ 🚀 GitHub 高星新项目 · 7 条      │
│ • repo ⭐ 1.6k · HTML          │
│   描述(最多两行,超出省略)      │
└──────────────────────────────┘
```

- 主题色区分报告类型:早报暖橙、晚报深蓝、快报青色
- 长描述按可用宽度**自动折行**,最多 2 行,超出加省略号
- 每张卡片独立测量高度后累加绘制,最后按实际内容裁剪画布

### 渠道适配

| 渠道 | 行为 |
| --- | --- |
| Telegram | `sendPhoto` multipart 先发图片,再发文本(图文分离,文本仍可复制) |
| 飞书 | webhook API 不支持直接传图,忽略图片并记一行说明,文本照常 |
| 控制台 | 写入 `data/out/report-<ts>.png` 并打印路径与体积,便于本地肉眼检查 |

### 降级与测试

- 环境变量 `DIGEST_DISABLE_IMAGE=1` 或 CLI `--no-image` 可关闭
- 单测:加载失败路径(模拟 canvas 不可用)→ 断言返回 `null` 且不抛异常
- 验收:本地 `--dry-run` 生成 PNG;断网时报告仍以纯文本发出

---

## 三、改动 2:发布时刻锁定

### 核心洞察

**GitHub 的 cron 只会晚、不会早。** 因此反过来利用它:把 cron 设在目标时刻**之前**,
进程启动后等到目标时刻再发 —— 顺延量被提前量吸收,用户实际就是准点收到。

```
cron 07:40 启动 ──→ 今日早报已发? ──是──→ 直接退出(幂等)
                        │否
                        ↓
                     等到 08:00 ──→ 抓取+渲染+推送 ──→ 记录 sends.morning = 今天
```

### 配置

```yaml
schedule:
  morning: "08:00"      # 早报目标发布时刻(本地时区)
  evening: "21:00"      # 晚报目标发布时刻
  lockTime: true        # 早于目标则等待到点;false = 立即发送(退化为原行为)
  maxWaitMinutes: 30    # 等待上限:超时则放弃等待直接发,避免白占 CI 时长
```

### 关键设计点

- **仅 `--scheduled`(CI 定时)启用**:手动 Run、本地运行、快报都立即发送,不等待
- **当日幂等**:成功推送后写 `state.sends.{slot} = 'YYYY-MM-DD'`。
  同日同时段再触发(如你手动 Run 预览过)会被跳过 —— 解决"预览完 8 点又来一条"
- `--force` 可绕过幂等强制重发
- `--at=HH:mm` 用于调试:临时指定目标时刻,便于在 CI 上验证等待逻辑
- 等待上限兜底:宁可晚发也不能让 job 挂 30 分钟以上(workflow timeout 10 分钟需相应调整)

### 纯函数契约(`src/schedule.ts`,便于单测)

```ts
parseHm('08:00')            → { hour: 8, minute: 0 } | null     // 非法输入返回 null
slotForHour(11)             → 'morning'                        // <12 早报
slotForHour(12)             → 'evening'                        // >=12 晚报
targetTime(hm, now, tz)     → Date                             // 今天的该时刻(绝对时间)
waitMillis(now, target, max)→ 0 | 正数 | null(超上限放弃)
alreadySentToday(state, slot, ymd) → boolean
markSent(state, slot, ymd)  → void
```

### workflow 调整

```yaml
- cron: "40 23 * * *"   # UTC 23:40 = 北京 07:40 启动 → 锁 08:00 发布
- cron: "40 12 * * *"   # UTC 12:40 = 北京 20:40 启动 → 锁 21:00 发布
```

---

## 四、改动 3:随时快报

### 语义界定(最关键的设计决策)

**快报 = 快照,早晚报 = 增量。** 二者去重语义必须严格区分:

| 维度 | 早报 / 晚报 | 快报 |
| --- | --- | --- |
| 语义 | **增量**:只推上次之后的新内容 | **快照**:现在有什么就展示什么 |
| 去重状态 | 读 + 写 | **只读不写**(运行结束丢弃全部状态改动) |
| 条数上限 | `limits` | `quick.limits`,更精简 |
| 发布锁 | 生效 | **不生效**(即时响应) |
| 头部 | 🌅 早报 / 🌙 晚报 | ⚡ 快报 |

**为什么快照必须不写状态**:否则会出现"下午 3 点发个快报,把当天新文章标记为已读,
第二天早报就一条 RSS 都没有了"的隐蔽 bug。实现上在 `main.ts` 用 `structuredClone`
拿到草稿状态,快报分支**直接不调用 `saveStateAtomic`**,改动随进程结束丢弃。

### 触发方式

| 方式 | 操作 | 凭证 |
| --- | --- | --- |
| Actions 网页/手机 App | Run workflow → mode 选 `quick` | 登录即可 |
| 手机快捷指令 / 自动化 | `POST /repos/{owner}/{repo}/actions/workflows/morning.yml/dispatches`,body `{"ref":"main","inputs":{"mode":"quick"}}` | 细粒度 PAT(仅需 Actions: write) |
| repository_dispatch | `POST /repos/{owner}/{repo}/dispatches`,body `{"event_type":"quick-report"}` | 同上 |
| 本地 | `npm run morning -- --quick --dry-run` | 无 |

### 精简条数

```yaml
quick:
  enabled: true
  limits:
    maxHotItems: 5        # 热搜 10 → 5
    maxRssItems: 3        # RSS 10 → 3
    maxReleases: 3        # Release 8 → 3
    maxCalendarEvents: 5  # 日程 10 → 5
```

---

## 五、与同类项目的差异化

调研详见 [`docs/competitive-analysis.md`](./competitive-analysis.md)。设计上**主动放弃**已被做好的方向:

- ❌ 多平台热榜聚合(微博/知乎/抖音全聚合)—— TrendRadar 等已做得非常全
- ❌ Web 面板 / 数据库 / 历史归档 —— 需要服务器,违背零成本定位
- ❌ 关键词监控 / 舆情预警 —— 已有专门工具

**主动强化**的差异化(同类项目普遍缺失):

- ✅ **个人上下文**:带周次的课表、ICS 日程、所在城市天气 —— 通用热榜工具没有这些私有信息
- ✅ **图片卡片**:一张可直接转发的战报图,同类几乎都是纯文本
- ✅ **准点发布**:用"提前启动 + 锁点等待"补偿 CI 延迟,而非忍受顺延
- ✅ **快照不污染增量**:快报与早晚报游标严格隔离(多数同类工具会踩这个坑)

---

## 六、文件改动清单

| 文件 | 改动 |
| --- | --- |
| `src/types.ts` | 新增 `ReportKind`、`ScheduleConfig`、`ImageConfig`、`QuickConfig`;`LimitsConfig.maxHotItems`;`BotState.sends`;`ReportContext.reportKind` 扩为三值 |
| `src/config.ts` | 三块新配置的默认值 |
| `src/schedule.ts` | **新增**:发布锁纯函数 |
| `src/render/image.ts` | **新增**:图片渲染(含字体获取与降级) |
| `src/render/report.ts` | 头部支持 ⚡ 快报 |
| `src/utils/http.ts` | 新增 `httpPostForm`(multipart,用于 sendPhoto) |
| `src/notify/telegram.ts` | 支持发图(先图后文,图失败降级) |
| `src/notify/feishu.ts` | 接受图片参数但忽略(webhook 限制),记一行说明 |
| `src/notify/console.ts` | 保存图片到 `data/out/` 便于调试 |
| `src/main.ts` | 发布锁、快报快照语义、图片集成、`quick.limits` 覆盖 |
| `package.json` | `@napi-rs/canvas` 放入 `optionalDependencies` |
| `.github/workflows/morning.yml` | cron 改提前触发 + `--scheduled`;新增 `mode` 输入与 `repository_dispatch` |
| `tests/` | 新增 `schedule.test.ts`、图片降级测试;更新受影响的既有断言 |
| README / config.example | 同步三块新能力 |

## 七、验收标准

1. `npm run typecheck && npm test` 全绿
2. 本地 `--dry-run` 生成 PNG,肉眼确认 CJK 正常、排版不溢出
3. `--quick --dry-run` 后 `data/state.json` **内容不变**(快照语义)
4. CI 实跑一次 `--scheduled --at=<近未来>` 验证等待到点
5. 断网/无字体场景:报告仍以纯文本成功推送
6. 手动 Run 一次早报后,同日 `--scheduled` 运行被幂等跳过
