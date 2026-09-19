/**
 * 企业微信群机器人 webhook 渠道(markdown)。
 *
 * 与其他渠道的差异:
 *  - webhook 地址本身即凭证(`.../webhook/send?key=...`),没有加签;
 *  - 单条 markdown 上限 4096 **字节**(整个请求体,中文 3 字节/字、换行在 JSON 里算 2 字节),
 *    所以按序列化后的字节分块;
 *  - 图片要先经 media/upload 换 media_id,群机器人 webhook 没这个权限,故只发文本;
 *  - 返回体 errcode 非 0 才算失败,45009(频率超限)与 93000(key 无效)最常见。
 */

import { httpPostJson } from '../utils/http';
import { chunkJsonBytes } from './chunk';

interface WecomResponse {
  errcode?: number;
  errmsg?: string;
}

/** 请求体 4096 字节硬上限;外层 JSON 骨架约 47 字节,正文按 4000 收 */
const MAX_BODY_BYTES = 4000;

export async function sendWecom(
  msg: { text: string },
  opts: { webhookUrl: string },
  image?: Buffer | null,
): Promise<void> {
  if (image && image.length > 0) {
    console.error('[notify:wecom] 企业微信 webhook 不支持图片,本次仅发送文本报告');
  }
  for (const piece of chunkJsonBytes(msg.text, MAX_BODY_BYTES)) {
    const res = await httpPostJson<WecomResponse>(opts.webhookUrl, {
      msgtype: 'markdown',
      markdown: { content: piece },
    });
    const code = res.errcode ?? 0;
    if (code !== 0) {
      throw new Error(
        `企业微信发送失败(errcode=${code}): ${res.errmsg ?? '(返回体中无错误信息)'}。`
          + '93000=webhook key 无效;45009=机器人发送频率超限',
      );
    }
  }
}
