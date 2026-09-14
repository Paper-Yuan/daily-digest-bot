#!/usr/bin/env bash
# 注册 Telegram webhook 与命令菜单(部署完 Worker 后跑一次)。
#
# 用法:
#   ./set-webhook.sh <BOT_TOKEN> <WORKER_URL> <WEBHOOK_SECRET>
# 例:
#   ./set-webhook.sh 123456:ABC... https://digest-bot-trigger.xxx.workers.dev my-random-secret
#
# 说明:webhook 一旦设置,getUpdates 就会失效(两者互斥),这正是我们想要的
# —— 由 Worker 实时接收消息,而不是让 Actions 每 5 分钟去轮询。

set -euo pipefail

BOT_TOKEN="${1:-}"
WORKER_URL="${2:-}"
WEBHOOK_SECRET="${3:-}"

if [[ -z "$BOT_TOKEN" || -z "$WORKER_URL" || -z "$WEBHOOK_SECRET" ]]; then
  echo "用法: $0 <BOT_TOKEN> <WORKER_URL> <WEBHOOK_SECRET>" >&2
  exit 1
fi

# secret_token 只允许 A-Z a-z 0-9 _ - ,这里先本地校验,免得等服务端报错
if ! [[ "$WEBHOOK_SECRET" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "错误:WEBHOOK_SECRET 只能包含字母、数字、下划线和连字符。" >&2
  exit 1
fi

API="https://api.telegram.org/bot${BOT_TOKEN}"

echo "==> 1/3 设置 webhook"
curl -sS -X POST "${API}/setWebhook" \
  -H 'Content-Type: application/json' \
  -d "$(cat <<JSON
{
  "url": "${WORKER_URL}",
  "secret_token": "${WEBHOOK_SECRET}",
  "allowed_updates": ["message"]
}
JSON
)"
echo

echo "==> 2/3 注册命令菜单(在 Telegram 输入框敲 / 就能看到提示)"
curl -sS -X POST "${API}/setMyCommands" \
  -H 'Content-Type: application/json' \
  -d '{"commands":[{"command":"quick","description":"立刻生成一份快报"},{"command":"help","description":"查看帮助"}]}'
echo

echo "==> 3/3 当前 webhook 状态"
curl -sS "${API}/getWebhookInfo"
echo
echo "完成。现在在 Telegram 里给机器人发 /quick 试试(首次约 1 分钟送达)。"
