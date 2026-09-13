/**
 * 状态(去重游标)的读写与通用小工具。
 *
 * 为什么状态要持久化:RSS / GitHub Release 的去重必须跨运行生效,
 * 而本项目的运行环境是 GitHub Actions(每次都是全新容器),
 * 所以状态落地为仓库里的 data/state.json,由 CI 在发送成功后提交回仓库。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { BotState } from '../types';

export function emptyState(): BotState {
  return { version: 1 };
}

export function loadState(filePath: string): BotState {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as BotState;
    if (parsed && parsed.version === 1) return parsed;
  } catch {
    // 文件不存在或损坏:从空状态开始(首次运行会进入 firstRunQuiet 逻辑)
  }
  return emptyState();
}

/** 原子写入:先写临时文件再 rename,避免 CI 中途被读到半截 JSON */
export function saveStateAtomic(filePath: string, state: BotState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

/** 短哈希,作为 RSS 条目的去重标识 */
export function shortHash(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 16);
}

/** 追加并去重,只保留最近 keep 个(新项在尾部) */
export function pushCapped(list: string[], item: string, keep: number): string[] {
  const next = list.includes(item) ? list : [...list, item];
  return next.slice(Math.max(0, next.length - keep));
}

export function pushCappedNumber(list: number[], item: number, keep: number): number[] {
  const next = list.includes(item) ? list : [...list, item];
  return next.slice(Math.max(0, next.length - keep));
}
