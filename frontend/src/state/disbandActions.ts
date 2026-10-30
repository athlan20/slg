// 遣散动作（DISBAND_TROOPS，v84，AISLG-209）：与征兵动作同形态——成功直接用服务端回的
// 遣散后城池状态替换本地、记一条本地事件并防抖对齐；失败返回人读错误给表单展示。
// 从 useGameSession 拆出以控制单文件行数；依赖由会话钩子注入。

import { ApiClient } from '../api/client';
import { Op, type CityView, type Resources, type TroopKind } from '../api/protocol';
import { disbandErrorText } from '../api/errorText';
import { disbandRefundText, disbandTroopsText, nonZeroTroops } from '../api/disbandText';
import { getCopy } from '../i18n/bundle';
import type { Actor } from '../types';

export interface DisbandActionsDeps {
  clientRef: { current: ApiClient | null };
  setCity: (updater: (prev: CityView | null) => CityView | null) => void;
  appendLocalEvent: (actor: Actor, text: string) => void;
  scheduleSync: () => void;
}

function field<T>(data: Record<string, unknown> | undefined, key: string): T | undefined {
  return (data?.[key] as T | undefined) ?? undefined;
}

export function createDisbandActions(deps: DisbandActionsDeps): {
  disbandTroops: (troops: Partial<Record<TroopKind, number>>) => Promise<string | null>;
} {
  const { clientRef, setCity, appendLocalEvent, scheduleSync } = deps;

  /** 遣散：成功换用服务端返回的城池状态；失败返回人读错误（失败响应不带 city，靠防抖对齐） */
  const disbandTroops = async (troops: Partial<Record<TroopKind, number>>): Promise<string | null> => {
    const { COPY } = getCopy();
    const client = clientRef.current;
    if (!client?.connected) {
      return COPY.errors.disband.fallback;
    }
    const payload = nonZeroTroops(troops);
    try {
      const res = await client.request(Op.DISBAND_TROOPS, { troops: payload });
      if (res.ok) {
        const city = field<CityView>(res.data, 'city');
        if (city) {
          setCity(() => city);
        }
        const disbanded = field<Partial<Record<TroopKind, number>>>(res.data, 'disbanded') ?? payload;
        const refunded = field<Resources>(res.data, 'refunded');
        appendLocalEvent('player', COPY.session.troopsDisbanded(disbandTroopsText(disbanded), disbandRefundText(refunded)));
        scheduleSync();
        return null;
      }
      scheduleSync();
      const failure = disbandErrorText(res.error?.code, res.error?.message);
      appendLocalEvent('player', COPY.session.troopsDisbandedRejected(failure));
      return failure;
    } catch (err) {
      return err instanceof Error ? err.message : COPY.errors.disband.fallback;
    }
  };

  return { disbandTroops };
}
