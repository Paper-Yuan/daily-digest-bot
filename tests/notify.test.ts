/** 推送渠道:飞书加签与错误契约、Telegram 分块与 HTML 降级 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendFeishu } from '../src/notify/feishu';
import { chunkText, sendTelegram } from '../src/notify/telegram';

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
