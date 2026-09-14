/**
 * Telegram 渠道:HTML 版式优先,HTML 解析失败自动降级纯文本重发。
 *
 * 容错设计:
 *  - 单条消息上限 4096 字符,超长按换行边界切块按序发送;
 *    html 版切块上限压到 3800,给标签/转义留出余量,避免贴边被拒;
 *  - 429 限流由 httpPostJson 内部自动重试(尊重 Retry-After),此处不处理;
 *  - HTTP 200 但 body.ok !== true 时:若 description 疑似实体解析错误(含 'parse'),
 *    改用纯 text 版本(不带 parse_mode)整份重发一次,仍失败才抛错。
 */

import { httpPostForm, httpPostJson } from '../utils/http';

/** sendMessage 返回体(只取关心的字段) */
interface TelegramResponse {
  ok?: boolean;
  description?: string;
}

/** 官方单条上限 4096 字符,纯文本切块用 */
const TEXT_CHUNK_MAX = 4096;
/** html 版留余量:切块上限 3800,降低"标签贴边被拒/被切断"的概率 */
const HTML_CHUNK_MAX = 3800;

/**
 * 按换行边界把文本切成每块不超过 maxLen 的数组;仅单行超长时才硬切。
 * 行优先聚块,保证早报里的条目/摘要尽量不被拦腰截断。
 */
export function chunkText(s: string, maxLen: number): string[] {
  if (!Number.isFinite(maxLen) || maxLen < 1) {
    throw new Error(`chunkText: maxLen 必须为正数,收到 ${maxLen}`);
  }
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0; // current 用 '\n' 连接后的长度

  const flush = (): void => {
    const joined = current.join('\n');
    current = [];
    currentLen = 0;
    // 丢弃空块:空消息会被 Telegram 拒收
    if (joined.length > 0) chunks.push(joined);
  };

  for (const line of s.split('\n')) {
    // 单行超长:先收掉已攒的内容,再按 maxLen 硬切
    if (line.length > maxLen) {
      flush();
      for (let i = 0; i < line.length; i += maxLen) {
        chunks.push(line.slice(i, i + maxLen));
      }
      continue;
    }
    const nextLen = current.length === 0 ? line.length : currentLen + 1 + line.length;
    if (nextLen > maxLen) {
      flush();
      current = [line];
      currentLen = line.length;
    } else {
      current.push(line);
      currentLen = nextLen;
    }
  }
  flush();
  return chunks.length > 0 ? chunks : [s];
}

/** 发送单条消息;parseMode 缺省表示纯文本(不带 parse_mode 字段) */
async function postMessage(
  opts: { botToken: string; chatId: string },
  text: string,
  parseMode?: 'HTML',
): Promise<TelegramResponse> {
  const body: Record<string, unknown> = {
    chat_id: opts.chatId,
    text,
    disable_web_page_preview: true,
  };
  if (parseMode) body.parse_mode = parseMode;
  return httpPostJson<TelegramResponse>(
    `https://api.telegram.org/bot${opts.botToken}/sendMessage`,
    body,
  );
}

/**
 * 发送图片(sendPhoto,multipart)。
 * HTTP 层失败交给 httpPostForm 重试;返回体 ok=false 时抛错,由调用方决定是否降级。
 */
async function postPhoto(
  opts: { botToken: string; chatId: string },
  image: Buffer,
): Promise<TelegramResponse> {
  const form = new FormData();
  form.append('chat_id', opts.chatId);
  form.append('photo', new Blob([image], { type: 'image/png' }), 'report.png');
  return httpPostForm<TelegramResponse>(
    `https://api.telegram.org/bot${opts.botToken}/sendPhoto`,
    form,
  );
}

export async function sendTelegram(
  msg: { text: string; html: string },
  opts: { botToken: string; chatId: string },
  image?: Buffer | null,
): Promise<void> {
  // 图片先发:消息按序到达,用户先看到战报图,再看到可复制的文本明细。
  // 图片失败不影响文本推送(降级为纯文本报告),仅在日志里说明。
  if (image && image.length > 0) {
    try {
      const res = await postPhoto(opts, image);
      if (res.ok !== true) {
        console.error(`[notify:telegram] 图片发送失败,已降级为仅文本: ${res.description ?? '未知原因'}`);
      }
    } catch (err) {
      console.error(`[notify:telegram] 图片发送异常,已降级为仅文本: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 第一遍:html 版逐块按序发送
  let parseError = '';
  for (const piece of chunkText(msg.html, HTML_CHUNK_MAX)) {
    const res = await postMessage(opts, piece, 'HTML');
    if (res.ok === true) continue;
    const desc = res.description ?? '(返回体中无 description)';
    // 疑似 HTML 实体解析失败:整份降级为纯文本重发一次
    if (desc.includes('parse')) {
      parseError = desc;
      break;
    }
    throw new Error(`Telegram 发送失败: ${desc}`);
  }
  if (!parseError) return;

  // 降级重发:纯 text 版,不带 parse_mode。已成功的 html 块会重复,
  // 但宁可重复也不能丢内容(状态只在整份发送成功后才落盘)。
  for (const piece of chunkText(msg.text, TEXT_CHUNK_MAX)) {
    const res = await postMessage(opts, piece);
    if (res.ok !== true) {
      const desc = res.description ?? '(返回体中无 description)';
      throw new Error(`Telegram 纯文本重发仍失败: ${desc}(首次解析错误: ${parseError})`);
    }
  }
}
