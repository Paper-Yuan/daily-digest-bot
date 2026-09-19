/** 推送渠道:各 webhook 的加签与错误契约、Telegram 分块与 HTML 降级 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendFeishu } from '../src/notify/feishu';
import { sendTelegram } from '../src/notify/telegram';
import { sendDingtalk } from '../src/notify/dingtalk';
import { sendWecom } from '../src/notify/wecom';
import { sendSlack } from '../src/notify/slack';
import { chunkBytes, chunkJsonBytes, chunkText } from '../src/notify/chunk';

function okRes(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

afterEach(() => vi.unstubAllGlobals());

describe('sendFeishu', () => {
  it('带 secret 时携带加签字段', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okRes({ code: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    await sendFeishu({ text: '你好早报' }, { webhookUrl: 'https://open.feishu.cn/hook/x', secret: 's3cret' });

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.msg_type).toBe('text');
    expect(body.content).toEqual({ text: '你好早报' });
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.sign).toBe('string');
  });

  it('无 secret 时不带签名字段', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okRes({ code: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    await sendFeishu({ text: 'plain' }, { webhookUrl: 'https://open.feishu.cn/hook/x' });

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.timestamp).toBeUndefined();
    expect(body.sign).toBeUndefined();
  });

  it('code 非 0 抛错并带错误详情(如加签错误 19021)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okRes({ code: 19021, msg: 'sign match fail' })));
    await expect(
      sendFeishu({ text: 'x' }, { webhookUrl: 'https://open.feishu.cn/hook/x', secret: 'wrong' }),
    ).rejects.toThrow(/19021/);
  });

  it('旧版返回体 StatusCode=0 视为成功', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okRes({ StatusCode: 0 })));
    await expect(
      sendFeishu({ text: 'x' }, { webhookUrl: 'https://open.feishu.cn/hook/x' }),
    ).resolves.toBeUndefined();
  });
});

describe('sendTelegram', () => {
  it('默认发送 HTML 版式', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okRes({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await sendTelegram({ text: '纯文本', html: '<b>粗体</b>' }, { botToken: 'T', chatId: '42' });

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.chat_id).toBe('42');
    expect(body.parse_mode).toBe('HTML');
    expect(body.text).toBe('<b>粗体</b>');
  });

  it('HTML 解析失败自动降级为纯文本重发', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okRes({ ok: false, description: "Bad Request: can't parse entities: tag <x>" }))
      .mockResolvedValue(okRes({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await sendTelegram({ text: '纯文本内容', html: '<b>坏</b>标签' }, { botToken: 'T', chatId: '42' });

    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string) as Record<string, unknown>);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.parse_mode).toBe('HTML');
    expect(bodies[1]?.parse_mode).toBeUndefined();
    expect(bodies[1]?.text).toBe('纯文本内容');
  });

  it('非解析类错误直接抛出', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okRes({ ok: false, description: 'Forbidden: chat not found' })));
    await expect(
      sendTelegram({ text: 'x', html: 'x' }, { botToken: 'T', chatId: '42' }),
    ).rejects.toThrow('chat not found');
  });
});

describe('sendDingtalk', () => {
  it('发 markdown 消息,标题取报告首行并去掉排版符号', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okRes({ errcode: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    await sendDingtalk({ text: '▌🌤 天气 · 北京\n多云' }, { webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=x' });

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toBe('https://oapi.dingtalk.com/robot/send?access_token=x');
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as Record<string, any>;
    expect(body.msgtype).toBe('markdown');
    expect(body.markdown.title).toBe('🌤 天气 · 北京');
    expect(body.markdown.text).toContain('多云');
  });

  it('加签时 timestamp/sign 挂在 query 上,而不是请求体', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okRes({ errcode: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    await sendDingtalk({ text: '早报' }, { webhookUrl: 'https://oapi.dingtalk.com/robot/send', secret: 's3cret' });

    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(/^\d{13}$/.test(url.searchParams.get('timestamp') ?? '')).toBe(true);
    expect(url.searchParams.get('sign')).toBeTruthy();
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.timestamp).toBeUndefined();
    expect(body.sign).toBeUndefined();
  });

  it('errcode 非 0 抛错并点出安全设置', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okRes({ errcode: 310000, errmsg: 'keyword not in content' })));
    await expect(
      sendDingtalk({ text: 'x' }, { webhookUrl: 'https://oapi.dingtalk.com/robot/send' }),
    ).rejects.toThrow(/310000.*自定义关键词/s);
  });
});

describe('sendWecom', () => {
  it('发 markdown content,不加签', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okRes({ errcode: 0, errmsg: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await sendWecom({ text: '▌🌅 早报\n内容' }, { webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k' });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as Record<string, any>;
    expect(body).toEqual({ msgtype: 'markdown', markdown: { content: '▌🌅 早报\n内容' } });
  });

  it('中文按字节分块:每条请求体都不越过 4096 字节硬上限', async () => {
    // Response 的 body 只能读一次,分块发送时每条都要一个新响应
    const fetchMock = vi.fn().mockImplementation(async () => okRes({ errcode: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    // 每行 100 个汉字 = 300 字节,20 行 6000 字节 → 至少 2 条
    const text = Array.from({ length: 20 }, () => '早'.repeat(100)).join('\n');
    await sendWecom({ text }, { webhookUrl: 'https://qyapi.weixin.qq.com/send' });

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of fetchMock.mock.calls) {
      expect(Buffer.byteLength(String((call[1] as RequestInit).body), 'utf8')).toBeLessThanOrEqual(4096);
    }
  });

  it('errcode 非 0 抛错(如 93000 key 无效)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okRes({ errcode: 93000, errmsg: 'invalid webhook url' })));
    await expect(
      sendWecom({ text: 'x' }, { webhookUrl: 'https://qyapi.weixin.qq.com/send' }),
    ).rejects.toThrow(/93000.*webhook key 无效/s);
  });
});

describe('sendSlack', () => {
  it('响应 ok 视为成功,并关掉链接预览展开', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await sendSlack({ text: '早报正文 https://example.com' }, { webhookUrl: 'https://hooks.slack.com/services/x' });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.unfurl_links).toBe(false);
    expect(body.unfurl_media).toBe(false);
  });

  it('转义 < >(Slack 的链接定界符),但保留 & 以免打断链接里的查询参数', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await sendSlack({ text: 'a<b & c>d https://x.test/?a=1&b=2' }, { webhookUrl: 'https://hooks.slack.com/services/x' });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as { text: string };
    expect(body.text).toBe('a&lt;b & c&gt;d https://x.test/?a=1&b=2');
  });

  it('响应体不是 ok 时抛错(如 not_authed)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not_authed', { status: 200 })));
    await expect(
      sendSlack({ text: 'x' }, { webhookUrl: 'https://hooks.slack.com/services/x' }),
    ).rejects.toThrow('not_authed');
  });
});

describe('chunkText', () => {
  it('按换行边界聚块', () => {
    expect(chunkText('a\nbb\nccc', 5)).toEqual(['a\nbb', 'ccc']);
  });

  it('单行超长时硬切', () => {
    expect(chunkText('abcdef', 2)).toEqual(['ab', 'cd', 'ef']);
  });

  it('不产生空块', () => {
    expect(chunkText('', 10)).toEqual(['']);
  });
});

describe('chunkBytes', () => {
  it('中文按 UTF-8 字节计量:3 字节/字', () => {
    const chunks = chunkBytes(`${'早'.repeat(10)}\n${'早'.repeat(10)}`, 30);
    expect(chunks).toEqual(['早'.repeat(10), '早'.repeat(10)]);
  });

  it('单行超上限时按字节硬切,不会把多字节字符切一半', () => {
    expect(chunkBytes('早早早', 4)).toEqual(['早', '早', '早']);
    // 代理对:emoji 占 2 个 code unit / 4 字节,切点不能落在半个 emoji 上
    const emoji = chunkBytes('🔥'.repeat(10), 7);
    expect(emoji).toEqual(Array.from({ length: 10 }, () => '🔥'));
    for (const piece of emoji) expect(piece).not.toMatch(/[\uD800-\uDBFF]$/); // 结尾不能是半个 emoji
  });
});

describe('chunkJsonBytes', () => {
  it('换行按 JSON 里的 2 字节算,而不是一字节', () => {
    // 5 行 x 4 字节:裸文本 24 字节,进 JSON 后 28 字节 → 26 的上限只装得下 4 行
    const s = ['aaaa', 'aaaa', 'aaaa', 'aaaa', 'aaaa'].join('\n');
    expect(Buffer.byteLength(s, 'utf8')).toBe(24);
    expect(Buffer.byteLength(JSON.stringify(s), 'utf8') - 2).toBe(28);
    expect(chunkJsonBytes(s, 26)).toEqual(['aaaa\naaaa\naaaa\naaaa', 'aaaa']);
  });
});
