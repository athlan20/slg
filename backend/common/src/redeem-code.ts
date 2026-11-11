// 兑换码的格式、规范化与奖励校验（AISLG-253，v109）：纯函数，不碰数据库、不 import pg。
// 运营侧的生成 / 导出在 scripts/redeem-codes.ts，存取在 redeem-db.ts，协议处理在 api/src/handlers-redeem.ts。
//
// 码：16 位，字符集是去掉易混淆字符（I、L、O、U）的 32 个字符，随机生成、不含任何规律，
// 显示成 XXXX-XXXX-XXXX-XXXX。库里存规范化后的 16 位大写字符（不带横线），输入时去空格 / 横线、转大写。
// 奖励：元宝 1..100000（与充值同账户、永久保留）与 / 或道具 itemId × count（1..99，必须是 ITEM_DEFS 里在售的道具），
// 至少一项。一个批次一份奖励包，码只是这份奖励包的领取凭证。

import { randomBytes } from 'node:crypto';
import { isItemId, itemDef, type ItemId } from './items';

/**
 * 码的字符集（32 个）：0-9 与 A-Z 去掉 I、L、O、U（易与 1、0、V 等混淆）。
 * 32 = 2^5 正好是 5 比特，按字节取低 5 位即可无取模偏差地生成。
 */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 码的字符数（库中存储长度；显示时插 3 条横线） */
export const CODE_LENGTH = 16;
/** 显示用的分组长度：XXXX-XXXX-XXXX-XXXX */
export const CODE_GROUP = 4;

const CODE_ALPHABET_SET: ReadonlySet<string> = new Set(CODE_ALPHABET.split(''));

/** 字符是否属于码的字符集（测试与诊断用；兑换流程不靠它，码对不上就是无效码） */
export function isCodeChar(char: string): boolean {
  return CODE_ALPHABET_SET.has(char);
}

/** 元宝奖励的范围（整数） */
export const REDEEM_INGOT_MIN = 1;
export const REDEEM_INGOT_MAX = 100_000;
/** 单个道具奖励的数量范围（整数，与背包堆叠上限一致） */
export const REDEEM_ITEM_COUNT_MIN = 1;
export const REDEEM_ITEM_COUNT_MAX = 99;
/** 单批次一次性码的最大数量 */
export const REDEEM_BATCH_MAX_CODES = 10_000;
/** 批次名的长度上限（运营看的名字） */
export const REDEEM_BATCH_NAME_MAX = 60;
/** 通用码必须设的最多兑换人数上限（只做参数上限保护，实际值由运营填） */
export const REDEEM_MAX_REDEMPTIONS_LIMIT = 1_000_000;
/** 防暴力猜码：每账号每小时最多失败次数，超过后 1 小时内所有兑换请求返回 CODE_RATE_LIMITED */
export const REDEEM_FAIL_LIMIT = 10;
/** 失败次数的统计窗口（秒级边界：恰好 1 小时前的那次不再计入） */
export const REDEEM_FAIL_WINDOW_MS = 60 * 60 * 1000;
/** redeem_attempts 的保留期（由 Worker 定期清理） */
export const REDEEM_ATTEMPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** 码的类型：single 一次性码（一码一人）/ shared 通用码（多人可兑，每人一次） */
export const REDEEM_BATCH_KINDS = ['single', 'shared'] as const;
export type RedeemBatchKind = (typeof REDEEM_BATCH_KINDS)[number];

export function isRedeemBatchKind(value: unknown): value is RedeemBatchKind {
  return value === 'single' || value === 'shared';
}

/** 奖励包里的道具项 */
export interface RedeemItemReward {
  itemId: ItemId;
  count: number;
}

/** 奖励包：元宝与 / 或道具，至少一项（存 redeem_batches.rewards 的 jsonb） */
export interface RedeemRewards {
  ingot?: number;
  items?: RedeemItemReward[];
}

export type RedeemRewardsValidation =
  | { ok: true; rewards: RedeemRewards }
  | { ok: false; error: string };

/**
 * 规范化玩家输入的码：去掉全部空白与横线、转大写，结果必须正好 16 位，否则返回 null（调用方返回 CODE_INVALID）。
 * 全角的横线 / 空格也算分隔符，玩家从微信里复制常带这些。不在这里校验字符集——码的字符集里没有
 * I / L / O / U，含这些字符的输入不可能对上任何码，查码时自然返回 CODE_INVALID。
 */
export function normalizeRedeemCode(input: string): string | null {
  const normalized = input.replace(/[\s\u3000\-\u2010-\u2015\uFF0D]/g, '').toUpperCase();
  return normalized.length === CODE_LENGTH ? normalized : null;
}

/** 规范化后的码转显示格式：XXXX-XXXX-XXXX-XXXX */
export function formatRedeemCode(code: string): string {
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += CODE_GROUP) {
    groups.push(code.slice(i, i + CODE_GROUP));
  }
  return groups.join('-');
}

/** 码的后 4 位（日志与事件里只记这一段，不记全码） */
export function codeTail(code: string): string {
  return code.slice(-Math.min(CODE_GROUP, code.length));
}

/** 随机生成一个规范化码（16 位大写）：按字节取低 5 位，32 个字符等概率，无取模偏差 */
export function generateRedeemCode(): string {
  let code = '';
  while (code.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH)) {
      code += CODE_ALPHABET[byte & 31];
      if (code.length === CODE_LENGTH) {
        break;
      }
    }
  }
  return code;
}

/** 道具奖励里 itemId 是否合法：必须在 ITEM_DEFS 里且在售（礼金或元宝有价） */
export function isRedeemItemId(value: unknown): value is ItemId {
  if (!isItemId(value)) {
    return false;
  }
  const def = itemDef(value);
  return def !== null && (def.shopPrice !== null || def.ingotPrice !== null);
}

function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * 校验并规整一份奖励包（运营脚本创建批次、兑换时读回库存都走这里）：
 * - ingot 可缺省，给了就必须是 1..100000 的整数；
 * - items 可缺省，给了就必须是数组，每项 itemId 是在售道具、count 是 1..99 的整数，同一道具不能出现两次；
 * - 至少一项有实际奖励（元宝 > 0 或至少一个道具），否则报错。
 * 返回的 rewards 只保留实际给出的键（缺省的不写成 undefined），便于原样存 jsonb。
 */
export function validateRedeemRewards(value: unknown): RedeemRewardsValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: '奖励必须是对象' };
  }
  const raw = value as { ingot?: unknown; items?: unknown };
  const rewards: RedeemRewards = {};
  if (raw.ingot !== undefined && raw.ingot !== null) {
    if (!isIntInRange(raw.ingot, REDEEM_INGOT_MIN, REDEEM_INGOT_MAX)) {
      return { ok: false, error: `元宝必须是 ${REDEEM_INGOT_MIN}..${REDEEM_INGOT_MAX} 的整数` };
    }
    rewards.ingot = raw.ingot;
  }
  if (raw.items !== undefined && raw.items !== null) {
    if (!Array.isArray(raw.items) || raw.items.length === 0) {
      return { ok: false, error: '道具奖励必须是非空数组' };
    }
    const seen = new Set<string>();
    const items: RedeemItemReward[] = [];
    for (const entry of raw.items) {
      if (typeof entry !== 'object' || entry === null) {
        return { ok: false, error: '道具奖励每项必须是 { itemId, count }' };
      }
      const { itemId, count } = entry as { itemId?: unknown; count?: unknown };
      if (!isRedeemItemId(itemId)) {
        return { ok: false, error: `道具 ${String(itemId)} 不存在或不在售` };
      }
      if (seen.has(itemId)) {
        return { ok: false, error: `道具 ${itemId} 在本批奖励里出现了两次` };
      }
      if (!isIntInRange(count, REDEEM_ITEM_COUNT_MIN, REDEEM_ITEM_COUNT_MAX)) {
        return { ok: false, error: `道具数量必须是 ${REDEEM_ITEM_COUNT_MIN}..${REDEEM_ITEM_COUNT_MAX} 的整数` };
      }
      seen.add(itemId);
      items.push({ itemId, count });
    }
    rewards.items = items;
  }
  if (rewards.ingot === undefined && rewards.items === undefined) {
    return { ok: false, error: '奖励至少要有元宝或道具中的一项' };
  }
  return { ok: true, rewards };
}

/** 解析运营脚本的 `--item city_order:2`（一次一项） */
export function parseRedeemItemSpec(spec: string): { ok: true; item: RedeemItemReward } | { ok: false; error: string } {
  const separator = spec.lastIndexOf(':');
  if (separator <= 0) {
    return { ok: false, error: `--item 需要 itemId:count 的形式，收到 ${spec}` };
  }
  const itemId = spec.slice(0, separator).trim();
  const countText = spec.slice(separator + 1).trim();
  if (!isRedeemItemId(itemId)) {
    return { ok: false, error: `道具 ${itemId} 不存在或不在售` };
  }
  if (!/^\d+$/.test(countText)) {
    return { ok: false, error: `道具数量必须是整数，收到 ${countText}` };
  }
  const count = Number(countText);
  if (!isIntInRange(count, REDEEM_ITEM_COUNT_MIN, REDEEM_ITEM_COUNT_MAX)) {
    return { ok: false, error: `道具数量必须是 ${REDEEM_ITEM_COUNT_MIN}..${REDEEM_ITEM_COUNT_MAX} 的整数，收到 ${count}` };
  }
  return { ok: true, item: { itemId, count } };
}

/** 奖励包的中文摘要（运营脚本与日志用）：元宝 ×500、迁城令 ×2 */
export function formatRedeemRewards(rewards: RedeemRewards): string {
  const parts: string[] = [];
  if (rewards.ingot !== undefined) {
    parts.push(`元宝 ×${rewards.ingot}`);
  }
  for (const item of rewards.items ?? []) {
    parts.push(`${itemDef(item.itemId)?.name ?? item.itemId} ×${item.count}`);
  }
  return parts.join('、');
}
/**
 * 运营脚本 `--expires` 的解析：`2026-12-31` = 当天 UTC 结束（23:59:59.999Z），其他形式按 ISO 时间；
 * 不是合法时间抛错（脚本直接报错退出）。不给 --expires 时调用方不调用本函数（不过期）。
 */
export function parseRedeemExpiresAt(raw: string): Date {
  const text = raw.trim();
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const date = day
    ? new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), 23, 59, 59, 999))
    : new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`--expires 不是合法时间（用 2026-12-31 或 ISO 时间），收到 ${text}`);
  }
  return date;
}
