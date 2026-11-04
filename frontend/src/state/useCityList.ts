// 多城会话状态（v24，AISLG-58，从 useGameSession 拆出以控制单文件行数）：
// - 账号全部城池与分城名额（GET_STATE 的 cities / branch）；
// - 当前操作的城池：选中后由请求层（api/cityScope）给城池类协议统一注入 cityId，
//   GET_STATE 随之返回该城的状态。登录 / 登出 / 重置账号复位为主城。

import { useCallback, useState } from 'react';
import { getActiveCityId, setActiveCityId } from '../api/cityScope';
import type { BranchInfoView, CapitalSwapView, CityRefView, CityView, ItemCounts, MoveCityView } from '../api/protocol';

/** 账号礼金（v89，AISLG-221）：余额与每季发放额度（GET_STATE 的 gift / giftSeasonGrant，未拉到为 null） */
export interface GiftView {
  balance: number;
  seasonGrant: number;
}

export interface CityList {
  cities: CityRefView[];
  branch: BranchInfoView | null;
  /** 设为主城的账号级状态与逐分城不可设原因（v82，AISLG-205；GET_STATE 的 capitalSwap，未拉到为 null） */
  capitalSwap: CapitalSwapView | null;
  /** 账号礼金（账号级，不分城；账号菜单显示） */
  gift: GiftView | null;
  /** 道具背包数量（v90，AISLG-222；GET_STATE 的 items，未拉到为 null） */
  items: ItemCounts | null;
  /** 城池迁移视图（v91，AISLG-220；GET_STATE 的 moveCity，未拉到为 null） */
  moveCity: MoveCityView | null;
  /** 当前正在操作的城池 id（null = 尚未获取） */
  activeCityId: string | null;
  /** 吸收一次 GET_STATE 响应的 cities / branch；选中的城已不存在时复位主城 */
  applyState: (data: Record<string, unknown> | undefined) => void;
  /** 吸收道具变化（BUY_ITEM 响应、PUSH_ACCOUNT_STATE items_changed）：只改给出的字段，礼金余额保留每季额度 */
  applyItems: (update: { items?: Partial<ItemCounts>; gift?: number }) => void;
  /** 登录 / 登出 / 重置时复位 */
  reset: () => void;
  /** 切换操作城池：改请求注入、清掉旧城状态，随后由调用方重拉 */
  select: (cityId: string) => boolean;
}

export function useCityList(setCity: (city: CityView | null) => void): CityList {
  const [cities, setCities] = useState<CityRefView[]>([]);
  const [branch, setBranch] = useState<BranchInfoView | null>(null);
  const [capitalSwap, setCapitalSwap] = useState<CapitalSwapView | null>(null);
  const [gift, setGift] = useState<GiftView | null>(null);
  const [items, setItems] = useState<ItemCounts | null>(null);
  const [moveCity, setMoveCity] = useState<MoveCityView | null>(null);
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
    const swap = data?.capitalSwap as CapitalSwapView | undefined;
    if (swap) {
      setCapitalSwap(swap);
    }
    if (typeof data?.gift === 'number' && typeof data?.giftSeasonGrant === 'number') {
      setGift({ balance: data.gift, seasonGrant: data.giftSeasonGrant });
    }
    const bag = data?.items as ItemCounts | undefined;
    if (bag && typeof bag === 'object') {
      setItems(bag);
    }
    const move = data?.moveCity as MoveCityView | undefined;
    if (move && Array.isArray(move.cities)) {
      setMoveCity(move);
    }
    const city = data?.city as CityView | undefined;
    if (city) {
      setActive(city.id);
    }
  }, []);

  const applyItems = useCallback((update: { items?: Partial<ItemCounts>; gift?: number }) => {
    if (update.items) {
      const patch = update.items;
      setItems((prev) => ({ ...(prev ?? ({} as ItemCounts)), ...patch }) as ItemCounts);
    }
    if (typeof update.gift === 'number') {
      const balance = update.gift;
      // 每季额度来自 GET_STATE（giftSeasonGrant）；还没拉到时不凭空造数
      setGift((prev) => (prev ? { balance, seasonGrant: prev.seasonGrant } : prev));
    }
  }, []);

  const reset = useCallback(() => {
    setActiveCityId(null);
    setCities([]);
    setBranch(null);
    setCapitalSwap(null);
    setGift(null);
    setItems(null);
    setMoveCity(null);
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

  return { cities, branch, capitalSwap, gift, items, moveCity, activeCityId, applyState, applyItems, reset, select };
}
