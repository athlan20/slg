/** 城墙详情里的城防器械打造面板（v73，AISLG-193）：库存 / 上限、四种器械的件数输入与打造按钮、
 *  打造队列（≤3 条，含倒计时与取消）。数值为前端镜像（成本 / 单件伤害 / 单件时长），权威判定在服务端。
 *  一次下单若干件；库存上限 = 城墙等级 × 60，四种器械共用（在造 + 排队也占额度）。
 */

import { useState } from 'react';
import {
  DEFENSE_INFO,
  DEFENSE_KINDS,
  DEFENSE_STOCK_PER_WALL_LEVEL,
  type CityView,
  type DefenseKind,
} from '../../api/protocol';
import { costParts } from '../../api/mapping';
import { formatDurationText } from '../../api/format';
import { useCopy } from '../../i18n/bundle';
import type { ConnectionStatus } from '../../state/useGameSession';
import { useNow } from '../../state/useNow';

interface DefenseCraftPanelProps {
  city: CityView;
  connection: ConnectionStatus;
  error: string | null;
  onCraft: (kind: DefenseKind, count: number) => void;
  onCancel: (craftId: string) => void;
}

const DEFAULT_COUNT = 10;

export function DefenseCraftPanel({ city, connection, error, onCraft, onCancel }: DefenseCraftPanelProps) {
  const copy = useCopy();
  const { DEFENSE_COPY } = copy;
  const defense = city.defenses;
  const queue = defense.queue;
  const now = useNow(queue.some((item) => item.status === 'crafting'));
  const [counts, setCounts] = useState<Record<DefenseKind, number>>({ trap: DEFAULT_COUNT, chevaux: DEFAULT_COUNT, rolling_log: DEFAULT_COUNT, boulder: DEFAULT_COUNT });
  const pending = queue.reduce((sum, item) => sum + item.count, 0);
  const remaining = Math.max(0, defense.cap - defense.total - pending);
  const queueFull = queue.length >= 3;
  const wallLevel = city.levels.wall ?? 0;
  const capHint = Math.max(0, wallLevel) * DEFENSE_STOCK_PER_WALL_LEVEL;

  return (
    <section role="城防器械面板" className="flex min-h-0 shrink-0 flex-col gap-1 rounded border border-line-soft bg-panel-2/60 px-2 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span role="城防器械面板-标题" className="text-[12.5px] font-semibold text-fg">
          {DEFENSE_COPY.craft.title}
        </span>
        <span role="城防器械面板-库存" className="font-mono text-[11px] text-accent">
          {DEFENSE_COPY.craft.meta(defense.total, defense.cap)}
        </span>
      </div>
      <p role="城防器械面板-说明" className="line-clamp-2 text-[10.5px] leading-tight text-faint" title={DEFENSE_COPY.craft.hint(capHint)}>
        {DEFENSE_COPY.craft.hint(capHint)}
      </p>

      <div role="城防器械面板-器械列表" className="grid grid-cols-2 gap-1">
        {DEFENSE_KINDS.map((kind) => {
          const info = DEFENSE_INFO[kind];
          const stock = defense.stock[kind] ?? 0;
          const count = counts[kind];
          const valid = Number.isInteger(count) && count >= 1 && count <= remaining;
          const totalCost = {
            gold: info.cost.gold * count,
            wood: info.cost.wood * count,
            food: info.cost.food * count,
            stone: info.cost.stone * count,
            iron: info.cost.iron * count,
          };
          const parts = costParts(totalCost, city.resources);
          const lacking = parts.some((part) => part.insufficient);
          const disabled = connection !== 'online' || !valid || queueFull || lacking;
          const reason = remaining <= 0 ? DEFENSE_COPY.craft.stockFull : queueFull ? DEFENSE_COPY.craft.queueFull : lacking ? DEFENSE_COPY.craft.insufficient : null;
          return (
            <div key={kind} role={`城防器械面板-条目-${info.label}`} className="flex min-w-0 flex-col gap-0.5 rounded border border-line-soft px-1.5 py-1">
              <div className="flex items-baseline justify-between gap-1">
                <span className="min-w-0 truncate text-[12px] font-semibold">{DEFENSE_COPY.names[kind]}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-accent">{DEFENSE_COPY.craft.stockTag(stock)}</span>
              </div>
              <p className="truncate text-[10px] text-faint" title={info.effect}>
                {DEFENSE_COPY.craft.damage(info.damage)} · {DEFENSE_COPY.craft.seconds(formatDurationText(info.seconds))}
              </p>
              <div className="flex items-center gap-1">
                <input
                  role={`城防器械面板-件数-${info.label}`}
                  aria-label={DEFENSE_COPY.craft.countAria(DEFENSE_COPY.names[kind])}
                  type="number"
                  min={1}
                  max={Math.max(1, remaining)}
                  value={count}
                  onChange={(event) => setCounts((prev) => ({ ...prev, [kind]: Number(event.target.value) }))}
                  className="w-full min-w-0 rounded border border-line-soft bg-panel px-1 py-0.5 font-mono text-[11px] text-fg outline-none focus:border-accent-dim"
                />
                <button
                  type="button"
                  role={`城防器械面板-打造-${info.label}`}
                  disabled={disabled}
                  title={reason ?? `${parts.map((part) => `${part.label} ${part.value}`).join(' / ')}`}
                  onClick={() => onCraft(kind, count)}
                  className="btn shrink-0 px-1.5 text-[10.5px] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {remaining <= 0 ? DEFENSE_COPY.craft.stockFull : queueFull ? DEFENSE_COPY.craft.queueFull : DEFENSE_COPY.craft.craft}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div role="城防器械面板-队列" className="flex flex-col gap-0.5">
        <span className="text-[10.5px] font-semibold text-faint">{DEFENSE_COPY.craft.queueTitle}</span>
        {queue.length === 0 ? (
          <p role="城防器械面板-队列空" className="text-[10.5px] text-faint">{DEFENSE_COPY.craft.queueEmpty}</p>
        ) : (
          queue.map((item) => {
            const left = item.status === 'crafting' && item.dueAt ? formatDurationText(Math.max(0, Math.ceil((Date.parse(item.dueAt) - now) / 1000))) : null;
            return (
              <div key={item.id} role={`城防器械面板-队列项-${DEFENSE_COPY.names[item.kind]}`} className="flex items-center gap-1 rounded border border-line-soft px-1.5 py-0.5 text-[11px]">
                <span className="min-w-0 flex-1 truncate">{DEFENSE_COPY.craft.queueItem(DEFENSE_COPY.names[item.kind], item.count)}</span>
                <span className="shrink-0 text-faint">{left !== null ? DEFENSE_COPY.craft.crafting(left) : DEFENSE_COPY.craft.queued}</span>
                <button
                  type="button"
                  role="城防器械面板-取消队列项"
                  aria-label={DEFENSE_COPY.craft.cancelAria(DEFENSE_COPY.names[item.kind], item.count)}
                  onClick={() => onCancel(item.id)}
                  className="shrink-0 cursor-pointer rounded border border-warn px-1 text-[10.5px] text-warn"
                >
                  {DEFENSE_COPY.craft.cancel}
                </button>
              </div>
            );
          })
        )}
      </div>

      {error ? (
        <p role="城防器械面板-错误" className="truncate text-[11px] text-warn" title={error}>{error}</p>
      ) : null}
    </section>
  );
}
