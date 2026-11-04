// 盲打判定（AISLG-224 第四步）：出征 / 侦察的目标在战争迷雾中（未探索、也不在实时视野内）时，
// 目标相关的校验被拒绝不向玩家报错，改为正常建行军（见 handlers-world.ts 的 MARCH、handlers-battle.ts 的 SCOUT）。
// 本文件只判定“是不是未知格”，不改任何数据；fog_enabled 关闭时恒为 false（行为与上线前一致）。
import type pg from 'pg';
import type { MarchTask } from '../../common/src/protocol';
import { getFogEnabled } from '../../common/src/fog-config';
import { ensureFogState, marchVisionSources, ownVisionSources } from '../../common/src/fog-db';
import { inAnyVision, isCellExplored } from '../../common/src/fog';
import { loadTechLevels } from '../../common/src/tech-db';
import { isAllyOfCity } from './march-target';

/** 盲打只支持 plunder / occupy（运输、调兵、增援、协防的目标都是自己或盟友的地，不会在迷雾里） */
export function blindEligibleTask(task: MarchTask): boolean {
  return task === 'plunder' || task === 'occupy';
}

/**
 * 格子是否为迷雾中的未知格：迷雾开启、区块未探索、不在任何视野来源内，且不是盟友的城池格。
 * 调用方须已在事务内（会维护探索状态）。
 */
export async function isUnknownTarget(client: pg.PoolClient, accountId: string, x: number, y: number, now: Date): Promise<boolean> {
  if (!getFogEnabled()) {
    return false;
  }
  const state = await ensureFogState(client, accountId, now);
  if (isCellExplored(state.bits, x, y)) {
    return false;
  }
  const scouting = (await loadTechLevels(client, accountId)).scouting ?? 0;
  const sources = [
    ...(await ownVisionSources(client, accountId)),
    ...(await marchVisionSources(client, accountId, now, scouting)),
  ];
  if (inAnyVision(sources, x, y)) {
    return false;
  }
  const tile = await client.query(`SELECT kind, owner_city_id FROM world_tiles WHERE x = $1 AND y = $2`, [x, y]);
  const row = tile.rows[0] as { kind: string; owner_city_id: string | null } | undefined;
  if (row && row.kind === 'city' && row.owner_city_id && (await isAllyOfCity(client, accountId, row.owner_city_id))) {
    // 盟友城池格始终实时可见（只这一格）
    return false;
  }
  return true;
}
