// 征兵动作（RECRUIT / CANCEL_RECRUIT，v11）：与建造动作同形态——直接结果乐观更新 +
// 本地事件 + 防抖按需查询对齐权威状态；失败附状态刷新（服务端拒绝时回传当前城池状态）。
// 从 useGameSession 拆出以控制单文件行数；依赖由会话钩子注入。

import { ApiClient } from '../api/client';
import {
  Op,
  type CityView,
  type RecruitView,
  type TroopKind,
} from '../api/protocol';
import { formatClock, recruitErrorText } from '../api/mapping';
import { COPY, TROOP_LABEL } from '../copy';
import type { Actor } from '../types';
import { applyCancelRecruitResult, applyRecruitResult } from './cityUpdates';

export interface RecruitActionsDeps {
  clientRef: { current: ApiClient | null };
  setCity: (updater: (prev: CityView | null) => CityView | null) => void;
  setRecruitError: (message: string | null) => void;
  appendLocalEvent: (actor: Actor, text: string) => void;
  scheduleSync: () => void;
}

function field<T>(data: Record<string, unknown> | undefined, key: string): T | undefined {
  return (data?.[key] as T | undefined) ?? undefined;
}

export function createRecruitActions(deps: RecruitActionsDeps): {
  startRecruit: (troop: TroopKind, count: number) => Promise<void>;
  cancelRecruit: (recruitId: string) => Promise<void>;
} {
  const { clientRef, setCity, setRecruitError, appendLocalEvent, scheduleSync } = deps;

  /** 发起征兵：成功乐观更新队列；失败展示人读错误并对齐响应附带的状态 */
  const startRecruit = async (troop: TroopKind, count: number): Promise<void> => {
    const client = clientRef.current;
    if (!client?.connected) {
      return;
    }
    setRecruitError(null);
    const name = TROOP_LABEL[troop].name;
    try {
      const res = await client.request(Op.RECRUIT, { troop, count });
      if (res.ok) {
        const recruit = field<RecruitView>(res.data, 'recruit');
        if (recruit) {
          setCity((prev) => (prev ? applyRecruitResult(prev, recruit) : prev));
          appendLocalEvent(
            'player',
            recruit.status === 'queued'
              ? COPY.session.recruitQueued(name, count)
              : COPY.session.recruitStarted(name, count, formatClock(recruit.dueAt as string)),
          );
        }
        // recruit_started / recruit_queued 推送只发给同账号其他连接，发起方拿不到；
        // 服务端已扣资源与人口，防抖走一轮按需查询对齐
        scheduleSync();
      } else {
        setRecruitError(recruitErrorText(res.error?.code, res.error?.message, res.data));
        const cityNow = field<CityView>(res.data, 'city');
        if (cityNow) {
          setCity(() => cityNow);
        }
        appendLocalEvent('player', COPY.session.recruitRejected(res.error?.message ?? '失败'));
      }
    } catch (err) {
      setRecruitError(err instanceof Error ? err.message : COPY.session.recruitFailedFallback);
    }
  };

  /** 取消排队条目：直接结果乐观移出队列，返还的资源与人口随防抖查询对齐 */
  const cancelRecruit = async (recruitId: string): Promise<void> => {
    const client = clientRef.current;
    if (!client?.connected) {
      return;
    }
    setRecruitError(null);
    try {
      const res = await client.request(Op.CANCEL_RECRUIT, { recruitId });
      if (res.ok) {
        const recruit = field<RecruitView>(res.data, 'recruit');
        if (recruit) {
          setCity((prev) => (prev ? applyCancelRecruitResult(prev, recruit) : prev));
          appendLocalEvent('player', COPY.session.recruitCancelled(TROOP_LABEL[recruit.troop].name, recruit.count));
        }
        scheduleSync();
      } else {
        setRecruitError(recruitErrorText(res.error?.code, res.error?.message));
        appendLocalEvent('player', COPY.session.cancelRecruitRejected(res.error?.message ?? '失败'));
        // 取消被拒说明本地队列可能已过时被改动（如条目已被激活），立即对齐
        scheduleSync();
      }
    } catch (err) {
      setRecruitError(err instanceof Error ? err.message : COPY.session.cancelRecruitFailedFallback);
    }
  };

  return { startRecruit, cancelRecruit };
}
