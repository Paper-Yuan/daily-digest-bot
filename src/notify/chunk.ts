/**
 * 长文本分块:优先按换行边界聚块,只有单行超限才硬切,
 * 这样条目/摘要不会被拦腰截断。
 *
 * 为什么还要按字节:企业微信与钉钉的上限按请求体的 UTF-8 字节算,而报告正文几乎全是
 * 中文(1 字 3 字节)、每条又是一行,只按字符数会整条被拒。chunkJsonBytes 更进一步,
 * 按"塞进 JSON 之后"的字节算(换行占 2 字节),这才是渠道真正比对的那个数。
 */

type Measure = (s: string) => number;

const charWidth: Measure = (s) => s.length;
const byteWidth: Measure = (s) => Buffer.byteLength(s, 'utf8');
/**
 * 按"塞进 JSON 请求体之后"的字节数计量:换行在 JSON 字符串里是 `\n` 两个字节,
 * 而企业微信/钉钉的 4096 上限算的是整个请求体 —— 只按裸文本算会低估。
 * 减 2 是去掉 JSON.stringify 自己加的一对引号。
 */
const jsonByteWidth: Measure = (s) => Buffer.byteLength(JSON.stringify(s), 'utf8') - 2;

/** 返回不超过 limit 的最长前缀长度(至少 1 个字符,避免死循环) */
function largestFit(s: string, measure: Measure, limit: number): number {
  if (measure(s.slice(0, 1)) > limit) return 1;
  let lo = 1;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(s.slice(0, mid)) <= limit) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * 硬切点:不能停在代理对中间(半个 emoji 出去就是乱码)。
 * 落点正好是高代理位就退一格;单个 emoji 都比上限长时,宁可整头发出去。
 */
function fitUnits(s: string, n: number): number {
  let cut = n;
  while (cut > 1 && /[\uD800-\uDBFF]$/.test(s.slice(0, cut))) cut -= 1;
  if (cut === 1 && /^[\uD800-\uDBFF]/.test(s)) cut = Math.min(2, s.length);
  return cut;
}

function chunkBy(s: string, measure: Measure, limit: number, label: string): string[] {
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error(`${label}: limit 必须为正数,收到 ${limit}`);
  }
  const chunks: string[] = [];
  let current: string[] = [];

  const flush = (): void => {
    const joined = current.join('\n');
    current = [];
    // 丢弃空块:空消息会被渠道拒收
    if (joined.length > 0) chunks.push(joined);
  };

  for (const line of s.split('\n')) {
    // 单行超限:先收掉已攒的内容,再按度量硬切
    if (measure(line) > limit) {
      flush();
      let rest = line;
      while (rest.length > 0) {
        const n = fitUnits(rest, largestFit(rest, measure, limit));
        chunks.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      continue;
    }
    // 换行的长度随度量而变(字符 1、字节 1、JSON 里 2),所以按实际拼接结果计量
    const joined = current.length === 0 ? line : `${current.join('\n')}\n${line}`;
    if (current.length > 0 && measure(joined) > limit) {
      flush();
      current = [line];
    } else {
      current.push(line);
    }
  }
  flush();
  return chunks.length > 0 ? chunks : [s];
}

/** 按字符数分块(Telegram 的 4096 是字符上限) */
export function chunkText(s: string, maxChars: number): string[] {
  return chunkBy(s, charWidth, maxChars, 'chunkText');
}

/** 按 UTF-8 字节数分块(企业微信 / 钉钉的上限按字节算) */
export function chunkBytes(s: string, maxBytes: number): string[] {
  return chunkBy(s, byteWidth, maxBytes, 'chunkBytes');
}

/** 按"进入 JSON 请求体后"的字节数分块(换行算 2 字节),给按请求体计上限的 webhook 用 */
export function chunkJsonBytes(s: string, maxBytes: number): string[] {
  return chunkBy(s, jsonByteWidth, maxBytes, 'chunkJsonBytes');
}
