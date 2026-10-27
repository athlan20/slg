// 洛阳争夺（v79，AISLG-200）的 Worker 侧：窗口结束回满城防、窗口预告 / 开始 / 结束播报、洛阳易主播报。
// 窗口判断见 common/src/luoyang.ts；洛阳之主缓存由 luoyang-db.refreshLuoyangHolder 在易主时刷新。

import type pg from 'pg';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { insertServerBroadcast, type ServerBroadcastCreated } from '../../common/src/server-broadcast';
import {
  LUOYANG_NAME,
  LUOYANG_NOTICE_MS,
  currentLuoyangWindow,
  luoyangWindowOpen,
  nextLuoyangOpen,
} from '../../common/src/luoyang';
import { loadLuoyangCity } from '../../common/src/luoyang-db';

interface NoticeState {
  holderAllianceId: string | null;
  holderName: string | null;
  windowStart: string | null;
  soon: boolean;
  started: boolean;
  ended: boolean;
}

async function readState(client: pg.PoolClient): Promise<NoticeState> {
  const res = await client.query(`SELECT value FROM settings WHERE key = 'luoyang_notice'`);
  const value = (res.rows[0] as { value: Partial<NoticeState> } | undefined)?.value;
  return {
    holderAllianceId: value?.holderAllianceId ?? null,
    holderName: value?.holderName ?? null,
    windowStart: value?.windowStart ?? null,
    soon: value?.soon ?? false,
    started: value?.started ?? false,
    ended: value?.ended ?? false,
  };
}

async function writeState(client: pg.PoolClient, state: NoticeState): Promise<void> {
  await client.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('luoyang_notice', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(state)],
  );
}

async function broadcast(client: pg.PoolClient, phase: string, detail: Record<string, unknown>): Promise<ServerBroadcastCreated | null> {
  return insertServerBroadcast(client, 'luoyang_window', { phase, ...detail }, { force: true });
}

/** 每个 tick 调一次：窗口状态与结束回满 + 全服播报（同一条事务） */
export async function processLuoyang(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  const broadcasts: ServerBroadcastCreated[] = [];
  try {
    await client.query('BEGIN');
    const city = await loadLuoyangCity(client);
    if (!city) {
      await client.query('COMMIT');
      return;
    }
    const now = new Date();
    const window = currentLuoyangWindow(now);
    const state = await readState(client);
    const next = nextLuoyangOpen(now);
    const windowStart = (window?.startAt ?? next).toISOString();

    // 窗口外：城防回满并清掉被动免战（窗口内被攻破后也没有被动免战）
    if (!luoyangWindowOpen(now) && (Number(city.durability ?? 100) < 100 || city.durability === null)) {
      await client.query(
        `UPDATE cities SET durability = 100, durability_settled_at = now(), truce_until = NULL
         WHERE id = $1 AND famous_name = $2`,
        [city.id, LUOYANG_NAME],
      );
    }

    // 洛阳易主播报
    if (state.holderAllianceId !== city.alliance_id) {
      const changes = { ...state, holderAllianceId: city.alliance_id, holderName: city.alliance_name };
      const created = await broadcast(client, 'holder', {
        allianceId: city.alliance_id,
        allianceName: city.alliance_name,
        username: city.username,
      });
      if (created) broadcasts.push(created);
      Object.assign(state, changes);
    }

    // 窗口前 30 分钟预告 / 开始 / 结束
    if (window && state.windowStart !== windowStart) {
      Object.assign(state, { windowStart, soon: false, started: false, ended: false });
    }
    if (!window && now.getTime() >= next.getTime() - LUOYANG_NOTICE_MS && now.getTime() < next.getTime() && !state.soon) {
      const created = await broadcast(client, 'soon', { startAt: next.toISOString(), endAt: new Date(next.getTime() + 2 * 3_600_000).toISOString() });
      if (created) broadcasts.push(created);
      state.soon = true;
      state.windowStart = next.toISOString();
      state.started = false;
      state.ended = false;
    }
    if (window && !state.started) {
      const created = await broadcast(client, 'started', {
        startAt: window.startAt.toISOString(), endAt: window.endAt.toISOString(),
      });
      if (created) broadcasts.push(created);
      state.started = true;
      state.windowStart = window.startAt.toISOString();
    }
    if (!window && state.windowStart && !state.ended) {
      const end = new Date(Date.parse(state.windowStart) + 2 * 3_600_000);
      if (now.getTime() >= end.getTime()) {
        const created = await broadcast(client, 'ended', { startAt: state.windowStart, endAt: end.toISOString() });
        if (created) broadcasts.push(created);
        state.ended = true;
      }
    }
    await writeState(client, state);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  for (const created of broadcasts) {
    await pool.query('SELECT pg_notify($1, $2)', [
      NOTIFY_CHANNEL,
      JSON.stringify({ reason: 'server_broadcast', accountId: '', broadcast: created }),
    ]);
  }
}
