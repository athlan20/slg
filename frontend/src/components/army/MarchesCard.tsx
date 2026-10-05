/** 行军卡（军队页中 / 情报页右）：在外的部队逐条显示——任务与目标 / 编成与将领 / 状态（行军·返程·埋伏中）/ 剩余时间与进度，
 *  可定位到地图、撤回（行军途中的非返程条目）。分页列表，行定高。来自城池状态（GET_STATE 轮询 + 推送对齐）。
 */

import { useState } from 'react';
import { TROOP_KINDS, type MarchView } from '../../api/protocol';
import { formatDurationText } from '../../api/format';
import { COPY, TROOP_LABEL } from '../../copy';
import { ARMY_COPY } from '../../copy-pages';
import { useGame } from '../../state/GameContext';
import { useNav } from '../../state/NavContext';
import { activeMarches } from '../../state/progressItems';
import { useNow } from '../../state/useNow';
import { marchLabel } from '../worldPanelText';
import { Card } from '../ui/Card';
import { PagedList } from '../ui/PagedList';

function compositionText(march: MarchView): string {
  const parts = TROOP_KINDS.filter((kind) => march.troops[kind] > 0).map((kind) => `${TROOP_LABEL[kind].short}${march.troops[kind]}`);
  return parts.join(' ') || '—';
}

export function MarchesCard({ role }: { role: string }) {
  const { session } = useGame();
  const { go } = useNav();
  const { world, city } = session;
  const [recallBusyId, setRecallBusyId] = useState<string | null>(null);
  const marches = city ? activeMarches(city) : [];
  const now = useNow(marches.length > 0);
  const heroes = session.heroSession.state?.heroes ?? [];

  const recall = async (id: string) => {
    if (recallBusyId) {
      return;
    }
    setRecallBusyId(id);
    try {
      await world.recallMarch(id);
    } finally {
      setRecallBusyId(null);
    }
  };

  return (
    <Card role={role} title={ARMY_COPY.marchTitle} meta={ARMY_COPY.marchMeta(marches.length)}>
      {world.error ? (
        <p role="世界地图详情区-错误" className="line-clamp-2 shrink-0 text-[12px] text-warn" title={world.error}>
          {world.error}
        </p>
      ) : null}
      <PagedList
        role={`${role}-列表`}
        items={marches}
        keyOf={(march) => march.id}
        gap={4}
        empty={<p className="py-4 text-center text-[12px] text-faint">{ARMY_COPY.marchEmpty}</p>}
        renderRow={(march) => {
          const total = Math.max(1, Date.parse(march.arriveAt) - Date.parse(march.startedAt));
          const left = Math.max(0, Math.ceil((Date.parse(march.arriveAt) - now) / 1000));
          const pct = Math.min(100, Math.max(0, Math.round(((now - Date.parse(march.startedAt)) / total) * 100)));
          const ambush = march.ambushAt !== null && now >= Date.parse(march.ambushAt);
          const state = march.purpose === 'return' ? ARMY_COPY.marchStateReturn : ambush ? ARMY_COPY.marchStateAmbush : ARMY_COPY.marchStateMarching;
          const hero = march.heroId ? heroes.find((item) => item.id === march.heroId) : undefined;
          const title = marchLabel(march, now);
          return (
            <div role="行军条目" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[5px] border border-line-soft bg-panel-2 px-2 py-1">
              <span className="min-w-0">
                <button
                  type="button"
                  role="世界地图详情区-行军定位"
                  title={`${title}（${ARMY_COPY.marchLocate}）`}
                  onClick={() => {
                    world.centerOn(march.x, march.y);
                    go('map');
                  }}
                  className="block max-w-full cursor-pointer truncate text-left text-[12px] hover:text-accent"
                >
                  {title}
                </button>
                <small className="block truncate text-[11px] text-faint" title={`${compositionText(march)}${hero ? ` · ${hero.name}` : ''}`}>
                  {compositionText(march)}
                  {hero ? ` · ${hero.name}` : ''} · {state}
                </small>
                <span className="mt-0.5 block h-[2px] overflow-hidden rounded bg-line">
                  <i className="block h-full bg-accent" style={{ width: `${pct}%` }} />
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <span className={`font-mono text-[11.5px] tabular-nums ${ambush ? 'text-gold' : 'text-dim'}`} title={COPY.status.remainingSeconds(left)}>
                  {formatDurationText(left)}
                </span>
                {march.status === 'marching' && march.purpose !== 'return' ? (
                  <button
                    type="button"
                    role="世界地图详情区-行军撤回按钮"
                    disabled={recallBusyId === march.id}
                    onClick={() => void recall(march.id)}
                    className="cursor-pointer rounded border border-warn px-1.5 text-[11px] text-warn disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {recallBusyId === march.id ? COPY.worldMap.marchRecallBusy : COPY.worldMap.marchRecallBtn}
                  </button>
                ) : null}
              </span>
            </div>
          );
        }}
      />
    </Card>
  );
}
