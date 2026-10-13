// 任务与活动的会话切片（v53/v54，AISLG-200）：日常任务 / 签到（一期）+ 主线 / 支线 / 成就 / 活动（二期三期）。
// 从 useGameSession 拆出以控制单文件行数。奖励发往主城，领取成功后用响应里的 city 对齐城池资源。
// 无推送：打开养成页时各拉一次，领奖 / 签到 / 领取后由响应回带最新状态。

import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../api/client';
import { Op, type CityView } from '../api/protocol';
import { getCopy } from '../i18n/bundle';
import type { ClaimDailyResponseData, GetDailyResponseData, QuestStateView, SigninResponseData } from '../api/protocol-quest';
import type {
  ActivityView,
  ClaimActivityResponseData,
  ClaimQuestResponseData,
  GetActivitiesResponseData,
  GetQuestsResponseData,
  QuestsView,
} from '../api/protocol-quests';

interface QuestSessionDeps {
  clientRef: { current: ApiClient | null };
  connected: boolean;
  setCity: (updater: (prev: CityView | null) => CityView | null) => void;
}

export interface QuestSession {
  /** 日常任务 + 签到状态（null = 尚未拉取） */
  quest: QuestStateView | null;
  /** 主线 / 支线 / 成就（null = 尚未拉取） */
  quests: QuestsView | null;
  /** 活动（null = 尚未拉取） */
  activities: ActivityView[] | null;
  busy: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  claimDaily: (taskId: string) => Promise<boolean>;
  signin: () => Promise<boolean>;
  claimQuest: (kind: 'main' | 'side' | 'achv', id: string) => Promise<boolean>;
  claimActivity: (id: string) => Promise<boolean>;
  clear: () => void;
}

export function useQuestSession(deps: QuestSessionDeps): QuestSession {
  const { clientRef, connected, setCity } = deps;
  const [quest, setQuest] = useState<QuestStateView | null>(null);
  const [quests, setQuests] = useState<QuestsView | null>(null);
  const [activities, setActivities] = useState<ActivityView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client?.connected) {
      return;
    }
    try {
      const d = await client.request(Op.GET_DAILY, {});
      if (d.ok && d.data) {
        const data = d.data as unknown as GetDailyResponseData;
        if (data.quest) {
          setQuest(data.quest);
        }
      }
      const q = await client.request(Op.GET_QUESTS, {});
      if (q.ok && q.data) {
        const data = q.data as unknown as GetQuestsResponseData;
        setQuests({ main: data.main, side: data.side, achievements: data.achievements });
      }
      const a = await client.request(Op.GET_ACTIVITIES, {});
      if (a.ok && a.data) {
        const data = a.data as unknown as GetActivitiesResponseData;
        setActivities(data.activities);
      }
    } catch {
      // 拉取失败保留旧值，下次打开页面 / 重连再试
    }
  }, [clientRef]);

  useEffect(() => {
    if (connected) {
      void refresh();
    }
  }, [connected, refresh]);

  const claimDaily = useCallback(
    async (taskId: string): Promise<boolean> => {
      const client = clientRef.current;
      if (!client?.connected || busy) {
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await client.request(Op.CLAIM_DAILY, { taskId });
        if (res.ok && res.data) {
          const data = res.data as unknown as ClaimDailyResponseData;
          if (data.quest) {
            setQuest(data.quest);
          }
          if (data.city) {
            setCity(() => data.city);
          }
          await refresh();
          return true;
        }
        setError(res.error?.code === 'INVALID_PARAMS' ? getCopy().QUEST_COPY.errors.daily : getCopy().QUEST_COPY.errors.claim);
        return false;
      } catch {
        setError(getCopy().QUEST_COPY.errors.net);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [clientRef, busy, setCity, refresh],
  );

  const signin = useCallback(async (): Promise<boolean> => {
    const client = clientRef.current;
    if (!client?.connected || busy) {
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await client.request(Op.SIGNIN, {});
      if (res.ok && res.data) {
        const data = res.data as unknown as SigninResponseData;
        if (data.signin) {
          setQuest((prev) => (prev ? { ...prev, signin: data.signin } : prev));
        }
        if (data.city) {
          setCity(() => data.city);
        }
        await refresh();
        return true;
      }
      setError(res.error?.code === 'INVALID_PARAMS' ? getCopy().QUEST_COPY.errors.signin : getCopy().QUEST_COPY.errors.claim);
      return false;
    } catch {
      setError(getCopy().QUEST_COPY.errors.net);
      return false;
    } finally {
      setBusy(false);
    }
  }, [clientRef, busy, setCity, refresh]);

  const claimQuest = useCallback(
    async (kind: 'main' | 'side' | 'achv', id: string): Promise<boolean> => {
      const client = clientRef.current;
      if (!client?.connected || busy) {
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await client.request(Op.CLAIM_QUEST, { kind, id });
        if (res.ok && res.data) {
          const data = res.data as unknown as ClaimQuestResponseData;
          if (data.quests) {
            setQuests(data.quests);
          }
          if (data.city) {
            setCity(() => data.city);
          }
          return true;
        }
        setError(res.error?.code === 'INVALID_PARAMS' ? getCopy().QUEST_COPY.errors.quest : getCopy().QUEST_COPY.errors.claim);
        return false;
      } catch {
        setError(getCopy().QUEST_COPY.errors.net);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [clientRef, busy, setCity],
  );

  const claimActivity = useCallback(
    async (id: string): Promise<boolean> => {
      const client = clientRef.current;
      if (!client?.connected || busy) {
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await client.request(Op.CLAIM_ACTIVITY, { id });
        if (res.ok && res.data) {
          const data = res.data as unknown as ClaimActivityResponseData;
          if (data.activities) {
            setActivities(data.activities);
          }
          if (data.city) {
            setCity(() => data.city);
          }
          return true;
        }
        setError(res.error?.code === 'INVALID_PARAMS' ? getCopy().QUEST_COPY.errors.quest : getCopy().QUEST_COPY.errors.claim);
        return false;
      } catch {
        setError(getCopy().QUEST_COPY.errors.net);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [clientRef, busy, setCity],
  );

  const clear = useCallback((): void => {
    setQuest(null);
    setQuests(null);
    setActivities(null);
    setError(null);
    setBusy(false);
  }, []);

  return { quest, quests, activities, busy, error, refresh, claimDaily, signin, claimQuest, claimActivity, clear };
}
