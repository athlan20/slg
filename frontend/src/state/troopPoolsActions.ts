// 伤兵 / 俘虏 / 逃兵动作（RESTORE_TROOPS / RELEASE_TROOPS，v85，AISLG-212）：与遣散动作
// 同形态——成功直接用服务端回的操作后城池状态替换本地、记一条本地事件并防抖对齐；
// 失败返回人读错误给表单展示。从 useGameSession 拆出以控制单文件行数。
// v88（AISLG-218）：「全部城池一键处理」逐城发同两条协议，多了可选 cityId——
// 带 cityId 时刻意不回写本地城池状态（响应里的 city 是那座分城，不是当前城），
// 对齐交给调用方的 refresh + 防抖同步。

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
  restoreTroops: (pool: TroopPoolKind, troops: Partial<Record<TroopKind, number>>, cityId?: string) => Promise<string | null>;
  releaseTroops: (pool: TroopPoolKind, troops: Partial<Record<TroopKind, number>>, cityId?: string) => Promise<string | null>;
} {
  const { clientRef, setCity, appendLocalEvent, scheduleSync } = deps;

  /** 治疗 / 招降 / 劝回：成功换用服务端返回的城池状态；失败返回人读错误。
   *  cityId 缺省 = 当前城（原有调用不变）；带 cityId 时是「全部城池一键处理」的那一城。 */
  const restoreTroops = async (
    pool: TroopPoolKind,
    troops: Partial<Record<TroopKind, number>>,
    cityId?: string,
  ): Promise<string | null> => {
    const { COPY } = getCopy();
    const client = clientRef.current;
    if (!client?.connected) {
      return COPY.errors.pools.fallback;
    }
    const payload = nonZeroTroops(troops);
    try {
      const res = await client.request(Op.RESTORE_TROOPS, cityId ? { pool, troops: payload, cityId } : { pool, troops: payload });
      if (res.ok) {
        const city = field<CityView>(res.data, 'city');
        // 只在未指定城（= 当前城）时回写本地状态；分城的结果由刷新对齐
        if (city && cityId === undefined) {
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

  /** 放弃治疗 / 释放俘虏：免费，不返还任何东西；cityId 口径同 restoreTroops */
  const releaseTroops = async (
    pool: TroopPoolKind,
    troops: Partial<Record<TroopKind, number>>,
    cityId?: string,
  ): Promise<string | null> => {
    const { COPY } = getCopy();
    const client = clientRef.current;
    if (!client?.connected) {
      return COPY.errors.pools.fallback;
    }
    const payload = nonZeroTroops(troops);
    try {
      const res = await client.request(Op.RELEASE_TROOPS, cityId ? { pool, troops: payload, cityId } : { pool, troops: payload });
      if (res.ok) {
        const city = field<CityView>(res.data, 'city');
        if (city && cityId === undefined) {
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
