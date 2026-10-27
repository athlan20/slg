// 洛阳争夺（v79，AISLG-200）的读写：洛阳之主缓存刷新、状态查询、政令读取与发布。
// 洛阳之主 = 占领洛阳玩家所在的联盟；没有联盟则仅享受名城本身效果。

import type pg from 'pg';
import type { LuoyangStatusView } from './protocol-luoyang';
import {
  LUOYANG_ASSIST_CAP,
  LUOYANG_BONUS_PERCENT,
  LUOYANG_NAME,
  currentLuoyangWindow,
  decreeDurationMs,
  isDecreeKind,
  luoyangWindowOpen,
  nextLuoyangOpen,
  type DecreeKind,
} from './luoyang';
import { DURABILITY_MAX } from './protection';

type Queryable = pg.Pool | pg.PoolClient;

export interface LuoyangCityRow {
  id: string;
  account_id: string;
  username: string;
  alliance_id: string | null;
  alliance_name: string | null;
  durability: number | null;
}

/** 查洛阳城（只认玩家分城；NPC 阶段为 null） */
export async function loadLuoyangCity(q: Queryable): Promise<LuoyangCityRow | null> {
  const res = await q.query(
    `SELECT c.id, c.account_id, a.username, am.alliance_id, al.name AS alliance_name, c.durability
     FROM cities c JOIN accounts a ON a.id = c.account_id
     LEFT JOIN alliance_members am ON am.account_id = c.account_id
     LEFT JOIN alliances al ON al.id = am.alliance_id
     WHERE c.famous_name = $1
     ORDER BY c.created_at LIMIT 1`,
    [LUOYANG_NAME],
  );
  return (res.rows[0] as LuoyangCityRow | undefined) ?? null;
}

/**
 * 刷新「洛阳之主」缓存：把洛阳占领者所在联盟标为 holder，其余联盟清掉 holder 与政令。
 * 在洛阳易主 / 放弃 / 换盟 / 换季时调用（调用方事务内）。
 */
export async function refreshLuoyangHolder(client: Queryable): Promise<string | null> {
  const city = await loadLuoyangCity(client);
  const nextHolder = city?.alliance_id ?? null;
  const previous = await client.query(`SELECT id FROM alliances WHERE luoyang_holder = true LIMIT 1`);
  const previousId = (previous.rows[0] as { id: string } | undefined)?.id ?? null;
  if (previousId === nextHolder) {
    return nextHolder;
  }
  // 只有真正易主才清旧政令；成员加入 / 退出但洛阳主人不变时保留当前政令
  await client.query(
    `UPDATE alliances SET luoyang_holder = false, decree_kind = NULL, decree_until = NULL, decree_next_at = NULL
     WHERE luoyang_holder = true OR decree_kind IS NOT NULL`,
  );
  if (nextHolder) {
    await client.query(`UPDATE alliances SET luoyang_holder = true WHERE id = $1`, [nextHolder]);
  }
  return nextHolder;
}

/** 账号所在联盟是否洛阳之主 */
export async function isLuoyangHolderAlliance(q: Queryable, allianceId: string): Promise<boolean> {
  const res = await q.query(`SELECT 1 FROM alliances WHERE id = $1 AND luoyang_holder = true`, [allianceId]);
  return (res.rowCount ?? 0) > 0;
}

/** 账号当前生效的政令（不是洛阳之主联盟 / 没有政令 / 已过期返回 null） */
export async function loadActiveDecree(
  q: Queryable,
  accountId: string,
  now: Date = new Date(),
): Promise<{ kind: DecreeKind; until: Date } | null> {
  const res = await q.query(
    `SELECT al.decree_kind, al.decree_until
     FROM alliance_members am JOIN alliances al ON al.id = am.alliance_id
     WHERE am.account_id = $1 AND al.luoyang_holder = true
       AND al.decree_kind IS NOT NULL AND al.decree_until > $2`,
    [accountId, now],
  );
  if (!res.rowCount) {
    return null;
  }
  const row = res.rows[0] as { decree_kind: string; decree_until: Date };
  return isDecreeKind(row.decree_kind) ? { kind: row.decree_kind, until: row.decree_until } : null;
}

/** 洛阳状态（GET_LUOYANG / 发布政令响应共用） */
export async function loadLuoyangStatus(
  q: Queryable,
  accountId: string,
  now: Date = new Date(),
): Promise<LuoyangStatusView> {
  const city = await loadLuoyangCity(q);
  const window = currentLuoyangWindow(now);
  const next = nextLuoyangOpen(now);
  const windowStart = window?.startAt ?? next;
  const windowEnd = window?.endAt ?? new Date(next.getTime() + 2 * 3_600_000);
  let decree: LuoyangStatusView['decree'] = null;
  let canPublishDecree = false;
  let decreeNextAt: string | null = null;
  let myAllianceIsHolder = false;
  if (city?.alliance_id) {
    const alliance = await q.query(
      `SELECT luoyang_holder, decree_kind, decree_until, decree_next_at, leader_id, la.username AS leader_name
       FROM alliances al JOIN accounts la ON la.id = al.leader_id WHERE al.id = $1`,
      [city.alliance_id],
    );
    const row = alliance.rows[0] as
      | {
          luoyang_holder: boolean; decree_kind: string | null; decree_until: Date | null;
          decree_next_at: Date | null; leader_id: string; leader_name: string;
        }
      | undefined;
    if (row?.luoyang_holder) {
      const membership = await q.query(
        `SELECT role FROM alliance_members WHERE account_id = $1 AND alliance_id = $2`,
        [accountId, city.alliance_id],
      );
      const myRole = (membership.rows[0] as { role: string } | undefined)?.role ?? null;
      myAllianceIsHolder = myRole !== null;
      canPublishDecree = myRole === 'leader' && (!row.decree_next_at || row.decree_next_at.getTime() <= now.getTime());
      decreeNextAt = row.decree_next_at ? row.decree_next_at.toISOString() : null;
      if (row.decree_kind && isDecreeKind(row.decree_kind) && row.decree_until && row.decree_until.getTime() > now.getTime()) {
        decree = {
          kind: row.decree_kind,
          until: row.decree_until.toISOString(),
          nextAt: (row.decree_next_at ?? row.decree_until).toISOString(),
          canPublish: canPublishDecree,
          leaderName: row.leader_name,
        };
      }
    }
  }
  return {
    owner: city
      ? {
          cityId: city.id,
          cityName: LUOYANG_NAME,
          accountId: city.account_id,
          username: city.username,
          allianceId: city.alliance_id,
          allianceName: city.alliance_name,
          durability: Math.max(0, Math.min(DURABILITY_MAX, Number(city.durability ?? DURABILITY_MAX))),
        }
      : null,
    windowOpen: luoyangWindowOpen(now),
    windowStartAt: windowStart.toISOString(),
    windowEndAt: windowEnd.toISOString(),
    nextOpenAt: next.toISOString(),
    bonusPercent: city?.alliance_id && myAllianceIsHolder ? LUOYANG_BONUS_PERCENT : 0,
    assistCap: LUOYANG_ASSIST_CAP,
    decree,
    canPublishDecree,
    decreeNextAt,
    myAllianceIsHolder,
  };
}

/** 发布政令（调用方事务内）：校验洛阳之主盟主 + 7 天冷却；返回结果码 */
export async function publishDecree(
  client: pg.PoolClient,
  accountId: string,
  kind: DecreeKind,
  now: Date = new Date(),
): Promise<{ ok: true; allianceId: string; until: Date } | { ok: false; code: 'DECREE_NOT_HOLDER' | 'DECREE_COOLDOWN' | 'INVALID_PARAMS'; nextAt?: Date }> {
  if (!isDecreeKind(kind)) {
    return { ok: false, code: 'INVALID_PARAMS' };
  }
  const res = await client.query(
    `SELECT al.id, al.luoyang_holder, al.decree_next_at, am.role
     FROM alliance_members am JOIN alliances al ON al.id = am.alliance_id
     WHERE am.account_id = $1 FOR UPDATE OF al`,
    [accountId],
  );
  const row = res.rows[0] as
    | { id: string; luoyang_holder: boolean; decree_next_at: Date | null; role: string }
    | undefined;
  if (!row || !row.luoyang_holder || row.role !== 'leader') {
    return { ok: false, code: 'DECREE_NOT_HOLDER' };
  }
  if (row.decree_next_at && row.decree_next_at.getTime() > now.getTime()) {
    return { ok: false, code: 'DECREE_COOLDOWN', nextAt: row.decree_next_at };
  }
  const until = new Date(now.getTime() + decreeDurationMs());
  const nextAt = new Date(now.getTime() + decreeDurationMs());
  await client.query(
    `UPDATE alliances SET decree_kind = $2, decree_until = $3, decree_next_at = $4 WHERE id = $1`,
    [row.id, kind, until, nextAt],
  );
  return { ok: true, allianceId: row.id, until };
}
