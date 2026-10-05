/** 黄巾之乱详情弹窗（v29 AISLG-76，只读详情；入口：地图黄巾浮卡 / 军情摘要）：全服共同清剿的周期事件——
 *  总进度条（已清 x / 共 y）、老巢状态、时限倒计时、我的贡献与名次；下方三个分页列表：营地与老巢（可定位）/ 贡献榜 / 名次奖励。
 *  没有进行中事件时显示下一轮预计起事时刻与上一轮结果。数据来自会话层（GET_YELLOW_TURBAN + 推送重拉）。
 */

import { useState } from 'react';
import { formatClock, formatDurationText } from '../api/format';
import type { YellowTurbanState } from '../api/protocol';
import { useCopy } from '../i18n/bundle';
import { tName } from '../i18n/names';
import { useNav } from '../state/NavContext';
import { useNow } from '../state/useNow';
import type { WorldSession } from '../state/worldSession';
import { Modal } from './ui/Modal';
import { PagedList } from './ui/PagedList';

type Tab = 'camps' | 'top' | 'rewards';

export function YellowTurbanModal({ state, world, onClose }: { state: YellowTurbanState | null; world: WorldSession; onClose: () => void }) {
  const { go } = useNav();
  const { YT_COPY } = useCopy();
  const [tab, setTab] = useState<Tab>('camps');
  const event = state?.event ?? null;
  const active = event?.status === 'active';
  const now = useNow(active);
  const remainingOf = (iso: string) => formatDurationText(Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000)));

  return (
    <Modal role="黄巾之乱弹窗" title={YT_COPY.panel.title} accent="warn" fill onClose={onClose}>
      {state === null ? (
        <p className="py-6 text-center text-[13px] text-faint">{YT_COPY.panel.noEvent}</p>
      ) : !active || !event ? (
        <div role="黄巾之乱-空态" className="flex flex-col gap-1 text-[13px] text-faint">
          <p>{YT_COPY.panel.noEvent}</p>
          {event ? <p>{YT_COPY.panel.lastResult(event.finishReason, event.clearedCamps, event.totalCamps, event.scatteredCamps)}</p> : null}
          {state.nextEventAt ? <p>{YT_COPY.panel.nextAt(formatClock(state.nextEventAt))}</p> : null}
        </div>
      ) : (
        <>
          <div role="黄巾之乱-总进度" className="flex shrink-0 flex-col gap-1">
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="text-warn">{YT_COPY.panel.progress(event.clearedCamps, event.totalCamps)}</span>
              <span className="font-mono text-[12px] text-faint">{YT_COPY.panel.endsIn(remainingOf(event.endsAt))}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded bg-line-soft">
              <div className="h-full bg-warn" style={{ width: `${event.totalCamps > 0 ? Math.min(100, Math.round((event.clearedCamps / event.totalCamps) * 100)) : 0}%` }} />
            </div>
            <p className="truncate text-[12px] text-faint">{event.bossAppearedAt ? YT_COPY.panel.bossAppeared : YT_COPY.panel.bossNeed(event.bossUnlockCount)}</p>
            <p role="黄巾之乱-我的贡献" className="truncate text-[12px] text-dim">
              {state.me ? YT_COPY.panel.me(state.me.killed, state.me.rank) : YT_COPY.panel.meNone}
            </p>
          </div>

          <div className="flex shrink-0 gap-1.5">
            {(
              [
                ['camps', YT_COPY.panel.campsTitle],
                ['top', YT_COPY.panel.topTitle],
                ['rewards', YT_COPY.panel.rewardsTab],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={tab === key}
                onClick={() => setTab(key)}
                className={`cursor-pointer rounded border px-2.5 py-0.5 text-[12.5px] ${tab === key ? 'border-accent bg-accent-soft text-accent' : 'border-line text-dim hover:text-fg'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'camps' ? (
            <div role="黄巾之乱-营地列表" className="flex min-h-0 flex-1 flex-col">
              <PagedList
                role="黄巾之乱-营地-列表"
                items={state.camps}
                keyOf={(camp) => camp.id}
                renderRow={(camp) => (
                  <div role="黄巾之乱-营地条目" className="flex items-center justify-between gap-2 border-b border-line-soft py-1 text-[12.5px]">
                    <span className={`min-w-0 truncate ${camp.tier === 'boss' ? 'text-gold' : 'text-warn'}`}>
                      {YT_COPY.panel.campRow(tName(camp.label), camp.x, camp.y)}
                      <span className="ml-1.5 text-faint">
                        {YT_COPY.panel.strength(camp.garrisonTotal.min, camp.garrisonTotal.max)}
                        {camp.nextGrowAt ? ` · ${YT_COPY.panel.growIn(remainingOf(camp.nextGrowAt))}` : ''}
                        {camp.boss ? ` · ${YT_COPY.panel.bossStage(camp.boss.stage, camp.boss.recoversAt ? remainingOf(camp.boss.recoversAt) : null)}` : ''}
                      </span>
                    </span>
                    <button
                      type="button"
                      role="黄巾之乱-定位"
                      onClick={() => {
                        world.centerOn(camp.x, camp.y);
                        world.selectTile(camp.x, camp.y);
                        go('map');
                        onClose();
                      }}
                      className="btn shrink-0"
                    >
                      {YT_COPY.panel.locate}
                    </button>
                  </div>
                )}
              />
            </div>
          ) : null}
          {tab === 'top' ? (
            <div role="黄巾之乱-贡献榜" className="flex min-h-0 flex-1 flex-col">
              <PagedList
                role="黄巾之乱-贡献榜-列表"
                items={state.top}
                keyOf={(row) => `${row.rank}-${row.username}`}
                renderRow={(row) => <p className="border-b border-line-soft py-1 font-mono text-[12.5px] text-dim">{YT_COPY.panel.topRow(row.rank, row.username, row.killed)}</p>}
              />
            </div>
          ) : null}
          {tab === 'rewards' ? (
            <div role="黄巾之乱-奖励" className="flex min-h-0 flex-1 flex-col">
              <p className="shrink-0 text-[12px] text-faint">{YT_COPY.panel.rewardsTitle}</p>
              <PagedList
                role="黄巾之乱-奖励-列表"
                items={state.rewards}
                keyOf={(tier) => tier.label}
                renderRow={(tier) => <p className="border-b border-line-soft py-1 text-[12.5px] text-dim">{YT_COPY.panel.rewardRow(tName(tier.label), tier.reward.gold, tier.reward.wood)}</p>}
              />
            </div>
          ) : null}
        </>
      )}
    </Modal>
  );
}
