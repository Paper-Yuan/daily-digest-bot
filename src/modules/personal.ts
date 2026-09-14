/**
 * 个人向提醒模块:纪念日/生日倒计时 + 自建域名证书到期探测。
 *
 * 两块都只在"临近"时才出现在报告里(默认 30 天内),否则天天刷"还有 300 天"
 * 只是噪音。两块互相独立,一块失败不影响另一块。
 *
 * 说明:纪念日靠日期计算(不联网);证书探测走 TLS 握手拿 peer certificate,
 * 因此需要能被访问到该域名 —— 服务器不可达或握手失败时只记警告。
 */

import * as tls from 'tls';
import { pad2, zonedParts } from '../utils/date';
import type {
  AnniversaryInfo,
  CertInfo,
  FetchContext,
  ModuleResult,
  PersonalSection,
} from '../types';

const DEFAULT_ANNIVERSARY_WITHIN = 30;
const DEFAULT_CERT_WARN = 30;
const DEFAULT_CERT_TIMEOUT = 8000;

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 计算下次发生日期与剩余天数(每年重复,含 2 月 29 日的降级处理)。
 *
 * 为什么不用 Date 直接加年:2 月 29 日在平年不存在,`new Date(y, 1, 29)` 会
 * 溢出成 3 月 1 日,导致倒计时差一天。这里显式判断:平年把 2/29 归到 2/28。
 */
export function nextAnniversary(
  dateYmd: string,
  todayYmd: string,
): { nextDate: string; daysLeft: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd);
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayYmd);
  if (!m || !t) return null;
  const [, , mm, dd] = m;
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const today = Date.UTC(Number(t[1]), Number(t[2]) - 1, Number(t[3]));
  const at = (year: number): number => {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return Date.UTC(year, month - 1, Math.min(day, lastDay));
  };

  let year = Number(t[1]);
  let cand = at(year);
  if (cand < today) {
    year += 1;
    cand = at(year);
  }
  const daysLeft = Math.round((cand - today) / 86_400_000);
  const y = new Date(cand).getUTCFullYear();
  const mo = String(new Date(cand).getUTCMonth() + 1).padStart(2, '0');
  const d = String(new Date(cand).getUTCDate()).padStart(2, '0');
  return { nextDate: `${y}-${mo}-${d}`, daysLeft };
}

/**
 * 从 X.509 证书的 valid_to 字段解析到期日。
 *
 * 格式形如 `Dec 10 12:00:00 2026 GMT`。用 `Date.parse` 解析:V8 能识别这个
 * 非 ISO 但标准的 ASN.1 时间格式;解析失败返回 null 而不是 NaN 日期。
 */
export function parseCertValidTo(validTo: string): Date | null {
  const t = Date.parse(validTo);
  return Number.isNaN(t) ? null : new Date(t);
}

/** 剩余天数:按"整天"算,避免同一天因时差显示成 0 或 1 的抖动 */
export function daysUntil(target: Date, from: Date): number {
  const a = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const b = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  return Math.round((a - b) / 86_400_000);
}

/** 探测单个域名的证书到期时间 */
function probeCert(host: string, port: number, timeoutMs: number): Promise<{ validTo: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };
    const socket = tls.connect(
      { host, port, servername: host, timeout: timeoutMs },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          if (!cert || typeof cert.valid_to !== 'string' || !cert.valid_to) {
            done(() => reject(new Error('对端未提供证书')));
          } else {
            done(() => resolve({ validTo: cert.valid_to }));
          }
        } catch (err) {
          done(() => reject(err instanceof Error ? err : new Error(String(err))));
        } finally {
          socket.destroy();
        }
      },
    );
    socket.on('timeout', () => {
      socket.destroy();
      done(() => reject(new Error(`连接超时(${timeoutMs}ms)`)));
    });
    socket.on('error', (err: Error) => {
      socket.destroy();
      done(() => reject(err));
    });
  });
}

export async function fetchPersonal(
  ctx: FetchContext,
): Promise<ModuleResult<PersonalSection>> {
  const cfg = ctx.cfg.personal ?? {};
  const warnings: string[] = [];
  const anniversaries: AnniversaryInfo[] = [];
  const certs: CertInfo[] = [];

  // "今天"按配置时区算,与报告其它部分口径一致(CI 机器是 UTC,不能用本地时间)
  const zp = zonedParts(ctx.now, ctx.cfg.timezone);
  const todayYmd = `${zp.year}-${pad2(zp.month)}-${pad2(zp.day)}`;

  // ---- 纪念日:纯日期计算,不会失败 ----
  const within = cfg.anniversaryWithinDays ?? DEFAULT_ANNIVERSARY_WITHIN;
  for (const a of cfg.anniversaries ?? []) {
    if (!a?.name || !a?.date) continue;
    const next = nextAnniversary(a.date, todayYmd);
    if (!next) {
      warnings.push(`纪念日 ${a.name}: 日期格式应为 YYYY-MM-DD`);
      continue;
    }
    if (next.daysLeft > within) continue; // 还早,不展示
    const item: AnniversaryInfo = {
      name: a.name,
      date: a.date,
      daysLeft: next.daysLeft,
      nextDate: next.nextDate,
    };
    const originYear = Number(a.date.slice(0, 4));
    const nextYear = Number(next.nextDate.slice(0, 4));
    const years = nextYear - originYear;
    if (years >= 1) item.years = years;
    anniversaries.push(item);
  }
  anniversaries.sort((x, y) => x.daysLeft - y.daysLeft);

  // ---- 证书:逐域名探测,单个失败只记警告 ----
  const warnDays = cfg.certWarnDays ?? DEFAULT_CERT_WARN;
  const timeoutMs = cfg.certTimeoutMs ?? DEFAULT_CERT_TIMEOUT;
  for (const c of cfg.certChecks ?? []) {
    if (!c?.host) continue;
    const name = c.name || c.host;
    try {
      const { validTo } = await probeCert(c.host, c.port ?? 443, timeoutMs);
      const parsed = parseCertValidTo(validTo);
      if (!parsed) {
        warnings.push(`证书 ${name}: 无法解析到期时间`);
        continue;
      }
      const daysLeft = daysUntil(parsed, ctx.now);
      if (daysLeft > warnDays) continue; // 还早,不展示
      certs.push({
        name,
        host: c.host,
        validTo: parsed.toISOString().slice(0, 10),
        daysLeft,
      });
    } catch (err) {
      warnings.push(`证书 ${name} 探测失败: ${errText(err)}`);
    }
  }
  certs.sort((x, y) => x.daysLeft - y.daysLeft);

  return {
    ok: true,
    data: { anniversaries, certs },
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
