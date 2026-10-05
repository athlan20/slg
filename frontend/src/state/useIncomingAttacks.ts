// NPC 来袭记录（AISLG-66 的预警弹窗确认后会从待确认队列里移除，但袭击在到达之前一直有效）：
// 顶栏警报胶囊和总览军情摘要需要「还没到达的来袭」，所以单独记一份，到达时刻一过就剔除。

import { useEffect, useState } from 'react';
import type { NpcAttackWarningPushData } from '../api/protocol';
import { useNow } from './useNow';

export function useIncomingAttacks(warnings: NpcAttackWarningPushData[], resetKey: string | null): NpcAttackWarningPushData[] {
  const [seen, setSeen] = useState<NpcAttackWarningPushData[]>([]);

  // 换账号 / 登出：清空
  useEffect(() => {
    setSeen([]);
  }, [resetKey]);

  // 新到的预警并入记录（按 attackId 去重，同一条后到的覆盖旧的——烽火台精度可能随时间更新）
  useEffect(() => {
    if (warnings.length === 0) {
      return;
    }
    setSeen((prev) => {
      const map = new Map(prev.map((item) => [item.attackId, item]));
      for (const warning of warnings) {
        map.set(warning.attackId, warning);
      }
      return [...map.values()];
    });
  }, [warnings]);

  const now = useNow(seen.length > 0);
  return seen.filter((item) => Date.parse(item.arriveAt) > now).sort((a, b) => Date.parse(a.arriveAt) - Date.parse(b.arriveAt));
}
