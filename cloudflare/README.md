# Cloudflare Worker:Telegram 触发器 + 定时闹钟

部署后:在 Telegram 里发 **`/quick`** 约 1 分钟收到快报;每天 08:00 / 21:00 的早报晚报
也由它的 cron 准点唤起 Actions。不需要打开 GitHub 页面。

```
Telegram /quick ──→ ┌──────────────────┐ ─repository_dispatch──→ GitHub Actions ──→ 推送报告给你
Workers cron ────→  │ Cloudflare Worker │                              ↑
   到点唤起 ──────→  └──────────────────┘   只传"触发信号",报告内容不经过 Worker
```

## 为什么需要 Worker

项目本身是**零服务器**的:GitHub Actions 定时跑完就退出,没法 7×24 待在线上监听消息。
而 Telegram 的两种收信方式(webhook 推送 / long-polling 轮询)**都需要一个常驻端点**。
Cloudflare Workers 免费额度足够个人使用,且只当"门铃"——报告内容(天气、课表、日历)全程
不经过它,隐私边界干净。

> 替代方案:不用 Worker 的话,可以让 Actions 每 5 分钟轮询一次 Telegram。
> 代价是最多 5 分钟延迟,且 Actions 列表里每天多出 288 条运行记录。

## 部署步骤

### 1. 准备一个 GitHub Token(细粒度 PAT)

访问 <https://github.com/settings/personal-access-tokens/new>:

- **Token name**:随意,如 `digest-bot-trigger`
- **Expiration**:按需(过期后需重新生成并更新 Worker 变量)
- **Repository access** → Only select repositories → 选你 fork 或自建的 `daily-digest-bot`
- **Permissions** → Repository permissions → 找到 **Contents** → 设为 **Read and write**
  (只需这一项,不要给别的权限)
  > 为什么是 Contents:触发走的是 `POST /repos/{owner}/{repo}/dispatches`,该接口按 GitHub 官方文档要求 **Contents: write** 权限(Actions 权限不管用,给了也会 401/403)
- 生成并复制 token(`github_pat_...`)

### 2. 生成一个 webhook 密钥

随便一串随机字符,只允许字母、数字、`_`、`-`。例如:

```bash
openssl rand -hex 24
```

### 3. 部署 Worker

**方式一:后台网页(推荐,不用装任何工具)**

1. 登录 <https://dash.cloudflare.com> → 左侧 **Workers & Pages** → **Create** → **Worker**
2. 命名(如 `digest-bot-trigger`)→ **Deploy**
3. 点 **Edit code**,把本目录 `telegram-trigger.js` 的全部内容粘贴进去,覆盖原模板 → **Deploy**
4. 回到 Worker 页面 → **Settings** → **Variables and Secrets**,添加 5 个变量(全部选 **Secret** 类型):

   | 变量名 | 值 |
   | --- | --- |
   | `TELEGRAM_BOT_TOKEN` | 你的机器人 token(BotFather 给的) |
   | `TELEGRAM_CHAT_ID` | 允许触发的会话 id;多个用英文逗号分隔 |
   | `GITHUB_TOKEN` | 上一步的 PAT |
   | `GITHUB_REPO` | 你的 `owner/repo`,例如 `your-name/daily-digest-bot` |
   | `WEBHOOK_SECRET` | 上一步生成的密钥 |

5. 保存后记下 Worker 地址:`https://digest-bot-trigger.<你的子域>.workers.dev`

> 浏览器直接打开这个地址,看到 `digest-bot trigger worker is running` 就说明部署好了。

**方式二:命令行(已装 Node.js)**

```bash
npm install -g wrangler
cd cloudflare
wrangler login
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
wrangler secret put GITHUB_TOKEN
wrangler secret put WEBHOOK_SECRET
# GITHUB_REPO 写在 wrangler.toml 里,改成你的仓库即可
wrangler deploy
```

### 4. 把 webhook 指向 Worker

```bash
cd cloudflare
bash set-webhook.sh <BOT_TOKEN> <WORKER_URL> <WEBHOOK_SECRET>
```

这个脚本做三件事:设置 webhook(带 `secret_token`)、注册 `/quick` 与 `/help` 命令菜单、
打印当前 webhook 状态。看到 `"url": "https://..."` 且有 `"pending_update_count": 0` 即成功。

> ⚠️ webhook 与 `getUpdates` 互斥:设置 webhook 后,再用 `getUpdates` 查消息会返回 409。
> 这是正常的——消息现在由 Worker 实时接收,不再需要轮询。
> 想撤销:`curl "https://api.telegram.org/bot<TOKEN>/deleteWebhook"`

### 5. 试一下

在 Telegram 里给机器人发 **`/quick`**,应立刻收到「⚡ 收到,正在生成快报…大约 1 分钟后送达」,
随后收到报告。也可以发 `/help` 看命令列表。

## 可用命令

| 命令 | 作用 |
| --- | --- |
| `/quick`(或 `/k`) | 立刻生成一份快报(当前快照,不写去重状态,不影响早晚报) |
| `/help`、`/start` | 显示帮助 |

## 定时闹钟(早报 / 晚报)

这个 Worker 同时是定时任务触发器:`wrangler.toml` 的 `[triggers].crons` 到点调用
`telegram-trigger.js` 的 `scheduled()`,由它 POST `repository_dispatch` 唤起 Actions。

- cron 一律按 **UTC** 解释:`0 0 * * *` = 北京 08:00(早报),`0 13 * * *` = 北京 21:00(晚报)。
- 两处要一致:`[triggers].crons` 与代码里的 `CRON_JOBS`。只改前者会打一条
  「未登记的 cron 表达式」日志并且不触发,便于在 Workers Logs 里立刻发现。
- cron 只能随 `npx wrangler deploy` 生效 —— 上面那种"后台粘贴代码"的部署方式设不了 cron,
  要用定时就得装 wrangler(`npm i -g wrangler && wrangler login`)。
- 为什么不用 GitHub 的 `schedule`:实测它会排队 0~8 小时(早报常在凌晨或中午才到);
  dispatch 触发则约 4 秒起跑、全程约 35 秒。不想引入 Worker 时,workflow 里也留了
  一段注释掉的 `on.schedule` 兜底。
- 重复触发不会重复推送:定时链路带 `scheduled: true`,Actions 侧按"当日已发"幂等。

## 安全说明

- 这个 Worker 地址是**公开可访问**的,所以身份校验完全依赖 `secret_token` 请求头
  (Telegram 每次调用都会带上,别人猜不到)。缺少或不匹配一律返回 403。
- **`TELEGRAM_CHAT_ID` 白名单是第二道防线**:即使有人知道 Worker 地址和密钥,
  不在白名单里的会话也只会收到「没有触发权限」,不会消耗你的 Actions 额度。
- 建议把 `TELEGRAM_CHAT_ID` 只填你自己的会话 id(用 `/quick` 发给机器人时,
  日志里会打印实际到达的 chat id)。
- **60 秒冷却(按会话 + 命令)**:同一个命令连点(手抖双击、客户端重发)只会触发一次,
  但换一条命令不会被连带拦下。
- Worker 不存储任何报告数据,也不记录消息内容到持久存储。

## 排查

| 现象 | 原因与处理 |
| --- | --- |
| 发消息毫无反应 | webhook 没设成功。跑 `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"` 看 `last_error_message` |
| 回「⛔ 没有触发权限」 | `TELEGRAM_CHAT_ID` 没填对。先临时填错值发一次,Worker 日志里能看到实际的 chat id |
| 回「❌ 触发失败:HTTP 401」 | `GITHUB_TOKEN` 权限不足或已过期。确认 **Contents** 权限是 **Read and write**,且仓库选择正确 |
| 回「❌ 触发失败:HTTP 404」 | `GITHUB_REPO` 写错了(必须是 `owner/repo` 形式) |
| 回执正常但收不到报告 | 去仓库 **Actions** 页看是否有 `repository_dispatch` 触发的运行;若失败,看该次运行日志 |
| 回「⏳ 刚刚已经触发过了」 | 60 秒冷却,稍等再试 |

查看 Worker 运行日志:Cloudflare 后台 → 你的 Worker → **Logs**(实时流)。
