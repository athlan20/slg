/** 征兵卡（军队页左）：兵种表（兵种 + 克制标签 / 城内 / 在外 / 招募数量，未解锁的置灰并写解锁条件）、
 *  消耗 / 耗时 / 新增粮耗、招募按钮、征兵队列（≤3 条，含发起者标签与取消）。
 *  同一时间只招募一种：在某行输入数量即选中该行（其他行清空）。表单用镜像的 TROOP_INFO 预填消耗与禁用不可征兵种，权威判定在服务端。
 */

import { useState } from 'react';
import { RECRUIT_COUNT_MAX, RECRUIT_QUEUE_CAPACITY, TROOP_INFO, TROOP_KINDS, type CityView, type Resources, type TroopKind } from '../api/protocol';
import { costParts } from '../api/mapping';
import { COPY, IDENTITY_LABEL, TROOP_LABEL } from '../copy';
import { DEFENSE_COPY } from '../copy-defense';
import { ARMY_COPY } from '../copy-pages';
import { activeMarches } from '../state/progressItems';
import type { ConnectionStatus } from '../state/useGameSession';
import { useNow } from '../state/useNow';
import { Card } from './ui/Card';

interface RecruitPanelProps {
  city: CityView | null;
  connection: ConnectionStatus;
  recruitError: string | null;
  onStartRecruit: (troop: TroopKind, count: number) => void;
  onCancelRecruit: (recruitId: string) => void;
}

export function RecruitPanel({ city, connection, recruitError, onStartRecruit, onCancelRecruit }: RecruitPanelProps) {
  const [troop, setTroop] = useState<TroopKind | null>(null);
  const [count, setCount] = useState(0);
  const queue = city?.recruitQueue ?? [];
  const now = useNow(queue.some((item) => item.status === 'recruiting'));
  const barracks = city?.levels.barracks ?? 0;
  const queueFull = queue.length >= 1 + RECRUIT_QUEUE_CAPACITY;

  // 在外兵力：行军中（含返程）的编队，按兵种汇总
  const out: Partial<Record<TroopKind, number>> = {};
  for (const march of city ? activeMarches(city) : []) {
    for (const kind of TROOP_KINDS) {
      out[kind] = (out[kind] ?? 0) + (march.troops[kind] ?? 0);
    }
  }

  const info = troop ? TROOP_INFO[troop] : null;
  const validCount = Number.isInteger(count) && count >= 1 && count <= RECRUIT_COUNT_MAX;
  const locked = info !== null && barracks < info.barracksLevel;
  const totalCost: Resources | null = info
    ? { gold: info.cost.gold * count, wood: info.cost.wood * count, food: info.cost.food * count, stone: info.cost.stone * count, iron: info.cost.iron * count }
    : null;
  const popCost = info ? info.population * count : 0;
  const popShort = city !== null && city.population.current < popCost;
  const submitDisabled = connection !== 'online' || city === null || troop === null || barracks === 0 || locked || queueFull || !validCount;
  const hint = city === null ? null : barracks === 0 ? COPY.recruitPanel.hintNoBarracks : queueFull ? COPY.recruitPanel.hintQueueFull : null;

  return (
    <Card
      role="征兵面板"
      title={ARMY_COPY.recruitTitle}
      meta={<span role="征兵面板-守城加成">{city ? `${ARMY_COPY.recruitMeta(barracks, Math.max(0, city.population.cap - city.population.current))} · ${COPY.recruitPanel.defenseMeta(city.defenseBonus)}` : ''}</span>}
    >
      <div role="征兵面板-兵种表" className="flex min-h-0 flex-1 flex-col gap-px overflow-hidden">
        <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_2.6rem_2.2rem_3.6rem] gap-1.5 px-1.5 text-[10.5px] text-faint">
          <span>{ARMY_COPY.colTroop}</span>
          <span className="text-right">{ARMY_COPY.colHome}</span>
          <span className="text-right">{ARMY_COPY.colOut}</span>
          <span className="text-right">{ARMY_COPY.colCount}</span>
        </div>
        {TROOP_KINDS.map((kind) => {
          const need = TROOP_INFO[kind].barracksLevel;
          const isLocked = barracks < need;
          return (
            <div
              key={kind}
              role={`征兵面板-驻军-${TROOP_LABEL[kind].short}`}
              title={DEFENSE_COPY.troopNote[kind]}
              className={`grid max-h-9 min-h-0 flex-1 grid-cols-[minmax(0,1fr)_2.6rem_2.2rem_3.6rem] items-center gap-1.5 rounded px-1.5 text-[12px] even:bg-panel-2 ${isLocked ? 'opacity-45' : ''}`}
            >
              <span className="truncate">
                {TROOP_LABEL[kind].name}
                <span className="ml-1 text-[10px] text-faint">{ARMY_COPY.tag[kind]}</span>
              </span>
              <span className={`text-right font-mono tabular-nums ${(city?.army[kind] ?? 0) > 0 ? '' : 'text-faint'}`}>{city?.army[kind] ?? 0}</span>
              <span className="text-right font-mono tabular-nums text-faint">{out[kind] ?? 0}</span>
              {isLocked ? (
                <span className="truncate text-right text-[10px] text-faint" title={COPY.recruitPanel.hintNeedBarracks(need)}>
                  {ARMY_COPY.locked(need)}
                </span>
              ) : (
                <input
                  role={`征兵面板-数量-${TROOP_LABEL[kind].short}`}
                  type="number"
                  min={1}
                  max={RECRUIT_COUNT_MAX}
                  placeholder="0"
                  value={troop === kind && count > 0 ? count : ''}
                  onChange={(event) => {
                    setTroop(kind);
                    setCount(Math.floor(Number(event.target.value)));
                  }}
                  className="w-full rounded border border-line bg-bg px-1 py-px text-right font-mono text-[12px] outline-none focus:border-accent-dim"
                />
              )}
            </div>
          );
        })}
      </div>

      <p role="征兵面板-消耗" className="line-clamp-2 shrink-0 font-mono text-[11.5px] text-dim" title={hint ?? undefined}>
        {city && totalCost && info && validCount ? (
          <>
            <span className="text-faint">{COPY.recruitPanel.costLabel} </span>
            {costParts(totalCost, city.resources).map((part, index) => (
              <span key={part.label} className={part.insufficient ? 'text-accent' : undefined}>
                {index > 0 ? ' · ' : ''}
                {part.label} {part.value}
                {part.insufficient ? COPY.recruitPanel.insufficient : ''}
              </span>
            ))}
            {' · '}
            <span className={popShort ? 'text-accent' : undefined}>
              {COPY.recruitPanel.populationCost(popCost)}
              {popShort ? COPY.recruitPanel.insufficient : ''}
            </span>
            {' · '}
            {COPY.recruitPanel.durationLine(info.unitSeconds * count)} · {COPY.recruitPanel.foodUseLine(info.foodUse * count)}
          </>
        ) : (
          <span className="font-sans text-faint">{hint ?? COPY.recruitPanel.formTitle}</span>
        )}
      </p>
      <button
        type="button"
        role="征兵面板-提交"
        className="btn shrink-0 py-1.5 text-[13px] font-semibold"
        disabled={submitDisabled}
        onClick={() => troop && onStartRecruit(troop, count)}
      >
        {ARMY_COPY.submit}
        {troop && validCount ? ` ${TROOP_LABEL[troop].name} ×${count}` : ''}
      </button>

      <div role="征兵面板-队列" className="flex shrink-0 flex-col gap-1">
        <p className="text-[11.5px] text-faint">
          {ARMY_COPY.queueTitle}
          {queue.length === 0 ? ` · ${COPY.recruitPanel.queueIdle}` : ''}
        </p>
        {queue.map((item, index) => {
          const label = TROOP_LABEL[item.troop];
          const active = item.status === 'recruiting';
          const totalMs = active && item.dueAt ? Date.parse(item.dueAt) - Date.parse(item.startedAt) : 0;
          const remaining = active && item.dueAt ? Math.max(0, Math.ceil((Date.parse(item.dueAt) - now) / 1000)) : 0;
          const progress = active && totalMs > 0 ? Math.min(100, Math.round(((now - Date.parse(item.startedAt)) / totalMs) * 100)) : 0;
          return (
            <div
              key={item.id}
              role={`征兵面板-条目-${label.short}`}
              className={`flex flex-col gap-0.5 rounded border px-2 py-1 ${active ? 'border-accent-dim bg-accent-soft' : 'border-line-soft bg-panel-2'}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[12px]">
                  <span className={`mr-1.5 font-mono text-[11px] ${active ? 'text-accent' : 'text-faint'}`}>{active ? COPY.recruitPanel.active : COPY.recruitPanel.queuedAt(index)}</span>
                  {label.name} <span className="font-mono text-[11px] text-dim">×{item.count}</span>
                  <span className={`tag ml-1.5 ${item.initiator === 'player' ? 'actor-player' : ''}`}>{IDENTITY_LABEL[item.initiator]}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className={`font-mono text-[11px] ${active ? 'text-accent' : 'text-faint'}`}>
                    {active ? (item.dueAt ? (remaining > 0 ? COPY.recruitPanel.remainingSeconds(remaining) : COPY.recruitPanel.waitingSettle) : COPY.recruitPanel.activating) : COPY.recruitPanel.waitingStart}
                  </span>
                  {active ? null : (
                    <button
                      type="button"
                      role={`征兵面板-取消-${label.short}`}
                      title={COPY.recruitPanel.cancelTitle}
                      aria-label={`${COPY.recruitPanel.cancel}${label.name}`}
                      className="grid h-4 w-4 place-items-center rounded border border-line-soft bg-panel text-[11px] leading-none text-faint hover:border-accent-dim hover:text-accent"
                      onClick={() => onCancelRecruit(item.id)}
                    >
                      ✕
                    </button>
                  )}
                </span>
              </div>
              {active ? (
                <div className="bar h-[3px]">
                  <i style={{ width: `${progress}%` }} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {recruitError ? (
        <p role="征兵面板-错误" className="shrink-0 truncate rounded border border-line-soft bg-panel-2 px-2 py-1 text-[12px] text-dim" title={recruitError}>
          {recruitError}
        </p>
      ) : null}
    </Card>
  );
}
