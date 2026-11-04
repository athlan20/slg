// 道具切片（v90，AISLG-222）：背包 / 商店弹窗的开关、目录（GET_ITEMS）与礼金购买（BUY_ITEM）。
// 背包数量与礼金余额落在 useCityList（applyItems），与账号菜单的礼金行、推送共用同一份状态。
// 单价以服务端为准：BUY_ITEM 带上页面显示的单价，收到 ITEM_PRICE_CHANGED 只刷新目录并提示，不自动重试。

import { useCallback, useMemo, useState } from 'react';
import type { ApiClient } from '../api/client';
import { Op, type BuyItemResponseData, type GetItemsResponseData, type ItemCounts, type ItemDefView, type ItemId } from '../api/protocol';
import { itemErrorText } from '../api/itemText';
import { getCopy } from '../i18n/bundle';
import type { CityList } from './useCityList';

export type ItemsTab = 'bag' | 'shop';

export interface ItemsSession {
  open: boolean;
  tab: ItemsTab;
  setTab: (tab: ItemsTab) => void;
  /** 道具目录（GET_ITEMS 的 catalog）；未拉到为 null */
  catalog: ItemDefView[] | null;
  loading: boolean;
  /** 购买 / 拉取的失败提示（价格已变时也走这里） */
  error: string | null;
  /** 购买成功的提示 */
  notice: string | null;
  busy: boolean;
  openPanel: () => void;
  closePanel: () => void;
  refresh: () => Promise<void>;
  buy: (itemId: ItemId, count: number, expectedPrice: number) => Promise<void>;
  clear: () => void;
}

export function useItemsSession(clientRef: { current: ApiClient | null }, options: { applyItems: CityList['applyItems'] }): ItemsSession {
  const { applyItems } = options;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ItemsTab>('bag');
  const [catalog, setCatalog] = useState<ItemDefView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const client = clientRef.current;
    if (!client?.connected) {
      return;
    }
    setLoading(true);
    try {
      const res = await client.request(Op.GET_ITEMS, {});
      if (res.ok) {
        const data = res.data as unknown as GetItemsResponseData;
        setCatalog(data.catalog);
        applyItems({ items: data.items as ItemCounts, gift: data.gift });
        setError(null);
      } else {
        setError(itemErrorText(res.error?.code, res.error?.message));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : getCopy().ITEM_COPY.errors.fallback);
    } finally {
      setLoading(false);
    }
  }, [clientRef, applyItems]);

  const openPanel = useCallback(() => {
    setOpen(true);
    setTab('bag');
    setNotice(null);
    void refresh();
  }, [refresh]);

  const closePanel = useCallback(() => {
    setOpen(false);
    setError(null);
    setNotice(null);
  }, []);

  const buy = useCallback(
    async (itemId: ItemId, count: number, expectedPrice: number) => {
      const { ITEM_COPY } = getCopy();
      const client = clientRef.current;
      if (!client?.connected) {
        setError(ITEM_COPY.errors.fallback);
        return;
      }
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const res = await client.request(Op.BUY_ITEM, { itemId, count, expectedPrice });
        if (res.ok) {
          const data = res.data as unknown as BuyItemResponseData;
          applyItems({ items: { [itemId]: data.count }, gift: data.gift });
          setNotice(ITEM_COPY.bought(ITEM_COPY.names[itemId], data.bought, data.gift));
          return;
        }
        if (res.error?.code === 'ITEM_PRICE_CHANGED') {
          const price = Number((res.data as { price?: unknown } | undefined)?.price ?? expectedPrice);
          setError(ITEM_COPY.priceChanged(price));
        } else {
          setError(itemErrorText(res.error?.code, res.error?.message));
        }
        // 失败后按服务端重拉一次目录与余额，界面不留旧数
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : ITEM_COPY.errors.fallback);
      } finally {
        setBusy(false);
      }
    },
    [clientRef, applyItems, refresh],
  );

  const clear = useCallback(() => {
    setOpen(false);
    setTab('bag');
    setCatalog(null);
    setError(null);
    setNotice(null);
  }, []);

  return useMemo(
    () => ({ open, tab, setTab, catalog, loading, error, notice, busy, openPanel, closePanel, refresh, buy, clear }),
    [open, tab, catalog, loading, error, notice, busy, openPanel, closePanel, refresh, buy, clear],
  );
}
