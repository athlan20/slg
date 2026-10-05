/** 编队选择（出征 / 增援 / 调兵 / 运输 / 截击共用）：两列兵种输入（兵种名 · 城内数量 · 数量框，点城内数量 = 全部）、
 *  「全军」「清空」、随队将领、编队战力 / 负重 / 到达时间预览、战力不及守军的提示。城内无兵时明确说明原因。
 *  确认按钮在各表单自己的底部（ConfirmButton），这里不含。
 */

import { TROOP_KINDS, TROOP_POWER, armyCarryCapacity, type ArmyCounts, type TroopKind } from '../../../api/protocol';
import { formatDurationText } from '../../../api/mapping';
import { useCopy } from '../../../i18n/bundle';
import { HeroPicker } from '../../HeroPicker';
import type { TroopInput } from './targetTypes';

export function troopTotal(value: TroopInput): number {
  return TROOP_KINDS.reduce((sum, kind) => sum + (value[kind] ?? 0), 0);
}

interface TroopPickerProps {
  army: ArmyCounts;
  value: TroopInput;
  onChange: (value: TroopInput) => void;
  /** 显示编队负重（掠夺 / 运输时有意义） */
  showCarry?: boolean;
  /** 目标原住守军战力（>0 时与编队战力对比提示） */
  enemyPower?: number;
  /** 行军时长预估（秒，AISLG-72）：未提供 / 未编队时不显示 */
  etaSeconds?: number | null;
  /** 负重科技加成百分数（v27 AISLG-77） */
  carryBonusPercent?: number;
  /** 不显示「随队将领」选择器（调兵 / 增援不带将） */
  hideHero?: boolean;
}

export function TroopPicker({ army, value, onChange, showCarry = false, enemyPower = 0, etaSeconds = null, carryBonusPercent = 0, hideHero = false }: TroopPickerProps) {
  const copy = useCopy();
  const { COPY, TROOP_LABEL } = copy;
  const kinds = TROOP_KINDS.filter((kind) => (army[kind] ?? 0) > 0);
  const total = troopTotal(value);
  const power = TROOP_KINDS.reduce((sum, kind) => sum + (value[kind] ?? 0) * TROOP_POWER[kind], 0);
  const carry = armyCarryCapacity(value, carryBonusPercent);

  const setKind = (kind: TroopKind, raw: number) => {
    const max = army[kind] ?? 0;
    const next = Number.isFinite(raw) ? Math.min(Math.max(0, Math.floor(raw)), max) : 0;
    onChange({ ...value, [kind]: next });
  };

  if (kinds.length === 0) {
    return (
      <p role="派兵编队-无部队" className="rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-[12px] text-warn">
        {COPY.worldMap.attackNoArmy}
      </p>
    );
  }

  const weaker = enemyPower > 0 && total > 0 && power < enemyPower;
  const preview = [
    COPY.worldMap.troopTotalLine(total),
    COPY.worldMap.attackPowerLine(power),
    showCarry ? COPY.worldMap.taskCarryLine(carry) : null,
    etaSeconds !== null ? COPY.worldMap.etaLine(formatDurationText(etaSeconds)) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div role="派兵编队" className="flex min-h-0 flex-col gap-1.5">
      <div role="派兵编队-快捷" className="flex items-center justify-between text-[11.5px]">
        <span className="text-faint">{COPY.worldMap.troopPickTitle}</span>
        <span className="flex gap-1">
          <button
            type="button"
            role="派兵编队-全军按钮"
            onClick={() => onChange(Object.fromEntries(kinds.map((kind) => [kind, army[kind]])))}
            className="cursor-pointer rounded border border-line px-1.5 text-dim hover:border-accent-dim hover:text-fg"
          >
            {COPY.worldMap.troopAll}
          </button>
          <button
            type="button"
            role="派兵编队-清空按钮"
            onClick={() => onChange({})}
            className="cursor-pointer rounded border border-line px-1.5 text-dim hover:border-accent-dim hover:text-fg"
          >
            {COPY.worldMap.troopClear}
          </button>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-2.5 gap-y-1">
        {kinds.map((kind) => (
          <label
            key={kind}
            role="派兵编队-兵种行"
            title={COPY.worldMap.attackTroopLabel(TROOP_LABEL[kind].name, army[kind])}
            className="grid grid-cols-[minmax(0,1fr)_auto_3.4rem] items-center gap-1 text-[11.5px]"
          >
            <span className="truncate text-dim">{TROOP_LABEL[kind].name}</span>
            <button
              type="button"
              role="派兵编队-兵种全部按钮"
              title={COPY.worldMap.troopMax}
              onClick={() => setKind(kind, army[kind])}
              className="cursor-pointer font-mono tabular-nums text-faint hover:text-accent"
            >
              {army[kind]}
            </button>
            <input
              role="世界地图详情区-出征数量输入"
              type="number"
              min={0}
              max={army[kind]}
              placeholder="0"
              value={value[kind] ? value[kind] : ''}
              onChange={(event) => setKind(kind, Number(event.target.value))}
              className="w-full rounded border border-line bg-bg px-1 py-0.5 text-right font-mono text-[12px] text-fg outline-none placeholder:text-faint focus:border-accent-dim"
            />
          </label>
        ))}
      </div>

      {hideHero ? null : <HeroPicker troopTotal={total} />}

      <p role="派兵编队-预览" title={preview} className="line-clamp-2 text-[11.5px] text-faint">
        {preview}
      </p>
      {weaker ? (
        <p role="派兵编队-战力提示" className="truncate text-[11.5px] text-warn" title={COPY.worldMap.troopWeaker(power, enemyPower)}>
          {COPY.worldMap.troopWeaker(power, enemyPower)}
        </p>
      ) : null}
    </div>
  );
}
