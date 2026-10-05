/** 运输表单（v26 AISLG-79）：目标为本账号另一座城时，选运输队编成并填五种资源的运送数量（两列），
 *  实时显示「已用负重 / 总负重」；货物超负重或出发城资源不够时直接提示并禁用提交（服务端仍是权威判定）。
 */

import { useState } from 'react';
import { armyCarryCapacity, type Resources } from '../../../api/protocol';
import { carryBonusPercent, marchBonusPercent, marchTravelSeconds } from '../../../api/marchPlan';
import { useCopy } from '../../../i18n/bundle';
import { useDeployBlockedText } from '../../../state/deployContext';
import { ConfirmButton } from './ConfirmButton';
import type { TargetCtx } from './targetTypes';
import { TroopPicker, troopTotal } from './TroopPicker';

/** 资源键清单（原 Object.keys(RESOURCE_LABEL)：键名与语言无关，改静态数组避免模块顶层取文案包；键序与 copy.RESOURCE_LABEL 一致） */
const RESOURCE_KEYS = ['gold', 'wood', 'food', 'stone', 'iron'] as Array<keyof Resources>;

export type CargoInput = Partial<Record<keyof Resources, number>>;

export function cargoUsed(cargo: CargoInput): number {
  return RESOURCE_KEYS.reduce((sum, key) => sum + (cargo[key] ?? 0), 0);
}

export function TransportForm({ ctx }: { ctx: TargetCtx }) {
  const copy = useCopy();
  const { COPY, CITY_COPY, DEFENSE_COPY, RESOURCE_LABEL } = copy;
  const { world, city, x, y, origin, hero, troops, setTroops, busy, run } = ctx;
  const [cargo, setCargo] = useState<CargoInput>({});
  const deployBlocked = useDeployBlockedText(DEFENSE_COPY.deploy.full);
  const bonus = carryBonusPercent(city.techs);
  const capacity = armyCarryCapacity(troops, bonus);
  const used = cargoUsed(cargo);
  const lacking = RESOURCE_KEYS.find((key) => (cargo[key] ?? 0) > city.resources[key]);
  const problem =
    used <= 0
      ? CITY_COPY.transport.pickCargo
      : used > capacity
        ? CITY_COPY.transport.overCapacity
        : lacking
          ? CITY_COPY.transport.insufficient(RESOURCE_LABEL[lacking])
          : null;
  const total = troopTotal(troops);
  // 驿站（v30 AISLG-83）：运输目标是自己另一座城，出发城驿站每级 +10% 行军速度
  const eta =
    origin && total > 0
      ? marchTravelSeconds(origin.x, origin.y, x, y, troops, city.timeScale, marchBonusPercent(city.techs) + city.levels.post_station * 10)
      : null;

  const setKey = (key: keyof Resources, raw: number) => {
    const next = Number.isFinite(raw) ? Math.min(Math.max(0, Math.floor(raw)), Math.floor(city.resources[key])) : 0;
    setCargo({ ...cargo, [key]: next });
  };

  return (
    <div role="世界地图详情区-调兵表单" className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div role="运输表单-货物" className="flex flex-col gap-1">
        <p className="truncate text-[11.5px] text-faint" title={CITY_COPY.transport.hint}>
          {CITY_COPY.transport.cargoTitle}
        </p>
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-1">
          {RESOURCE_KEYS.map((key) => (
            <label
              key={key}
              role="运输表单-货物行"
              title={CITY_COPY.transport.cargoInputLabel(RESOURCE_LABEL[key], Math.floor(city.resources[key]))}
              className="grid grid-cols-[1.2rem_minmax(0,1fr)_3.8rem] items-center gap-1 text-[11.5px]"
            >
              <span className="text-dim">{RESOURCE_LABEL[key]}</span>
              <button
                type="button"
                role="运输表单-货物最多按钮"
                title={CITY_COPY.transport.cargoMax}
                onClick={() => setKey(key, Math.min(city.resources[key], Math.max(0, capacity - (used - (cargo[key] ?? 0)))))}
                className="cursor-pointer truncate text-left font-mono tabular-nums text-faint hover:text-accent"
              >
                {Math.floor(city.resources[key])}
              </button>
              <input
                role="运输表单-货物数量输入"
                type="number"
                min={0}
                max={city.resources[key]}
                placeholder="0"
                value={cargo[key] ? cargo[key] : ''}
                onChange={(event) => setKey(key, Number(event.target.value))}
                className="w-full rounded border border-line bg-bg px-1 py-0.5 text-right font-mono text-[12px] text-fg outline-none placeholder:text-faint focus:border-accent-dim"
              />
            </label>
          ))}
        </div>
        <p role="运输表单-负重" className={`font-mono text-[11.5px] ${used > capacity ? 'text-warn' : 'text-faint'}`}>
          {CITY_COPY.transport.usedLine(used, capacity)}
          {problem && used > 0 ? <span role="运输表单-提示" className="ml-2 font-sans text-warn">{problem}</span> : null}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <TroopPicker army={city.army} value={troops} onChange={setTroops} etaSeconds={eta} carryBonusPercent={bonus} hideHero={false} />
      </div>
      <ConfirmButton
        label={CITY_COPY.transport.submit}
        busy={busy}
        disabledReason={deployBlocked ?? (total <= 0 ? COPY.worldMap.troopPickHint : problem)}
        onClick={() =>
          void run(async () => {
            const filled = Object.fromEntries(Object.entries(cargo).filter(([, value]) => (value ?? 0) > 0)) as CargoInput;
            const ok = await world.march(x, y, troops, 'transport', filled, undefined, hero?.selectedHeroId ?? null);
            if (ok) {
              setTroops({});
              setCargo({});
              hero?.afterMarch();
            }
          })
        }
      />
    </div>
  );
}
