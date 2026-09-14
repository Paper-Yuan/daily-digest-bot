/**
 * 飞书自定义机器人 webhook 渠道(纯文本)。
 *
 * 加签规则(secret 存在时):HMAC-SHA256 的 key 是 `${timestamp}\n${secret}`,
 * 消息体为空字符串,结果 base64 —— 这是飞书官方的签名算法,与常见"key=secret"不同。
 *
 * 容错设计:
 *  - 超过 6000 字符按换行边界分块,逐条顺序发送;
 *  - 返回 code(新版)/StatusCode(旧版)非 0 视为失败,错误信息带上官方提示,
 *    方便排查加签错误(19021)与关键词拦截这两类最常见问题;
 *  - HTTP 层错误(超时/429/5xx)由 httpPostJson 统一重试,此处不处理。
 */

import * as crypto from 'crypto';
import { httpPostJson } from '../utils/http';
import { chunkText } from './telegram';

/** 飞书返回体:新版 { code, msg },旧版 { StatusCode, StatusMessage } */
interface FeishuResponse {
  code?: number;
  msg?: string;
  StatusCode?: number;
  StatusMessage?: string;
}

/** 单条消息字符上限,超过则分块 */
const MAX_CHARS = 6000;

/** 飞书加签:key 是 `${timestamp}\n${secret}`,消息体为空字符串 */
function feishuSign(secret: string, timestamp: string): string {
  const stringToSign = `${timestamp}\n${secret}`;
  return crypto.createHmac('sha256', stringToSign).update('').digest('base64');
}

export async function sendFeishu(
  msg: { text: string },
  opts: { webhookUrl: string; secret?: string },
  image?: Buffer | null,
): Promise<void> {
  // 飞书自定义机器人 webhook 只接受文本/富文本,不支持直接上传图片
  // (上传图片需要企业发展示应用凭证走 image API,超出 webhook 能力)。
  // 因此这里忽略图片,报告以文本形式送达。
  if (image && image.length > 0) {
    console.error('[notify:feishu] 飞书 webhook 不支持图片,本次仅发送文本报告');
  }
  // chunkText 对不超限的文本原样返回单块,无需单独判断
  for (const piece of chunkText(msg.text, MAX_CHARS)) {
    // 时间戳与签名按条实时生成,避免多块发送时签名过期
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload: Record<string, unknown> = {
      msg_type: 'text',
      content: { text: piece },
    };
    if (opts.secret) {
      payload.timestamp = timestamp;
      payload.sign = feishuSign(opts.secret, timestamp);
    }
    const res = await httpPostJson<FeishuResponse>(opts.webhookUrl, payload);
    const code = res.code ?? res.StatusCode;
    if (code !== 0) {
      const detail = res.msg ?? res.StatusMessage ?? '(返回体中无错误信息)';
      throw new Error(
        `飞书发送失败(code=${code}): ${detail}。常见:19021=加签时间戳/密钥错误;关键词不匹配会被拦截`,
      );
    }
  }
}
