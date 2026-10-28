// 城防器械动作（CRAFT_DEFENSE / CANCEL_DEFENSE_CRAFT，v73 AISLG-193）：与征兵同形态——
// 发起 / 取消后按需查询对齐权威状态（库存与队列由服务端下发），失败展示人读错误。
// 从 useGameSession 拆出以控制单文件行数；依赖由会话钩子注入。

import { ApiClient } from '../api/client';
import {
  Op,
  type DefenseCraftView,
  type DefenseKind,
  type DefenseStatePushData,
  type CraftDefenseResponseData,
} from '../api/protocol';
import { formatClock } from '../api/mapping';
import { getCopy } from '../i18n/bundle';
import type { Actor } from '../types';

export interface DefenseActionsDeps {
  clientRef: { current: ApiClient | null };
  setDefenseError: (message: string | null) => void;
  appendLocalEvent: (actor: Actor, text: string) => void;
  scheduleSync: () => void;
}

function field<T>(data: Record<string, unknown> | undefined, key: string): T | undefined {
  return (data?.[key] as T | undefined) ?? undefined;
}

/** 错误码 → 人读文案（未知码回落服务端 message） */
function errorText(code: string | undefined, message: string | undefined): string {
  const { DEFENSE_COPY } = getCopy();
  switch (code) {
    case 'WALL_NOT_BUILT':
      return DEFENSE_COPY.craft.wallMissing;
    case 'DEFENSE_STOCK_FULL':
      return DEFENSE_COPY.craft.stockFull;
    case 'DEFENSE_QUEUE_FULL':
      return DEFENSE_COPY.craft.queueFull;
    case 'INSUFFICIENT_RESOURCES':
      return DEFENSE_COPY.craft.insufficient;
    case 'DEFENSE_NOT_CANCELLABLE':
      return DEFENSE_COPY.craft.notCancellable;
    case 'INVALID_PARAMS':
      return DEFENSE_COPY.craft.fallback;
    default:
      return message ?? DEFENSE_COPY.craft.fallback;
  }
}

export function createDefenseActions(deps: DefenseActionsDeps): {
  craftDefense: (kind: DefenseKind, count: number) => Promise<void>;
  cancelDefenseCraft: (craftId: string) => Promise<void>;
} {
  const { clientRef, setDefenseError, appendLocalEvent, scheduleSync } = deps;

  /** 发起打造：成功后按响应补一条本地事件；库存 / 队列由按需查询对齐 */
  const craftDefense = async (kind: DefenseKind, count: number): Promise<void> => {
    const { DEFENSE_COPY } = getCopy();
    const client = clientRef.current;
    if (!client?.connected) {
      setDefenseError(DEFENSE_COPY.craft.offline);
      return;
    }
    setDefenseError(null);
    const label = DEFENSE_COPY.names[kind];
    try {
      const res = await client.request(Op.CRAFT_DEFENSE, { kind, count });
      if (res.ok) {
        const data = res.data as unknown as CraftDefenseResponseData | undefined;
        const craft = field<DefenseCraftView>(res.data, 'craft') ?? data?.craft;
        if (craft) {
          appendLocalEvent(
            'player',
            craft.status === 'queued'
              ? DEFENSE_COPY.event.queued(label, craft.count)
              : DEFENSE_COPY.event.started(label, craft.count, formatClock(craft.dueAt as string)),
          );
        }
        scheduleSync();
      } else {
        setDefenseError(errorText(res.error?.code, res.error?.message));
        // 失败可能附带当前城池状态（库存 / 城墙等级），立即对齐
        scheduleSync();
      }
    } catch (err) {
      setDefenseError(err instanceof Error ? err.message : DEFENSE_COPY.craft.fallback);
    }
  };

  /** 取消打造：条件翻转由服务端守卫；成功后本地事件 + 对齐 */
  const cancelDefenseCraft = async (craftId: string): Promise<void> => {
    const { DEFENSE_COPY } = getCopy();
    const client = clientRef.current;
    if (!client?.connected) {
      setDefenseError(DEFENSE_COPY.craft.offline);
      return;
    }
    setDefenseError(null);
    try {
      const res = await client.request(Op.CANCEL_DEFENSE_CRAFT, { craftId });
      if (res.ok) {
        const craft = field<DefenseCraftView>(res.data, 'craft');
        if (craft) {
          appendLocalEvent('player', DEFENSE_COPY.event.cancelled(DEFENSE_COPY.names[craft.kind], craft.count, ''));
        }
        scheduleSync();
      } else {
        setDefenseError(errorText(res.error?.code, res.error?.message));
        scheduleSync();
      }
    } catch (err) {
      setDefenseError(err instanceof Error ? err.message : DEFENSE_COPY.craft.fallback);
    }
  };

  return { craftDefense, cancelDefenseCraft };
}

/** 推送到本地：目前只用来触发按需查询（队列 / 库存以服务端为准） */
export type { DefenseStatePushData };
