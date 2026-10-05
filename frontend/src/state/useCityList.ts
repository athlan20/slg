// 多城会话状态（v24，AISLG-58，从 useGameSession 拆出以控制单文件行数）：
// - 账号全部城池与分城名额（GET_STATE 的 cities / branch）；
// - 当前操作的城池：选中后由请求层（api/cityScope）给城池类协议统一注入 cityId，
//   GET_STATE 随之返回该城的状态。登录 / 登出 / 重置账号复位为主城。

import { useCallback, useState } from 'react';
import { getActiveCityId, setActiveCityId } from '../api/cityScope';
import type { BranchInfoView, CityRefView, CityView } from '../api/protocol';

export interface CityList {
  cities: CityRefView[];
  branch: BranchInfoView | null;
  /** 当前正在操作的城池 id（null = 尚未获取） */
  activeCityId: string | null;
  /** 吸收一次 GET_STATE 响应的 cities / branch；选中的城已不存在时复位主城 */
  applyState: (data: Record<string, unknown> | undefined) => void;
  /** 登录 / 登出 / 重置时复位 */
  reset: () => void;
  /** 切换操作城池：改请求注入、清掉旧城状态，随后由调用方重拉 */
  select: (cityId: string) => boolean;
}

export function useCityList(setCity: (city: CityView | null) => void): CityList {
  const [cities, setCities] = useState<CityRefView[]>([]);
  const [branch, setBranch] = useState<BranchInfoView | null>(null);
  const [activeCityId, setActive] = useState<string | null>(null);

  const applyState = useCallback((data: Record<string, unknown> | undefined) => {
    const list = data?.cities as CityRefView[] | undefined;
    if (Array.isArray(list)) {
      setCities(list);
      const selected = getActiveCityId();
      if (selected !== null && !list.some((item) => item.id === selected)) {
        setActiveCityId(null);
      }
    }
    const info = data?.branch as BranchInfoView | undefined;
    if (info) {
      setBranch(info);
    }
    const city = data?.city as CityView | undefined;
    if (city) {
      setActive(city.id);
    }
  }, []);

  const reset = useCallback(() => {
    setActiveCityId(null);
    setCities([]);
    setBranch(null);
    setActive(null);
  }, []);

  const select = useCallback(
    (cityId: string): boolean => {
      const target = cities.find((item) => item.id === cityId);
      if (!target || cityId === activeCityId) {
        return false;
      }
      setActiveCityId(target.isMain ? null : target.id);
      setActive(target.id);
      setCity(null);
      return true;
    },
    [cities, activeCityId, setCity],
  );

  return { cities, branch, activeCityId, applyState, reset, select };
}
