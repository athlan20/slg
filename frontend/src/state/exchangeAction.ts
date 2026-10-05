// 集市兑换动作（EXCHANGE，v22 AISLG-42；AISLG-67 补前端入口）：成功按响应携带的
// 城池状态直接更新 + 本地事件；失败把人读错误（含资源缺口后缀，AISLG-69）返回给
// 弹窗展示。从 useGameSession 拆出以控制单文件行数；依赖由会话钩子注入。

import { ApiClient } from '../api/client';
import { Op, type CityView } from '../api/protocol';
import { exchangeErrorText } from '../api/mapping';
import { getCopy } from '../i18n/bundle';
import type { Actor } from '../types';

/** 可兑换的基础资源（金币不可逆兑） */
export type ExchangeResource = 'food' | 'wood' | 'stone' | 'iron';

export interface ExchangeActionDeps {
  clientRef: { current: ApiClient | null };
  setCity: (updater: (prev: CityView | null) => CityView | null) => void;
  appendLocalEvent: (actor: Actor, text: string) => void;
  scheduleSync: () => void;
}

export function createExchangeAction(deps: ExchangeActionDeps): {
  exchangeGold: (resource: ExchangeResource, amount: number) => Promise<string | null>;
} {
  const { clientRef, setCity, appendLocalEvent, scheduleSync } = deps;

  /** 发起兑换：成功返回 null（弹窗关闭），失败返回人读错误（弹窗内展示） */
  const exchangeGold = async (resource: ExchangeResource, amount: number): Promise<string | null> => {
    const { COPY, RESOURCE_LABEL } = getCopy();
    const client = clientRef.current;
    if (!client?.connected) {
      return COPY.session.connectFailed;
    }
    try {
      const res = await client.request(Op.EXCHANGE, { resource, amount });
      if (res.ok) {
        const exchange = res.data?.exchange as { gold: number } | undefined;
        const cityNow = res.data?.city as CityView | undefined;
        if (cityNow) {
          setCity(() => cityNow);
        }
        appendLocalEvent(
          'player',
          COPY.session.exchanged(RESOURCE_LABEL[resource], amount, exchange?.gold ?? 0),
        );
        // 金币即时入账不钳上限；防抖走一轮按需查询对齐（其他连接的推送同源）
        scheduleSync();
        return null;
      }
      return exchangeErrorText(res.error?.code, res.error?.message, res.data);
    } catch (err) {
      return err instanceof Error ? err.message : COPY.errors.exchange.fallback;
    }
  };

  return { exchangeGold };
}
