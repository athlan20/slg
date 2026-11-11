// 换季重置引擎（AISLG-134，docs/season-system.md §2.5）。由 season-tick.ts 在 end_at 到点时调用。
// 流程：① 进维护态（独立事务先提交，API 立即拦截游戏请求）→ ② 强制刷新榜单 → ③ 单事务：存档、清表、
// 重置账号赛季字段、按新种子重建世界与名城 / 野外名将 / 竞技场 NPC、旧赛季收尾、新赛季开局、清维护态 →
// ④ 提交后推送 season_started 与 maintenance_off。③ 任一步失败整体回滚（旧世界原样保留），finally 里清维护态。
import type pg from 'pg';
import { RESET_TABLES } from '../../common/src/season-tables';
import { insertSeason } from '../../common/src/season-insert';
import { SCHEMA_LOCK_ID } from '../../common/src/db';
import { getCurrentSeason, notifySeasonEvent, setMaintenance, type SeasonRow } from '../../common/src/season-db';
import { seasonLengthDays } from '../../common/src/season-seed';
import { generateWorldTiles, WORLD_SEED, WORLD_SIZE } from '../../common/src/world';
import { insertWorldTiles } from '../../common/src/world-db';
import { ensureFamousCities } from '../../common/src/famous-city-db';
import { ensureFactions } from '../../common/src/faction-db';
import { getFactionEnabled } from '../../common/src/faction-config';
import { alignFactionStartedAtForSeason } from '../../common/src/faction-start';
import { placeWildFamousIn } from '../../common/src/wild-famous-db';
import { ensureRelics } from '../../common/src/fog-relic-db';
import { ensureArenaNpcs, lockArena } from '../../common/src/arena-db';
import { refreshTimeScale } from '../../common/src/time-scale';
import { refreshLeaderboards } from './leaderboard-tick';
import { archiveSeason } from './season-archive';
import { drainWorkerJobs, setSeasonResetting } from './season-busy';

/** 换季事务级咨询锁（docs/season-system.md §2.5 第 1 步） */
export const SEASON_RESET_LOCK_ID = 8721420;

/** 换季中的阶段（测试故障注入用；生产不传 beforeStep） */
export type ResetStep = 'maintenance' | 'leaderboard' | 'archive' | 'clear' | 'world' | 'season' | 'commit';

export interface SeasonResetOptions {
  /** 测试注入：进入某阶段前调用，抛错即模拟该阶段故障 */
  beforeStep?: (step: ResetStep) => void | Promise<void>;
  /** 测试注入：当前时刻（缺省 new Date()） */
  now?: () => Date;
}

export type SeasonResetOutcome =
  | { status: 'reset'; oldSeasonId: number; newSeason: SeasonRow }
  | { status: 'skipped'; reason: string };

/** PUSH_SEASON 的推送载荷（与 protocol-season.ts 的 SeasonPushData 同形） */
function pushData(season: SeasonRow, now: Date): Record<string, unknown> {
  return {
    seasonId: season.id,
    endsAt: season.endAt.toISOString(),
    remainingSec: Math.max(0, Math.floor((season.endAt.getTime() - now.getTime()) / 1000)),
  };
}

/** 新赛季的世界种子：随机，且与上一季不同 */
export function nextWorldSeed(previous: number): number {
  let seed: number;
  do {
    seed = Math.floor(Math.random() * 2147483646) + 1;
  } while (seed === previous || seed === WORLD_SEED);
  return seed;
}

/** 在一个事务里执行回调；失败回滚并原样抛出 */
async function inTransaction<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 执行一次换季。返回 skipped 表示没抢到咨询锁或已不再到点（不是错误）；真实故障抛出 */
export async function runSeasonReset(pool: pg.Pool, options: SeasonResetOptions = {}): Promise<SeasonResetOutcome> {
  const now = options.now ?? (() => new Date());
  const enter = async (step: ResetStep): Promise<void> => {
    await options.beforeStep?.(step);
  };
  setSeasonResetting(true);
  let maintenanceOn = false;
  try {
    await drainWorkerJobs();

    // ① 进维护态：抢锁、复核仍然到点，然后置维护态并推送，提交后 API 立即拦截
    await enter('maintenance');
    const entered = await inTransaction(pool, async (client): Promise<{ kind: 'lock' | 'not-due' } | { kind: 'entered'; old: SeasonRow }> => {
      const lock = await client.query(`SELECT pg_try_advisory_xact_lock($1) AS ok`, [SEASON_RESET_LOCK_ID]);
      if (!lock.rows[0].ok) {
        return { kind: 'lock' };
      }
      const current = await getCurrentSeason(client);
      if (!current || current.endAt.getTime() > now().getTime()) {
        return { kind: 'not-due' };
      }
      const startedAt = now();
      await setMaintenance(client, { reason: 'season_reset', since: startedAt.toISOString() });
      await notifySeasonEvent(client, { reason: 'maintenance_on' });
      await notifySeasonEvent(client, { reason: 'season_resetting', data: pushData(current, startedAt) });
      return { kind: 'entered', old: current };
    });
    if (entered.kind !== 'entered') {
      return { status: 'skipped', reason: entered.kind === 'lock' ? '咨询锁被占用' : '赛季尚未到点' };
    }
    maintenanceOn = true;
    const old = entered.old;

    // ② 强制刷新榜单（存档取的是换季前的最新名次）
    await enter('leaderboard');
    await refreshLeaderboards(pool);

    // ③ 存档、清表、重建、切季、清维护态：同一事务
    const newSeason = await inTransaction(pool, async (client) => {
      const lock = await client.query(`SELECT pg_try_advisory_xact_lock($1) AS ok`, [SEASON_RESET_LOCK_ID]);
      if (!lock.rows[0].ok) {
        throw new Error('换季：咨询锁在事务内被占用，放弃本次');
      }
      // 与 ensureSchema 互斥（API 重启时会跑 DDL）：先等它做完再动表，避免拿着表锁与 ALTER TABLE 互等
      await client.query(`SELECT pg_advisory_xact_lock($1)`, [SCHEMA_LOCK_ID]);
      await enter('archive');
      await archiveSeason(client, old.id, old.name);
      await enter('clear');
      await client.query(`TRUNCATE ${RESET_TABLES.join(', ')}`);
      // v108（AISLG-251）：道具背包不再整表清空——元宝买的道具换季保留，count 收敛到 paid_count
      // （= 其中元宝买的张数），freeCount 为 0 的行（礼金买的 / 发放的）随之删除。
      // user_items 已从 RESET_TABLES 移到 KEEP_TABLES，这里必须先于 accounts 的重置执行（ingot 不动）。
      await client.query(`UPDATE user_items SET count = paid_count, updated_at = now() WHERE count <> paid_count`);
      await client.query(`DELETE FROM user_items WHERE count = 0`);
      await client.query(
        `UPDATE alliances SET luoyang_holder = false, decree_kind = NULL, decree_until = NULL, decree_next_at = NULL`,
      );
      // 注意（v108，AISLG-251）：这里**不动 accounts.ingot**——元宝是付费货币，永久保留、换季不清零
      await client.query(
        `UPDATE accounts
         SET season_id = NULL, plunder_total = 0, prestige = 0, nobility = 0, newbie_until = NULL,
             self_truce_until = NULL, self_truce_used_at = NULL, last_online_at = NULL, gift = 0`,
      );
      await enter('world');
      const seed = nextWorldSeed(old.seed);
      await insertWorldTiles(client, generateWorldTiles(seed));
      // 整表重灌后立即收集统计信息：否则新图刚上线的前几分钟查询计划按空表估算（同事务内 ANALYZE 合法）
      await client.query(`ANALYZE world_tiles`);
      await ensureFamousCities(client);
      // 五方势力（v99，AISLG-239）：开关打开时按新世界重新放老巢并吞下开季 25 格（factions 已随 RESET_TABLES 清空）
      await ensureFactions(client);
      await placeWildFamousIn(client);
      // 战争迷雾遗迹（v93，AISLG-227）：按新世界重新生成（表已随 RESET_TABLES 清空），同一事务内
      await ensureRelics(client, seed, WORLD_SIZE);
      await lockArena(client);
      await ensureArenaNpcs(client);
      await enter('season');
      const startAt = now();
      const endAt = new Date(startAt.getTime() + seasonLengthDays() * 24 * 3600 * 1000);
      await client.query(`UPDATE seasons SET status = 'ended', ended_at = $2 WHERE id = $1`, [old.id, startAt]);
      const timeScale = await takeNextTimeScale(client, old.timeScale);
      const { id: seasonId, name: seasonName } = await insertSeason(client, { startAt, endAt, seed, timeScale });
      await client.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ('time_scale', $1::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify({ scale: timeScale })],
      );
      // 五方势力的启用时间（AISLG-243，v102）：势力的天数从 max(本季开始时间, 启用时间) 算。换季开了势力就把
      // 启用时间对齐到新赛季开始时间（与开季放老巢同一时刻，天数从第 1 天算）；没开则删掉记录，
      // 否则下个赛季中途打开开关会被误判成「已经启用过」而不放老巢。
      await alignFactionStartedAtForSeason(client, startAt, getFactionEnabled());
      await setMaintenance(client, null);
      await enter('commit');
      return {
        id: seasonId,
        name: seasonName,
        status: 'active' as const,
        startAt,
        endAt,
        seed,
        timeScale,
        endedAt: null,
      };
    });
    maintenanceOn = false;

    // ④ 提交之后：推送（失败只记日志，换季本身已经成功，不能再回滚）
    try {
      await notifySeasonEvent(pool, { reason: 'season_started', data: pushData(newSeason, now()) });
      await notifySeasonEvent(pool, { reason: 'maintenance_off' });
    } catch (err) {
      console.error('season reset: post-commit notify failed:', err instanceof Error ? err.message : err);
    }
    await refreshTimeScale(pool).catch(() => undefined);
    // 新赛季的榜单立即可见（否则要等 Worker 下一轮 10 分钟刷新）
    await refreshLeaderboards(pool).catch((err) => {
      console.error('season reset: post-commit leaderboard refresh failed:', err instanceof Error ? err.message : err);
    });
    return { status: 'reset', oldSeasonId: old.id, newSeason };
  } finally {
    if (maintenanceOn) {
      // 失败路径：事务已回滚，旧世界原样保留；维护态必须清掉，否则游戏永久停服
      try {
        await setMaintenance(pool, null);
        await notifySeasonEvent(pool, { reason: 'maintenance_off' });
      } catch (err) {
        console.error('season reset: clearing maintenance failed:', err instanceof Error ? err.message : err);
      }
    }
    setSeasonResetting(false);
  }
}

/**
 * 新赛季的倍速：运维预设的 settings.next_time_scale 优先（用后删除）；否则沿用当前生效的 settings.time_scale，
 * 再缺省沿用上一季记录的倍速。
 */
async function takeNextTimeScale(client: pg.PoolClient, previous: number): Promise<number> {
  const next = await client.query(`SELECT value FROM settings WHERE key = 'next_time_scale'`);
  if (next.rowCount) {
    await client.query(`DELETE FROM settings WHERE key = 'next_time_scale'`);
    const scale = Number((next.rows[0].value as { scale?: unknown } | null)?.scale);
    if (Number.isFinite(scale) && scale >= 1) {
      return scale;
    }
  }
  const cur = await client.query(`SELECT value FROM settings WHERE key = 'time_scale'`);
  const current = Number(cur.rowCount ? (cur.rows[0].value as { scale?: unknown } | null)?.scale : undefined);
  if (Number.isFinite(current) && current >= 1) {
    return current;
  }
  return previous;
}
