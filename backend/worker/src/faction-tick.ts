// 五方势力的吞城定时器（AISLG-239，v99）：每家每 6 小时（随全局时间缩放）在当前势力范围里
// 随机吞一座无主 NPC 城；半径扩大时写一条全服播报（每周最多一次）。
// v102（AISLG-243）：每轮先看一眼开关——开关刚打开而本季还没启用过时，先把老巢放下来（worker/src/faction-start.ts）。
// 参照 npc-raid-timer 的链式 setTimeout + season-busy：换季进行中不吞城（世界即将清空），顺延再试。
// 开季的「老巢周围 25 格全部归该势力」不在这里，在世界生成 / 换季 / 当季启用的事务里（common/src/faction-db.ts）。

import pg from 'pg';
import { getFactionEnabled } from '../../common/src/faction-config';
import { factionDayAt, factionDefOf, factionRadiusAt, factionSwallowIntervalMs } from '../../common/src/faction';
import { loadFactionRows, swallowRandom } from '../../common/src/faction-db';
import { loadFactionEpochStart } from '../../common/src/faction-start';
import { destroyedFactionKeys } from '../../common/src/faction-lair-db';
import { getCurrentSeason } from '../../common/src/season-db';
import { insertServerBroadcast } from '../../common/src/server-broadcast';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { isSeasonResetting, trackWorkerJob } from './season-busy';
import { runFactionStart } from './faction-start';

export interface FactionTickResult {
  /** 本次吞下的城数（每家每轮到点吞一座） */
  swallowed: number;
  /** 本次是否写了半径扩大的全服播报 */
  broadcast: boolean;
}

/** 一次吞城 + 半径播报（导出便于测试直接调用；now 可注入） */
export async function runFactionTick(pool: pg.Pool, now: Date = new Date()): Promise<FactionTickResult> {
  const result: FactionTickResult = { swallowed: 0, broadcast: false };
  // 开关关闭时与上线前完全一致：不吞城、不播报、也不读势力表以外的任何数据
  if (!getFactionEnabled()) {
    return result;
  }
  const season = await getCurrentSeason(pool);
  if (!season) {
    return result;
  }
  const rows = await loadFactionRows(pool);
  if (rows.length === 0) {
    return result;
  }
  // v101（AISLG-241）：本季已灭亡的势力不再吞城
  const destroyed = await destroyedFactionKeys(pool);
  // v102（AISLG-243）：半径按「势力起点」与真实天数算（起点 = max(本季开始时间, 势力启用时间)，不随 time_scale 变化）；
  // 吞城间隔随缩放
  const epochStart = await loadFactionEpochStart(pool, season.startAt);
  const radius = factionRadiusAt(epochStart, now);
  const intervalMs = factionSwallowIntervalMs();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      if (destroyed.has(row.key)) {
        continue;
      }
      if (now.getTime() < row.last_swallow_at.getTime() + intervalMs) {
        continue;
      }
      const def = factionDefOf(row.key);
      // 到点就记一次（范围内没有可吞的城也记，避免每个 tick 都重试）
      if (def) {
        const picked = await swallowRandom(client, def, radius);
        if (picked) {
          result.swallowed += 1;
        }
      }
      // 用数据库的 now() 记账：与数据库里存的时刻同源，进程与数据库时钟有偏差也不会倒流
      await client.query(`UPDATE factions SET last_swallow_at = now() WHERE key = $1`, [row.key]);
    }
    // 半径扩大：五家同时扩（同一季同一半径），只播一条；每周最多一次（半径只在第 8 / 15 / 22 天变）。
    // v101（AISLG-241）：本季已灭亡的势力不再画范围，只有还在的势力扩张时才播报（不播「五方」，见文案）
    if (rows.some((row) => row.last_radius < radius && !destroyed.has(row.key))) {
      const created = await insertServerBroadcast(
        client,
        'faction_expanded',
        { radius, day: factionDayAt(epochStart, now) },
        { force: true },
      );
      await client.query(`UPDATE factions SET last_radius = $1 WHERE last_radius < $1`, [radius]);
      if (created) {
        // 提交后由 API 经 PUSH_SERVER_BROADCAST 推给全部在线连接
        await client.query('SELECT pg_notify($1, $2)', [
          NOTIFY_CHANNEL,
          JSON.stringify({ reason: 'server_broadcast', accountId: '', broadcast: created }),
        ]);
        result.broadcast = true;
      }
    }
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 两次检查之间的最长间隔（真实时间毫秒）：半径为真实天数推进，吞城间隔也不短，没必要盯太紧 */
const MAX_CHECK_MS = 60_000;
const MIN_CHECK_MS = 5_000;

/** 下一次该检查的时刻隔多久（毫秒）：按吞城间隔的四分之一估，钳到 5 秒 ~ 60 秒 */
function checkDelayMs(): number {
  return Math.min(MAX_CHECK_MS, Math.max(MIN_CHECK_MS, Math.floor(factionSwallowIntervalMs() / 4)));
}

/** 启动吞城定时器；返回停止函数（进程退出时调用） */
export function startFactionTimer(pool: pg.Pool): () => void {
  let timer: NodeJS.Timeout | null = null;
  const schedule = (): void => {
    timer = setTimeout(() => {
      // 换季进行中不吞城（世界即将清空），顺延再看
      if (isSeasonResetting()) {
        schedule();
        return;
      }
      // v102（AISLG-243）：开关刚打开、本季还没启用过时先放一次老巢（只执行一次），不等换季
      void trackWorkerJob(
        runFactionStart(pool)
          .then(() => runFactionTick(pool))
          .then((tick) => {
            if (tick.swallowed > 0) {
              console.log(`faction swallowed ${tick.swallowed} NPC city(ies)`);
            }
          })
          .catch((err) => {
            console.error('worker faction tick failed:', err instanceof Error ? err.message : err);
          })
          .finally(schedule),
      );
    }, checkDelayMs());
  };
  schedule();
  return () => {
    if (timer !== null) {
      clearTimeout(timer);
    }
  };
}
