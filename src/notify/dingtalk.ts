/**
 * 钉钉群机器人 webhook 渠道(markdown)。
 *
 * 加签规则(secret 存在时):以 secret 为 key 对 `${timestamp}\n${secret}` 做
 * HMAC-SHA256 → base64 → URL 编码,和 timestamp 一起拼在 webhook 的 query 上
 * (与企业微信把 key 放 query、飞书把签名放请求体都不同)。
 *
 * 容错设计:
 *  - 单条按 UTF-8 字节分块(中文 3 字节/字),避免整条被拒;
 *  - markdown 的 title 取报告首行:它出现在会话列表与推送横幅里,机器人开
 *    "自定义关键词"安全设置时也是靠它命中;
 *  - webhook 无法上传本地图片(需要企业内部应用凭证),故只发文本;
 *  - 正文用文本版式:裸 URL 原样出现,可复制不可点(钉钉 markdown 只认 [文字](链接))。
 */

import * as crypto from 'crypto';
import { httpPostJson } from '../utils/http';
import { chunkJsonBytes } from './chunk';

interface DingtalkResponse {
  errcode?: number;
  errmsg?: string;
}

/** 单条按请求体的 UTF-8 字节计,留足余量给 JSON 骨架与标题 */
const MAX_BODY_BYTES = 18_000;

function sign(secret: string, timestamp: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}\n${secret}`)
    .digest('base64');
}

/** 加签机器人的 timestamp / sign 只能挂在 query 上 */
function signedUrl(webhookUrl: string, secret: string): string {
  const ts = Date.now().toString();
  const sep = webhookUrl.includes('?') ? '&' : '?';
  return `${webhookUrl}${sep}timestamp=${ts}&sign=${encodeURIComponent(sign(secret, ts))}`;
}

/** 通知横幅与会话列表显示的是标题:取首个非空行,去掉文本版的排版符号 */
function markdownTitle(text: string): string {
  const first = text.split('\n').find((line) => line.trim().length > 0) ?? '每日报告';
  return first.replace(/[▌•]/g, '').trim().slice(0, 60);
}

export async function sendDingtalk(
  msg: { text: string },
  opts: { webhookUrl: string; secret?: string },
  image?: Buffer | null,
): Promise<void> {
  if (image && image.length > 0) {
    console.error('[notify:dingtalk] 钉钉 webhook 不支持图片,本次仅发送文本报告');
  }
  const title = markdownTitle(msg.text);
  for (const piece of chunkJsonBytes(msg.text, MAX_BODY_BYTES)) {
    // 时间戳与签名按条实时生成,避免多块发送时签名过期
    const url = opts.secret ? signedUrl(opts.webhookUrl, opts.secret) : opts.webhookUrl;
    const res = await httpPostJson<DingtalkResponse>(url, {
      msgtype: 'markdown',
      markdown: { title, text: piece },
    });
    const code = res.errcode ?? 0;
    if (code !== 0) {
      throw new Error(
        `钉钉发送失败(errcode=${code}): ${res.errmsg ?? '(返回体中无错误信息)'}。`
          + '310000 一般是安全设置没通过:加签时间戳/密钥不对,或自定义关键词没出现在标题与正文里',
      );
    }
  }
}
