// 伤兵 / 俘虏 / 逃兵动作（RESTORE_TROOPS / RELEASE_TROOPS，v85，AISLG-212）：与遣散动作
// 同形态——成功直接用服务端回的操作后城池状态替换本地、记一条本地事件并防抖对齐；
// 失败返回人读错误给表单展示。从 useGameSession 拆出以控制单文件行数。

import { ApiClient } from '../api/client';
import { Op, type CityView, type Resources, type TroopKind, type TroopPoolKind } from '../api/protocol';
import { poolErrorText } from '../api/errorText';
import { nonZeroTroops, poolCostText, poolTroopsText } from '../api/poolText';
import { getCopy } from '../i18n/bundle';
import type { Actor } from '../types';

export interface TroopPoolsActionsDeps {
  clientRef: { current: ApiClient | null };
  setCity: (updater: (prev: CityView | null) => CityView | null) => void;
  appendLocalEvent: (actor: Actor, text: string) => void;
  scheduleSync: () => void;
}

function field<T>(data: Record<string, unknown> | undefined, key: string): T | undefined {
  return (data?.[key] as T | undefined) ?? undefined;
}

/** 池子的动作名（本地事件用）：治疗 / 招降 / 劝回、放弃 / 释放 */
function restoreLabel(pool: TroopPoolKind): string {
  const { ARMY_COPY } = getCopy();
  return pool === 'wounded' ? ARMY_COPY.pools.restoreWounded : pool === 'captive' ? ARMY_COPY.pools.restoreCaptive : ARMY_COPY.pools.restoreDeserter;
}

function releaseLabel(pool: TroopPoolKind): string {
  const { ARMY_COPY } = getCopy();
  return pool === 'wounded' ? ARMY_COPY.pools.releaseWounded : ARMY_COPY.pools.releaseCaptive;
}

export function createTroopPoolsActions(deps: TroopPoolsActionsDeps): {
  restoreTroops: (pool: TroopPoolKind, troops: Partial<Record<TroopKind, number>>) => Promise<string | null>;
  releaseTroops: (pool: TroopPoolKind, troops: Partial<Record<TroopKind, number>>) => Promise<string | null>;
} {
  const { clientRef, setCity, appendLocalEvent, scheduleSync } = deps;

  /** 治疗 / 招降 / 劝回：成功换用服务端返回的城池状态；失败返回人读错误 */
  const restoreTroops = async (
    pool: TroopPoolKind,
    troops: Partial<Record<TroopKind, number>>,
  ): Promise<string | null> => {
    const { COPY } = getCopy();
    const client = clientRef.current;
    if (!client?.connected) {
      return COPY.errors.pools.fallback;
    }
    const payload = nonZeroTroops(troops);
    try {
      const res = await client.request(Op.RESTORE_TROOPS, { pool, troops: payload });
      if (res.ok) {
        const city = field<CityView>(res.data, 'city');
        if (city) {
          setCity(() => city);
        }
        const restored = field<Partial<Record<TroopKind, number>>>(res.data, 'restored') ?? payload;
        const cost = field<Resources>(res.data, 'cost');
        appendLocalEvent('player', COPY.session.troopsRestored(restoreLabel(pool), poolTroopsText(restored), poolCostText(cost)));
        scheduleSync();
        return null;
      }
      scheduleSync();
      const failure = poolErrorText(res.error?.code, res.error?.message, res.data);
      appendLocalEvent('player', COPY.session.troopsRestoredRejected(failure));
      return failure;
    } catch (err) {
      return err instanceof Error ? err.message : COPY.errors.pools.fallback;
    }
  };

  /** 放弃治疗 / 释放俘虏：免费，不返还任何东西 */
  const releaseTroops = async (
    pool: TroopPoolKind,
    troops: Partial<Record<TroopKind, number>>,
  ): Promise<string | null> => {
    const { COPY } = getCopy();
    const client = clientRef.current;
    if (!client?.connected) {
      return COPY.errors.pools.fallback;
    }
    const payload = nonZeroTroops(troops);
    try {
      const res = await client.request(Op.RELEASE_TROOPS, { pool, troops: payload });
      if (res.ok) {
        const city = field<CityView>(res.data, 'city');
        if (city) {
          setCity(() => city);
        }
        const released = field<Partial<Record<TroopKind, number>>>(res.data, 'released') ?? payload;
        appendLocalEvent('player', COPY.session.troopsReleased(releaseLabel(pool), poolTroopsText(released)));
        scheduleSync();
        return null;
      }
      scheduleSync();
      const failure = poolErrorText(res.error?.code, res.error?.message, res.data);
      appendLocalEvent('player', COPY.session.troopsReleasedRejected(failure));
      return failure;
    } catch (err) {
      return err instanceof Error ? err.message : COPY.errors.pools.fallback;
    }
  };

  return { restoreTroops, releaseTroops };
}
