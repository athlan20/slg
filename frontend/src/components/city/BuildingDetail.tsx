/** 城池页右侧的建筑详情（取代原建筑详情弹窗）：名字 / 等级 / 效果 / 升级消耗与耗时 / 升级后效果 / 连升目标 /
 *  队列状态提示 / 建造或升级按钮。就地发起：不再弹窗，点完按钮详情保持原位，队列在下方实时更新。
 *  与服务端排队规则一致：1 条在建 + 最多 2 条排队，队满禁用；每种建筑同城唯一，在队中不可重复发起。
 */

import { useState } from 'react';
import { BUILD_QUEUE_CAPACITY, BUILDING_LEVEL_MAX, type BuildingKind, type CityView, type Resources } from '../../api/protocol';
import { upgradeChainPreview } from '../../api/chainPlan';
import { buildingEffectText, costParts, formatDurationText } from '../../api/mapping';
import { BUILDING_DESC, BUILDING_LABEL, COPY, buildActionText } from '../../copy';
import type { ConnectionStatus } from '../../state/useGameSession';

interface BuildingDetailProps {
  city: CityView;
  kind: BuildingKind;
  connection: ConnectionStatus;
  onClose: () => void;
  onStartBuild: (kind: BuildingKind) => void;
  /** toLevel（当前+2..MAX）为连续升级目标（v22，AISLG-68）；缺省升到下一等级 */
  onStartUpgrade: (kind: BuildingKind, toLevel?: number) => void;
}

export function BuildingDetail({ city, kind, connection, onClose, onStartBuild, onStartUpgrade }: BuildingDetailProps) {
  // 连升目标等级（AISLG-68）：null = 单级（当前+1）；换建筑时由父级 key 复位
  const [targetLevel, setTargetLevel] = useState<number | null>(null);
  const label = BUILDING_LABEL[kind];
  const level = city.levels[kind] ?? 0;
  const entry = city.queue.find((item) => item.kind === kind);
  const queueFull = city.queue.length >= 1 + BUILD_QUEUE_CAPACITY;

  // 当前动作（未建=建造 / 已建=升级）的消耗：由服务端随 GET_STATE 下发（v6 city.costs），前端不自行计算数值
  const upgradeCost = city.costs?.[kind]?.upgrade ?? null;
  const actionCost = (level > 0 ? upgradeCost : city.costs?.[kind]?.build) ?? null;
  // 单级动作时长（v25 AISLG-71）：服务端已按当前 timeScale 折算；连升整链时长由 chainPlan 本地预估
  const actionSeconds = (level > 0 ? city.costs?.[kind]?.upgradeSeconds : city.costs?.[kind]?.buildSeconds) ?? null;
  const canChain = level > 0 && level < BUILDING_LEVEL_MAX && entry == null;
  const selectableTarget = canChain ? Math.min(Math.max(targetLevel ?? level + 1, level + 1), BUILDING_LEVEL_MAX) : level + 1;
  const chain =
    canChain && selectableTarget >= level + 2 && upgradeCost !== null
      ? upgradeChainPreview({ currentLevel: level, toLevel: selectableTarget, nextCost: upgradeCost, timeScale: city.timeScale })
      : null;
  // 展示用消耗：连升时为整链预估总成本，单级 / 建造为服务端下发的下一步成本
  const displayCost: Resources | null = chain ? chain.totalCost : actionCost;
  const disabled = connection !== 'online' || queueFull || level >= BUILDING_LEVEL_MAX || entry != null;

  const hint =
    level >= BUILDING_LEVEL_MAX
      ? COPY.buildingModal.hintLevelMax(BUILDING_LEVEL_MAX)
      : entry
        ? COPY.buildingModal.hintInQueue
        : queueFull
          ? COPY.buildingModal.hintQueueFull
          : chain
            ? COPY.buildingModal.hintChain
            : level > 0
              ? COPY.buildingModal.hintUpgradeCost
              : COPY.buildingModal.hintEnqueue;

  return (
    <div role="城池页-建筑详情" className="flex min-h-0 flex-col gap-2">
      <div role="城池页-建筑详情-标题" className="flex items-baseline gap-2">
        <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold">
          {label.name}
          <span className="ml-1.5 font-mono text-[11.5px] font-normal text-faint">{level > 0 ? COPY.cityMap.levelNow(level) : COPY.cityMap.notBuilt}</span>
        </h3>
        <button
          type="button"
          role="城池页-建筑详情-关闭按钮"
          aria-label={COPY.buildingModal.closeAria}
          className="px-1 text-sm text-faint transition-colors hover:text-accent"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <p role="城池页-建筑详情-说明" className="line-clamp-2 text-[12px] leading-snug text-dim" title={BUILDING_DESC[kind]}>
        {BUILDING_DESC[kind]}
      </p>

      <div role="城池页-建筑详情-数据" className="grid grid-cols-2 gap-1 font-mono text-[11.5px] text-dim">
        <span className="truncate rounded border border-line-soft bg-panel-2 px-2 py-1">
          {COPY.buildingModal.levelLabel} {level > 0 ? COPY.cityMap.levelNow(level) : COPY.cityMap.notBuilt}
        </span>
        <span className="truncate rounded border border-line-soft bg-panel-2 px-2 py-1" title={buildingEffectText(kind, city)}>
          {buildingEffectText(kind, city)}
        </span>
      </div>

      {displayCost ? (
        <div role="城池页-建筑详情-消耗" className="font-mono text-[12px] leading-snug text-dim">
          <span className="text-faint">{chain ? COPY.buildingModal.costChainLabel(chain.levels) : COPY.buildingModal.costLabel} </span>
          {costParts(displayCost, city.resources).map((part, index) => (
            <span key={part.label} className={part.insufficient ? 'text-accent' : undefined}>
              {index > 0 ? ' · ' : ''}
              {part.label} {part.value}
              {part.insufficient ? COPY.buildingModal.insufficient : ''}
            </span>
          ))}
          {chain ? (
            <span className="ml-1.5 text-faint">{COPY.buildingModal.durationLine(formatDurationText(chain.totalSeconds))}</span>
          ) : actionSeconds !== null ? (
            <span className="ml-1.5 text-faint">{COPY.buildingModal.durationAction(formatDurationText(actionSeconds))}</span>
          ) : null}
        </div>
      ) : null}

      {/* 连升目标选择（AISLG-68）：已建未满级且不在队列时可选 L+2..MAX */}
      {canChain ? (
        <label role="城池页-建筑详情-连升目标" className="flex items-center justify-between font-mono text-[12px] text-dim">
          <span className="text-faint">{COPY.buildingModal.targetLabel}</span>
          <select
            role="城池页-建筑详情-目标等级选择"
            value={selectableTarget}
            onChange={(event) => setTargetLevel(Number(event.target.value))}
            className="cursor-pointer rounded border border-line-soft bg-panel-2 px-1.5 py-0.5 text-[12px] text-fg outline-none focus:border-accent-dim"
          >
            {Array.from({ length: BUILDING_LEVEL_MAX - level }, (_, index) => level + 1 + index).map((lv) => (
              <option key={lv} value={lv}>
                {COPY.buildingModal.targetOption(lv, lv === level + 1)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <p role="城池页-建筑详情-队列状态" className={`truncate font-mono text-[12px] ${entry ? 'text-accent' : 'text-faint'}`}>
        {COPY.buildingModal.queueLabel}
        {entry ? (entry.status === 'building' ? COPY.buildingModal.queueActive : COPY.buildingModal.queueQueued) : COPY.buildingModal.queueNotIn}
        {entry ? `（${buildActionText(entry.level)}）` : ''}
      </p>

      <div role="城池页-建筑详情-操作" className="flex items-center justify-between gap-2">
        <span className="line-clamp-2 min-w-0 flex-1 text-[11.5px] text-faint" title={hint}>
          {hint}
        </span>
        <button
          type="button"
          className="btn shrink-0 px-3 py-1.5 text-[12.5px]"
          role="城池页-建筑详情-建造按钮"
          disabled={disabled}
          onClick={() => (level > 0 ? onStartUpgrade(kind, chain ? selectableTarget : undefined) : onStartBuild(kind))}
        >
          {level > 0 ? (chain ? COPY.buildingModal.submitChain(selectableTarget) : buildActionText(level + 1)) : COPY.buildingModal.submitBuild(label.name)}
        </button>
      </div>
    </div>
  );
}
