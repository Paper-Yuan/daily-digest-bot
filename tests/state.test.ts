/** 状态持久化与去重工具 */

import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  emptyState,
  loadState,
  pushCapped,
  pushCappedNumber,
  saveStateAtomic,
  shortHash,
} from '../src/utils/state';

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'mrb-')), 'state.json');
}

describe('state 持久化', () => {
  it('保存后能原样读回', () => {
    const file = tmpFile();
    const st = emptyState();
    st.github = { repos: { 'a/b': { seenIds: [1, 2], lastPublishedAt: '2026-09-12T10:00:00Z' } } };
    st.rss = { feeds: { 'https://f.example/rss': { seen: ['h1', 'h2'] } } };

    saveStateAtomic(file, st);
    expect(loadState(file)).toEqual(st);
  });

  it('文件不存在时返回空状态', () => {
    expect(loadState(join(tmpdir(), 'mrb-nonexistent-dir', 'state.json'))).toEqual({ version: 1 });
  });

  it('损坏的文件返回空状态而不抛异常', () => {
    const file = tmpFile();
    writeFileSync(file, '{broken json', 'utf8');
    expect(loadState(file)).toEqual({ version: 1 });
  });
});

describe('去重工具', () => {
  it('shortHash 稳定、区分输入、长度 16', () => {
    expect(shortHash('https://a')).toBe(shortHash('https://a'));
    expect(shortHash('https://a')).not.toBe(shortHash('https://b'));
    expect(shortHash('https://a')).toHaveLength(16);
  });

  it('pushCapped 去重且只保留最近 keep 个', () => {
    let list: string[] = [];
    for (let i = 0; i < 5; i++) list = pushCapped(list, `h${i}`, 3);
    expect(list).toEqual(['h2', 'h3', 'h4']);
    expect(pushCapped(list, 'h4', 3)).toEqual(['h2', 'h3', 'h4']); // 重复不新增
  });

  it('pushCappedNumber 同样去重封顶', () => {
    let list: number[] = [];
    for (let i = 1; i <= 4; i++) list = pushCappedNumber(list, i, 2);
    expect(list).toEqual([3, 4]);
  });
});
