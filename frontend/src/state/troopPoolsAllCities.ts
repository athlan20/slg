// 全账号伤兵营会话切片（v88，AISLG-218）：GET_TROOP_POOLS 的全城池子（汇总行 / 一键处理 / 红点共用）。
// 刷新时机照小地图（AISLG-160）的口径：连接建立后拉一次（红点要在打开伤兵营之前就亮），
// 伤兵营可见时每 30 秒刷新一次，本城或一键处理做完立即刷新，收到 PUSH_BATTLE_REPORT 且可见时也刷新。
// 这里只做「拉取 + 汇总判断」，处理动作仍走逐城的 RESTORE_TROOPS / RELEASE_TROOPS（服务端没有批量协议）。

import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../api/client';
import {
  Op,
  POOL_EXPIRE_WARN_HOURS,
  TROOP_KINDS,
  type AccountTroopPoolsCityView,
  type TroopKind,
  type TroopPoolKind,
  type TroopPoolView,
} from '../api/protocol';

/** 伤兵营可见时的刷新间隔（毫秒）：池子会随到期消失，30 秒够用 */
const POOLS_REFETCH_MS = 30_000;

export interface TroopPoolsAllCitiesSession {
  /** 最近一次拉取的全城池子；未连上或还没拉到为 null */
  cities: AccountTroopPoolsCityView[] | null;
  /** 伤兵营当前是否可见（可见时才 30 秒轮询） */
  setVisible: (visible: boolean) => void;
  /** 立即重拉（本城处理完 / 一键处理完 / 战报推送后调用） */
  refresh: () => Promise<void>;
}

export function useTroopPoolsAllCities(deps: {
  clientRef: { current: ApiClient | null };
  connected: boolean;
  /** 收到 PUSH_BATTLE_REPORT 的次数（战报可能带来新的伤兵 / 俘虏，可见时刷新一次） */
  battleReportTick: number;
}): TroopPoolsAllCitiesSession {
  const { clientRef, connected, battleReportTick } = deps;
  const [cities, setCities] = useState<AccountTroopPoolsCityView[] | null>(null);
  const [visible, setVisibleState] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client?.connected) {
      return;
    }
    try {
      const res = await client.request(Op.GET_TROOP_POOLS, {});
      if (res.ok && Array.isArray(res.data?.cities)) {
        setCities(res.data.cities as unknown as AccountTroopPoolsCityView[]);
      }
    } catch {
      // 拉取失败保留旧数据，下个周期再对齐
    }
  }, [clientRef]);

  // 连接建立后拉一次：军队页的红点要在打开伤兵营之前就亮（分城的池子快过期也算）
  useEffect(() => {
    if (!connected) {
      setCities(null);
      return undefined;
    }
    void refresh();
    return undefined;
  }, [connected, refresh]);

  // 伤兵营可见时每 30 秒刷新一次；切走页签或离线即停
  useEffect(() => {
    if (!connected || !visible) {
      return undefined;
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), POOLS_REFETCH_MS);
    return () => window.clearInterval(timer);
  }, [connected, visible, refresh]);

  // 战报推送（可能有新的伤兵 / 俘虏）：伤兵营可见时刷新一次
  useEffect(() => {
    if (connected && visible && battleReportTick > 0) {
      void refresh();
    }
  }, [battleReportTick, connected, visible, refresh]);

  const setVisible = useCallback((next: boolean) => setVisibleState(next), []);

  return { cities, setVisible, refresh };
}

/** 池子在城视图上的字段名（pool=captive 对应 captives） */
export function cityPoolView(city: AccountTroopPoolsCityView, pool: TroopPoolKind): TroopPoolView {
  return pool === 'wounded' ? city.wounded : pool === 'captive' ? city.captives : city.deserters;
}

/** 池子里各兵种合计 */
export function poolTotalOf(view: TroopPoolView): number {
  return TROOP_KINDS.reduce((sum, kind) => sum + Math.max(0, Math.floor(view.troops[kind] ?? 0)), 0);
}

/** 池子的非零编队（发给 RESTORE_TROOPS / RELEASE_TROOPS 的 troops） */
export function poolTroopsOf(view: TroopPoolView): Partial<Record<TroopKind, number>> {
  const troops: Partial<Record<TroopKind, number>> = {};
  for (const kind of TROOP_KINDS) {
    const count = Math.max(0, Math.floor(view.troops[kind] ?? 0));
    if (count > 0) {
      troops[kind] = count;
    }
  }
  return troops;
}

/** 最早一批的剩余秒数；池空 / 已过期为 0 */
export function poolRemainSeconds(earliestExpireAt: string | null): number {
  if (earliestExpireAt === null) {
    return 0;
  }
  return Math.max(0, (Date.parse(earliestExpireAt) - Date.now()) / 1000);
}

/** 是否快过期（剩不足阈值）——城池红点、池内红色提示与全城红点共用这一个判断 */
export function poolExpiringSoon(earliestExpireAt: string | null): boolean {
  return earliestExpireAt !== null && poolRemainSeconds(earliestExpireAt) <= POOL_EXPIRE_WARN_HOURS * 3600;
}

/** 全部城池里某个池子的合计：数量之和、有该池子的城数、最早过期时刻（最小值） */
export function poolSumOf(
  cities: AccountTroopPoolsCityView[] | null,
  pool: TroopPoolKind,
): { total: number; citiesWith: number; earliestExpireAt: string | null } {
  let total = 0;
  let citiesWith = 0;
  let earliest: string | null = null;
  for (const city of cities ?? []) {
    const view = cityPoolView(city, pool);
    const count = poolTotalOf(view);
    if (count <= 0) {
      continue;
    }
    total += count;
    citiesWith += 1;
    if (view.earliestExpireAt !== null && (earliest === null || Date.parse(view.earliestExpireAt) < Date.parse(earliest))) {
      earliest = view.earliestExpireAt;
    }
  }
  return { total, citiesWith, earliestExpireAt: earliest };
}

/** 是否任意一座城的该池子快过期（军队页「伤兵营」页签与各池子页签的红点用） */
export function anyCityPoolExpiringSoon(cities: AccountTroopPoolsCityView[] | null, pool: TroopPoolKind): boolean {
  return (cities ?? []).some((city) => poolExpiringSoon(cityPoolView(city, pool).earliestExpireAt));
}

/** 该城现在是否已断粮（starveAt 不为 null 且已到）——「全部劝回」据此跳过 */
export function cityStarvingNow(city: AccountTroopPoolsCityView): boolean {
  return city.starveAt !== null && Date.parse(city.starveAt) <= Date.now();
}
