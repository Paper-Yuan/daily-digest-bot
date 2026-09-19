/**
 * Slack Incoming Webhook 渠道。
 *
 * 版式选择:Slack 的 mrkdwn 用 `*粗体*` 与 `<url|label>`,和 Telegram 的 HTML 不通用,
 * 因此这里发报告的纯文本版(Slack 会把裸 URL 自动变成可点链接)。
 *
 * 容错设计:
 *  - text 里 < > 是链接语法 <url|label> 的定界符,内容里出现必须先转义成实体 —— 标题里
 *    一个 `<` 就能让整条消息以 invalid_formatted_text 被拒;& 刻意不动:它单独出现时 Slack
 *    原样显示,而报告里的链接满是 ?a=1&b=2,把 & 变成 &amp; 会让链接本身失效;
 *  - 先转义再分块,这样分块的长度计量算的就是实际发出去的长度(上限 4000 字符,压到 3000);
 *  - unfurl_links=false:报告里链接成串,不关掉的话每条 URL 都会展开成大段预览;
 *  - webhook 只能发文本与已托管的链接,本地生成的 PNG 传不上去,故只发文本。
 */

import { httpPostText } from '../utils/http';
import { chunkText } from './chunk';

/** 单条消息 4000 字符上限,留余量 */
const MAX_CHARS = 3000;

function escapeSlack(s: string): string {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function sendSlack(
  msg: { text: string },
  opts: { webhookUrl: string },
  image?: Buffer | null,
): Promise<void> {
  if (image && image.length > 0) {
    console.error('[notify:slack] Slack incoming webhook 收不了本地图片,本次仅发送文本报告');
  }
  for (const piece of chunkText(escapeSlack(msg.text), MAX_CHARS)) {
    // 成功时响应体是纯文本 "ok";4xx(如 invalid_payload)由统一客户端抛出 HttpError
    const body = await httpPostText(opts.webhookUrl, {
      text: piece,
      unfurl_links: false,
      unfurl_media: false,
    });
    const resp = body.trim();
    if (resp && resp !== 'ok') {
      throw new Error(`Slack 发送失败: ${resp.slice(0, 200)}`);
    }
  }
}
