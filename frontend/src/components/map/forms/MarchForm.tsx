/** 出征类表单：掠夺 / 占领 / 清剿（黄巾营地）/ 增援（自己占领的野地）/ 调兵（自己的分城，不带将）。
 *  编队 + 判断条（战力 / 守军 / 负重 / 到达时间）+ 确认按钮；野地与 NPC 城的任务由页签决定（掠夺 / 占领）。
 *  提交走 world.march；权威判定（距离 / 资格 / 冷却 / 上限）在服务端，被拒的人读错误显示在面板上方。
 */

import { useMemo } from 'react';
import { carryBonusPercent, marchBonusPercent, marchTravelSeconds } from '../../../api/marchPlan';
import { BRANCH_MIN_GOVERNMENT, CITY_COPY } from '../../../copy-cities';
import { COPY } from '../../../copy';
import { DEFENSE_COPY } from '../../../copy-defense';
import { useDeployBlockedText } from '../../../state/deployContext';
import { ConfirmButton } from './ConfirmButton';
import type { TargetCtx } from './targetTypes';
import { TroopPicker, troopTotal } from './TroopPicker';

export type MarchAct = 'plunder' | 'occupy' | 'clear' | 'reinforce' | 'transfer';

export function MarchForm({ ctx, act }: { ctx: TargetCtx; act: MarchAct }) {
  const { world, city, x, y, detail, origin, hero, troops, setTroops, busy, run } = ctx;
  const deployBlocked = useDeployBlockedText(DEFENSE_COPY.deploy.full);
  const total = troopTotal(troops);
  const isNpc = detail?.kind === 'npc_city';
  /** 他人玩家城（v38 AISLG-122）/ 他人分城（v40 AISLG-124）/ 他人占领的野地（v39 AISLG-123）；TargetPanel 只对他人目标给出这些页签 */
  const enemyCity = detail?.kind === 'city' && detail.owner !== null;
  const enemyBranch = enemyCity && detail?.durability != null;
  const enemyWild = detail?.kind === 'wilderness' && detail.owner !== null && act === 'occupy';
  const withHero = act === 'plunder' || act === 'occupy' || act === 'clear';

  // 行军时长预估（AISLG-72）：驿站（v30 AISLG-83）只在调兵到自己另一座城时再加每级 +10%
  const eta = useMemo(() => {
    if (!origin || total <= 0) {
      return null;
    }
    const station = act === 'transfer' ? city.levels.post_station * 10 : 0;
    return marchTravelSeconds(origin.x, origin.y, x, y, troops, city.timeScale, marchBonusPercent(city.techs) + station);
  }, [origin, total, act, city, x, y, troops]);

  const hint = enemyWild
    ? COPY.worldMap.attackHintEnemyWild
    : enemyCity
      ? act === 'occupy' && enemyBranch
        ? COPY.worldMap.attackHintEnemyBranch
        : COPY.worldMap.attackHintPlayer
      : act === 'plunder' || act === 'clear'
        ? isNpc
          ? CITY_COPY.worldMap.attackHintNpc
          : COPY.worldMap.taskPlunderHint
        : act === 'occupy'
          ? isNpc
            ? CITY_COPY.worldMap.taskOccupyNpcHint(BRANCH_MIN_GOVERNMENT)
            : COPY.worldMap.taskOccupyHint(city.levels.government, city.territory.length)
          : act === 'reinforce'
            ? COPY.worldMap.attackHintOwn
            : COPY.worldMap.transferHint;

  const label =
    act === 'occupy'
      ? enemyWild
        ? COPY.worldMap.confirmOccupyEnemyWild
        : enemyBranch
          ? COPY.worldMap.confirmOccupyEnemyBranch
          : isNpc
            ? CITY_COPY.worldMap.confirmOccupyNpc
            : COPY.worldMap.confirmOccupy
      : act === 'reinforce'
        ? COPY.worldMap.confirmReinforce
        : act === 'transfer'
          ? COPY.worldMap.transferSubmit
          : COPY.worldMap.confirmPlunder;

  const submit = () =>
    run(async () => {
      const ok = await world.march(x, y, troops, act === 'occupy' ? 'occupy' : 'plunder', undefined, undefined, withHero ? (hero?.selectedHeroId ?? null) : null);
      if (ok) {
        setTroops({});
        if (withHero) {
          hero?.afterMarch();
        }
      }
    });

  return (
    <div role="世界地图详情区-出征表单" className="flex min-h-0 flex-1 flex-col gap-1.5">
      <p className="line-clamp-2 text-[11.5px] text-faint" title={hint}>
        {hint}
      </p>
      <div className="min-h-0 flex-1 overflow-hidden">
        <TroopPicker
          army={city.army}
          value={troops}
          onChange={setTroops}
          showCarry={act === 'plunder' || act === 'clear'}
          carryBonusPercent={carryBonusPercent(city.techs)}
          enemyPower={act === 'plunder' || act === 'occupy' || act === 'clear' ? (detail?.nativePower ?? 0) : 0}
          etaSeconds={eta}
          hideHero={!withHero}
        />
      </div>
      <ConfirmButton label={label} busy={busy} disabledReason={deployBlocked ?? (total <= 0 ? COPY.worldMap.troopPickHint : null)} onClick={() => void submit()} />
    </div>
  );
}
