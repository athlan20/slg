// 离线日报（v23，AISLG-54）：玩家上线先看「你不在时发生了什么」。
// - 数字汇总：服务端按 accounts.last_online_at（玩家连接全部断开的时刻）从事件流
//   统计收获 / 损失（纯数字、不做判断）；从未离线过返回 seconds=0，前端不弹窗；
// - Agent 日报：玩家自己的 Agent 平时经 AGENT_DAILY_REPORT 写好存着（最新一份、
//   重写覆盖），玩家上线直接读到，不现写；没写过时数字汇总照常给出。
// 两个协议都只读/写展示数据，不参与游戏逻辑；游戏规则仍由服务端统一校验。

import pg from 'pg';
import {
  RESOURCE_KEYS,
  Op,
  type AgentDailyReportView,
  type OfflineDigestView,
  type Resources,
} from '../../common/src/protocol';
import { loadCityState } from './views';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { respondError, respondOk } from './frames';

/** 日报正文长度上限（占位值，随需求「已定」标注可调） */
const DAILY_REPORT_MAX = 500;
/** 离线事件扫描上限（离线很久 + 高倍速时事件可能很多；超出按最近 2000 条统计） */
const DIGEST_EVENT_LIMIT = 2000;
/** 「仓库快满了」提示阈值（占储量上限百分比） */
const STORAGE_FULL_PERCENT = 80;

/** 玩家连接全部断开时记录离线时刻（handleConnectionClosed 调用；Agent 连接不算） */
export async function markPlayerOffline(pool: pg.Pool, accountId: string): Promise<void> {
  await pool.query(`UPDATE accounts SET last_online_at = now() WHERE id = $1`, [accountId]);
}

/** 读取 Agent 最近一份日报；从未写过返回 null */
async function loadAgentDailyReport(pool: pg.Pool, accountId: string): Promise<AgentDailyReportView | null> {
  const res = await pool.query(
    `SELECT content, written_at FROM agent_daily_reports WHERE account_id = $1`,
    [accountId],
  );
  if (!res.rowCount) {
    return null;
  }
  const row = res.rows[0] as { content: string; written_at: Date };
  return { text: row.content, writtenAt: row.written_at.toISOString() };
}

/** AGENT_DAILY_REPORT（op 40，仅 Agent 连接）：写 / 覆盖离线日报 */
export async function handleAgentDailyReport(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  if (conn.role !== 'agent') {
    respondError(ctx.registry, conn, op, seq, 'AGENT_FORBIDDEN');
    return;
  }
  const raw = data?.text;
  if (typeof raw !== 'string') {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const text = raw.trim();
  if (text.length < 1 || text.length > DAILY_REPORT_MAX) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const accountId = conn.accountId as string;
  const res = await ctx.pool.query(
    `INSERT INTO agent_daily_reports (account_id, content, written_at)
     VALUES ($1, $2, now())
     ON CONFLICT (account_id)
     DO UPDATE SET content = $2, written_at = now()
     RETURNING written_at`,
    [accountId, text],
  );
  const writtenAt = (res.rows[0] as { written_at: Date }).written_at.toISOString();
  respondOk(ctx.registry, conn, op, seq, { report: { text, writtenAt } });
}

/** 事件 detail 里的战利品 / 损失累加工具 */
function addResources(target: Resources, source: unknown): void {
  if (source === null || typeof source !== 'object') {
    return;
  }
  const record = source as Record<string, unknown>;
  for (const key of RESOURCE_KEYS) {
    const value = record[key];
    if (typeof value === 'number' && value > 0) {
      target[key] += Math.floor(value);
    }
  }
}

/** detail.losses（按兵种）的总减员数 */
function lossesTotal(source: unknown): number {
  if (source === null || typeof source !== 'object') {
    return 0;
  }
  let total = 0;
  for (const value of Object.values(source as Record<string, unknown>)) {
    if (typeof value === 'number' && value > 0) {
      total += Math.floor(value);
    }
  }
  return total;
}

/** 组装离线数字汇总（事件流统计 + 仓库现状；离线起点为 last_online_at） */
async function buildOfflineDigest(
  ctx: HandlerContext,
  accountId: string,
): Promise<OfflineDigestView> {
  const digest: OfflineDigestView = {
    seconds: 0,
    gains: { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 },
    battles: 0,
    troopsLost: 0,
    npcRaids: 0,
    wildernessLost: 0,
    mutinyLost: 0,
    storageFull: null,
  };
  const lastRes = await ctx.pool.query(`SELECT last_online_at FROM accounts WHERE id = $1`, [accountId]);
  const lastOnline = lastRes.rows[0]?.last_online_at as Date | null | undefined;
  if (!lastOnline) {
    return digest;
  }
  digest.seconds = Math.max(0, Math.floor((Date.now() - lastOnline.getTime()) / 1000));

  const eventsRes = await ctx.pool.query(
    `SELECT type, detail FROM events
     WHERE account_id = $1 AND created_at >= $2
     ORDER BY id ASC
     LIMIT $3`,
    [accountId, lastOnline, DIGEST_EVENT_LIMIT],
  );
  for (const row of eventsRes.rows as Array<{ type: string; detail: Record<string, unknown> }>) {
    const detail = row.detail ?? {};
    if (row.type === 'march_completed') {
      const outcome = detail.outcome;
      if (outcome === 'battle_won' || outcome === 'plunder_won') {
        digest.battles += 1;
        addResources(digest.gains, detail.loot);
      } else if (outcome === 'battle_lost') {
        digest.battles += 1;
      }
      if (outcome === 'battle_lost') {
        digest.troopsLost += lossesTotal(detail.losses);
      }
    } else if (row.type === 'npc_raid') {
      digest.npcRaids += 1;
      digest.battles += 1;
      digest.troopsLost += lossesTotal(detail.losses);
    } else if (row.type === 'mutiny') {
      // 断粮哗变（v34 AISLG-107）：单独统计，不并入战斗减员
      digest.mutinyLost += typeof detail.total === 'number' ? Math.floor(detail.total) : lossesTotal(detail.losses);
    } else if (row.type === 'wilderness_lost' && detail.cause === 'npc_attack') {
      digest.wildernessLost += 1;
    }
  }

  // 仓库现状：最接近满仓的四资源（金上限固定 100 万，不参与「快满了」提示）
  const city = await loadCityState(ctx.pool, accountId);
  if (city) {
    let bestPercent = 0;
    let bestResource: string | null = null;
    for (const key of ['food', 'wood', 'stone', 'iron'] as const) {
      const cap = city.storage[key];
      if (cap <= 0) {
        continue;
      }
      const percent = (city.resources[key] / cap) * 100;
      if (percent >= STORAGE_FULL_PERCENT && percent > bestPercent) {
        bestPercent = percent;
        bestResource = key;
      }
    }
    if (bestResource) {
      digest.storageFull = { resource: bestResource, percent: Math.round(bestPercent) };
    }
  }
  return digest;
}

/** GET_OFFLINE_REPORT（op 41）：离线时长、收获 / 损失汇总与 Agent 最近日报 */
export async function handleGetOfflineReport(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const [offline, agentReport] = await Promise.all([
    buildOfflineDigest(ctx, accountId),
    loadAgentDailyReport(ctx.pool, accountId),
  ]);
  respondOk(ctx.registry, conn, op, seq, { offline, agentReport });
}
