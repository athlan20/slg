// 将星塔进度卡（v55，AISLG-146）：已通过的层、下一层的敌方阵容与首通奖励，以及挑战按钮。
// 层数、胜负与奖励的权威判定在服务端；按钮禁用只是预判（没有阵容 / 没有城 / 已全部通关）。

import { useCopy } from '../../i18n/bundle';
import type { StarTowerSession } from '../../state/starTowerSession';
import { Card } from '../ui/Card';

interface StarTowerProgressCardProps {
  session: StarTowerSession;
}

export function StarTowerProgressCard({ session }: StarTowerProgressCardProps) {
  const copy = useCopy();
  const { STAR_TOWER_COPY } = copy;
  const C = STAR_TOWER_COPY.progress;
  const { tower, error, busy, challenge } = session;
  const canChallenge = tower !== null && tower.nextFloor !== null && tower.lineupReady && tower.hasCity && !busy;
  const rulesLine = tower ? C.rules(tower.rules.floors, tower.rules.bossEvery) : '';

  return (
    <Card
      role="将星塔页-进度"
      title={C.title}
      meta={
        tower ? (
          <span role="将星塔页-进度-层数" className="font-mono text-[12px] text-accent">
            {tower.cleared ? C.cleared : tower.bestFloor === 0 ? C.bestNone : C.best(tower.bestFloor)}
          </span>
        ) : undefined
      }
    >
      {!tower ? <p className="text-[12px] text-faint">{C.loading}</p> : null}

      {tower && tower.nextFloor !== null ? (
        <div role="将星塔页-进度-下一层" className="flex shrink-0 flex-col gap-1 rounded-[5px] border border-line-soft bg-panel-2 px-2 py-1.5 text-[12px]">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-mono text-[13px] font-semibold text-accent">{C.nextFloor(tower.nextFloor)}</span>
            {tower.nextBoss ? <span className="text-[11px] font-semibold text-warn">{C.bossTag}</span> : null}
            <span className="text-[11px] text-faint">{C.enemies(tower.nextEnemies.length)}</span>
          </div>
          <ul role="将星塔页-进度-敌将" className="flex flex-col gap-0.5">
            {tower.nextEnemies.map((enemy, index) => (
              <li key={`${enemy.name}-${index}`} className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate">{enemy.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-faint">
                  {C.level(enemy.level)} · {C.stats(enemy.lead, enemy.force, enemy.wit)}
                </span>
              </li>
            ))}
          </ul>
          {tower.nextReward ? (
            <p role="将星塔页-进度-奖励" className="truncate text-[11.5px] text-dim">
              {C.reward(tower.nextReward.gold, tower.nextReward.exp)}
            </p>
          ) : null}
          <p className="truncate text-[11px] text-faint" title={rulesLine}>
            {rulesLine}
          </p>
          <button
            type="button"
            role="将星塔页-挑战"
            disabled={!canChallenge}
            onClick={() => void challenge()}
            className="btn w-full truncate"
          >
            {busy ? C.challenging : C.challenge(tower.nextFloor)}
          </button>
        </div>
      ) : null}

      {tower?.cleared ? <p className="shrink-0 text-[12px] text-ok">{C.clearedNote}</p> : null}
      {tower && !tower.lineupReady ? <p className="shrink-0 truncate text-[12px] text-warn">{C.noLineup}</p> : null}
      {tower && !tower.hasCity ? <p className="shrink-0 truncate text-[12px] text-warn">{C.noCity}</p> : null}
      {error ? (
        <p role="将星塔页-进度-错误" className="shrink-0 truncate text-[12px] text-warn" title={error}>
          {error}
        </p>
      ) : null}
    </Card>
  );
}
