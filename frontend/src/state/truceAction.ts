// 主动免战动作（TRUCE，v38 AISLG-122）：每周一次免费、持续 12 小时基准随缩放。
// 成功后按需查询对齐 city.shieldUntil / shieldNextAt；失败把人读错误返回给按钮处展示。
// 与 exchangeAction 同形态拆出以控制 useGameSession 行数。

import { ApiClient } from '../api/client';
import { Op } from '../api/protocol';
import { getCopy } from '../i18n/bundle';
import type { Actor } from '../types';

export interface TruceActionDeps {
  clientRef: { current: ApiClient | null };
  appendLocalEvent: (actor: Actor, text: string) => void;
  scheduleSync: () => void;
}

export function createTruceAction(deps: TruceActionDeps): {
  startTruce: () => Promise<string | null>;
} {
  const { clientRef, appendLocalEvent, scheduleSync } = deps;

  /** 开启免战：成功返回 null，失败返回人读错误（按钮旁展示） */
  const startTruce = async (): Promise<string | null> => {
    const { COPY } = getCopy();
    const client = clientRef.current;
    if (!client?.connected) {
      return COPY.session.connectFailed;
    }
    try {
      const res = await client.request(Op.TRUCE, {});
      if (res.ok) {
        const data = res.data as { shieldUntil?: string } | undefined;
        appendLocalEvent('player', COPY.truce.startedText(data?.shieldUntil ?? null));
        scheduleSync();
        return null;
      }
      const retry = res.data?.retryAfterSeconds as number | undefined;
      switch (res.error?.code) {
        case 'TRUCE_ALREADY_ACTIVE':
          return COPY.truce.errAlreadyActive;
        case 'TRUCE_WEEKLY_USED':
          return retry && retry > 0 ? COPY.truce.errWeeklyUsedLeft(retry) : COPY.truce.errWeeklyUsed;
        default:
          return res.error?.message ?? COPY.truce.errFallback;
      }
    } catch (err) {
      return err instanceof Error ? err.message : COPY.truce.errFallback;
    }
  };

  return { startTruce };
}
