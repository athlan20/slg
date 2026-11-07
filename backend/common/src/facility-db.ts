// 野地设施（望楼）的数据库读写（AISLG-232，v97）：发起 / 撤销建造、到期完成、毁掉与视图映射。
// 纯数值与规则在 facility.ts，表结构在 facility-schema.ts。
//
// 落库口径：wilderness_facilities 每行一块地，level 是**已完成**的等级（新建第一级期间为 0），
// building_to / finish_at 是进行中的那一级——同一块地同一时间只有一个进行中的建造 / 升级（行锁 + 这两列表达）。
// 视野：fog-db.ts 的 ownVisionSources 联表取 level，半径走 facility.ts 的共用函数。
// 丢失：野地易主、所属城易主或消失的既有代码路径统一调 destroyFacility / destroyFacilitiesOfCity，
// 不要在各自入口另写一份（需求「技术细节」）。

import type pg from 'pg';
import { EventType } from './protocol';
import { insertEvent } from './events';
import type { FacilityKind } from './facility';
import { builtFacilityVisionRadius } from './fog';
import type { TerritoryFacilityView, TileFacilityView } from './protocol-world';

type Queryable = pg.Pool | pg.PoolClient;

/** wilderness_facilities 的行 */
export interface FacilityRow {
  x: number;
  y: number;
  kind: string;
  /** 已完成的等级（新建第一级期间为 0） */
  level: number;
  /** 占着这块地的城（建造时是哪座城占着，资源就从哪座城扣） */
  city_id: string;
  /** 进行中的目标等级（没有进行中的建造为 null） */
  building_to: number | null;
  /** 进行中的完成时刻（没有为 null） */
  finish_at: Date | null;
}

/** 设施毁掉时的回报（调用方据此推送地块变化） */
export interface FacilityLoss {
  x: number;
  y: number;
  kind: FacilityKind;
  /** 毁掉时已建成的等级（还在建第一级时为 0） */
  level: number;
  /** 丢设施的账号（没有城池信息时为 null） */
  accountId: string | null;
  cityId: string;
}

const COLUMNS = `x, y, kind, level, city_id, building_to, finish_at`;

/** 单块地的设施（不加锁） */
export async function loadFacility(q: Queryable, x: number, y: number): Promise<FacilityRow | null> {
  const res = await q.query(`SELECT ${COLUMNS} FROM wilderness_facilities WHERE x = $1 AND y = $2`, [x, y]);
  return (res.rows[0] as FacilityRow | undefined) ?? null;
}

/** 单块地的设施（加行锁；须在事务内）：建造 / 升级并发时串行 */
export async function lockFacility(client: pg.PoolClient, x: number, y: number): Promise<FacilityRow | null> {
  const res = await client.query(`SELECT ${COLUMNS} FROM wilderness_facilities WHERE x = $1 AND y = $2 FOR UPDATE`, [x, y]);
  return (res.rows[0] as FacilityRow | undefined) ?? null;
}

/** 一座城名下的全部设施（CityView.territory 用） */
export async function loadCityFacilities(q: Queryable, cityId: string): Promise<FacilityRow[]> {
  const res = await q.query(`SELECT ${COLUMNS} FROM wilderness_facilities WHERE city_id = $1 ORDER BY y, x`, [cityId]);
  return res.rows as FacilityRow[];
}

/** 一座城名下占用的设施名额（每城上限 2 座）：新建第一级也算占名额，避免「同时开 3 个坑」 */
export async function countCityFacilities(q: Queryable, cityId: string): Promise<number> {
  const res = await q.query(`SELECT count(*)::int AS n FROM wilderness_facilities WHERE city_id = $1`, [cityId]);
  return (res.rows[0] as { n: number }).n;
}

/** 地块设施对所有人的视图：还在建第一级（level = 0）时不给——别人只看到有望楼的格子 */
export function tileFacilityView(row: Pick<FacilityRow, 'kind' | 'level'> | null): TileFacilityView | null {
  if (!row || row.kind !== 'watchtower' || row.level <= 0) {
    return null;
  }
  return { kind: 'watchtower', level: row.level };
}

/** 本城领地里设施的视图（含建造进度，只有主人能看到）：视野半径是这块地**加成后的有效半径**
 * （丘陵上的野地 +2：1 / 2 / 3 级 8 / 10 / 12；AISLG-233），与 fog-db 的实际视野同一口径，
 * 所以调用方要把地块的地形传进来。 */
export function territoryFacilityView(row: FacilityRow | null, terrain?: string | null): TerritoryFacilityView | null {
  if (!row || row.kind !== 'watchtower') {
    return null;
  }
  return {
    kind: 'watchtower',
    level: row.level,
    visionRadius: builtFacilityVisionRadius(row.level, terrain),
    building:
      row.building_to !== null && row.finish_at !== null
        ? { toLevel: row.building_to, finishAt: row.finish_at.toISOString() }
        : null,
  };
}

/** 进行中的建造 / 升级（明细用）：只有主人看得到 */
export function facilityBuildingView(row: FacilityRow | null): { toLevel: number; finishAt: string } | null {
  return territoryFacilityView(row)?.building ?? null;
}

/**
 * 毁掉一块地上的设施（野地易主 / 所属城易主或被放弃 / 账号重置统一走这里）：
 * 删除行、给原主人写一条 facility_lost 事件，返回丢失信息（供调用方推送地块变化）。
 * 地块上没有设施时返回 null，不写事件。
 */
export async function destroyFacility(
  client: pg.PoolClient,
  x: number,
  y: number,
  cause: FacilityLossCause,
): Promise<FacilityLoss | null> {
  const del = await client.query(
    `DELETE FROM wilderness_facilities WHERE x = $1 AND y = $2
     RETURNING x, y, kind, level, city_id,
       (SELECT c.account_id FROM cities c WHERE c.id = wilderness_facilities.city_id) AS account_id`,
    [x, y],
  );
  const row = del.rows[0] as (FacilityRow & { account_id: string | null }) | undefined;
  if (!row) {
    return null;
  }
  const loss: FacilityLoss = {
    x,
    y,
    kind: 'watchtower',
    level: row.level,
    accountId: row.account_id ?? null,
    cityId: row.city_id,
  };
  // 城池已被删除（外键级联）时查不到主人，不写事件
  if (loss.accountId) {
    await insertEvent(client, {
      accountId: loss.accountId,
      cityId: loss.cityId,
      type: EventType.FACILITY_LOST,
      initiator: null,
      detail: { x, y, kind: loss.kind, level: loss.level, cause },
    });
  }
  return loss;
}

/** 设施丢失的原因（写进 facility_lost 的 detail.cause，与 wilderness_lost 的口径一致）：
 *  conquest 野地被抢 / npc_attack NPC 袭击失守 / recall 召回驻军主动放弃 / city_lost 所属分城易主或被放弃 / reset 重置账号 */
export type FacilityLossCause = 'conquest' | 'npc_attack' | 'recall' | 'city_lost' | 'reset';

/**
 * 一座城名下的全部设施一起毁掉（所属分城易主 / 被放弃 / 账号重置）：
 * 逐个调 destroyFacility（同一套事件与回报），返回丢失列表。
 */
export async function destroyFacilitiesOfCity(
  client: pg.PoolClient,
  cityId: string,
  cause: FacilityLossCause,
): Promise<FacilityLoss[]> {
  const res = await client.query(`SELECT x, y FROM wilderness_facilities WHERE city_id = $1 ORDER BY y, x`, [cityId]);
  const losses: FacilityLoss[] = [];
  for (const row of res.rows as Array<{ x: number; y: number }>) {
    const loss = await destroyFacility(client, row.x, row.y, cause);
    if (loss) {
      losses.push(loss);
    }
  }
  return losses;
}
