// 返程行军的结算（从 world-tick.ts 拆出，AISLG-227 为控制单文件行数）：城池生产结算到到达时刻，
// 部队并入城内驻军，运输货物随部队回到出发城。调用方须已在 processDueMarches 的事务内。
import type pg from 'pg';
import type { TroopKind } from '../../common/src/protocol';
import { readCargo } from '../../common/src/transport';
import { completeMarchEvent, creditLoot, settleOwnerCity, troopsEnterCity, type MarchRow } from './tick-shared';

export async function settleReturn(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
): Promise<void> {
  const { row } = await settleOwnerCity(client, march.from_city_id, march.arrive_at);
  if (row) {
    await troopsEnterCity(client, march.from_city_id, troops);
    // v26（AISLG-79）：撤回 / 失效返程的运输货物随部队回到出发城（即时入账，不钳储量上限）
    const cargo = readCargo(march.cargo);
    if (cargo) {
      await creditLoot(client, march.from_city_id, cargo);
    }
  }
  // 城池行被删（重置）时部队随之消失；行军仍标记结算完成，避免重复处理
  const upd = await client.query(
    `UPDATE marches SET status = 'returned', resolved_at = clock_timestamp()
     WHERE id = $1 AND status = 'marching' RETURNING id`,
    [march.id],
  );
  if (upd.rowCount) {
    await completeMarchEvent(client, march, 'returned', { troops });
  }
}
