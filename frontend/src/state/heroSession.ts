// 武将会话切片（v36，AISLG-114/115/116）：账号全部武将 / 当前城酒馆候选 / 上限 / 名将归属的拉取，
// 招募 / 解雇 / 任命城守，以及 PUSH_HERO_STATE 到达时的联动。另持有「出征带将」的选择：
// 出征 / 侦察 / 截击 / 运输表单共用同一份（HeroContext），提交成功后清空（武将已随军）。
// 酒馆候选按城，GET_HEROES 经请求层注入当前城（cityScope）；权威判定都在服务端（HERO_* 错误码）。

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiClient } from '../api/client';
import {
  Op,
  type CityView,
  type HeroStatePushData,
  type HeroStateView,
  type HeroView,
} from '../api/protocol';
import { heroErrorText } from '../api/errorText';
import { HERO_COPY } from '../copy-hero';

interface HeroSessionDeps {
  clientRef: { current: ApiClient | null };
  connected: boolean;
  /** 当前城 id：切城后候选要换成该城酒馆的 */
  cityId: string | null;
  /** 酒馆等级 / 城池资源随招募 / 俸禄变化——让城池状态对齐 */
  scheduleSync: () => void;
  setCity: (updater: (prev: CityView | null) => CityView | null) => void;
}

export interface HeroSession {
  /** 武将状态（null = 尚未拉取） */
  state: HeroStateView | null;
  error: string | null;
  busy: boolean;
  /** 出征带将选择（null = 不带将） */
  selectedHeroId: string | null;
  selectHero: (heroId: string | null) => void;
  fetchHeroes: () => Promise<void>;
  recruit: (candidateId: string) => Promise<boolean>;
  dismiss: (heroId: string) => Promise<boolean>;
  /** 任命（heroId）/ 撤任（null）当前城城守 */
  assignGuard: (heroId: string | null) => Promise<boolean>;
  onHeroPush: (data: HeroStatePushData) => void;
  clear: () => void;
}

/** 出征表单可选武将：未重伤 / 未欠饷 / 不在外 / 非城守（与服务端 checkHeroMarchable 同口径，仅作预判） */
export function heroUnavailableReason(hero: HeroView, now: number): 'wounded' | 'arrears' | 'busy' | 'guard' | null {
  if (hero.woundedUntil && Date.parse(hero.woundedUntil) > now) {
    return 'wounded';
  }
  if (hero.arrears) {
    return 'arrears';
  }
  if (hero.marchingMarchId) {
    return 'busy';
  }
  if (hero.guardCityId) {
    return 'guard';
  }
  return null;
}

export function useHeroSession(deps: HeroSessionDeps): HeroSession {
  const { clientRef, connected, cityId, scheduleSync, setCity } = deps;
  const [state, setState] = useState<HeroStateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedHeroId, setSelectedHeroId] = useState<string | null>(null);

  const fetchHeroes = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client?.connected) {
      return;
    }
    try {
      const res = await client.request(Op.GET_HEROES, {});
      if (res.ok && res.data) {
        setState(res.data as unknown as HeroStateView);
      }
    } catch {
      // 拉取失败保留旧值，下次推送 / 重连 / 切城再试
    }
  }, [clientRef]);

  // 连接就绪 / 切城时重拉（酒馆候选按城）
  useEffect(() => {
    if (connected && cityId) {
      void fetchHeroes();
    }
  }, [connected, cityId, fetchHeroes]);

  /** 失败时若所选武将已不可用（被他人推送改变），清掉选择 */
  useEffect(() => {
    if (selectedHeroId && state && !state.heroes.some((hero) => hero.id === selectedHeroId)) {
      setSelectedHeroId(null);
    }
  }, [selectedHeroId, state]);

  const run = useCallback(
    async (op: number, data: Record<string, unknown>, after?: () => void): Promise<boolean> => {
      const client = clientRef.current;
      if (!client?.connected || busy) {
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await client.request(op, data);
        if (res.ok) {
          after?.();
          await fetchHeroes();
          scheduleSync();
          return true;
        }
        setError(heroErrorText(res.error?.code, res.error?.message));
        const cityNow = res.data?.city as CityView | undefined;
        if (cityNow) {
          setCity(() => cityNow);
        }
        void fetchHeroes();
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : HERO_COPY.errors.fallback);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [clientRef, busy, fetchHeroes, scheduleSync, setCity],
  );

  const recruit = useCallback((candidateId: string) => run(Op.RECRUIT_HERO, { candidateId }), [run]);
  const dismiss = useCallback(
    (heroId: string) => run(Op.DISMISS_HERO, { heroId }, () => setSelectedHeroId((prev) => (prev === heroId ? null : prev))),
    [run],
  );
  const assignGuard = useCallback(
    (heroId: string | null) => run(Op.ASSIGN_HERO, { heroId }, () => setSelectedHeroId((prev) => (prev === heroId ? null : prev))),
    [run],
  );

  const onHeroPush = useCallback(
    (_data: HeroStatePushData): void => {
      // 任何 reason 都以权威查询对齐（欠饷 / 重伤 / 经验 / 获得名将）；俸禄与招募费影响金币
      void fetchHeroes();
      scheduleSync();
    },
    [fetchHeroes, scheduleSync],
  );

  const clear = useCallback((): void => {
    setState(null);
    setError(null);
    setBusy(false);
    setSelectedHeroId(null);
  }, []);

  return useMemo(
    () => ({
      state,
      error,
      busy,
      selectedHeroId,
      selectHero: setSelectedHeroId,
      fetchHeroes,
      recruit,
      dismiss,
      assignGuard,
      onHeroPush,
      clear,
    }),
    [state, error, busy, selectedHeroId, fetchHeroes, recruit, dismiss, assignGuard, onHeroPush, clear],
  );
}
