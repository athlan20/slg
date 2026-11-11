/** 剧本战场地图网格（v75，AISLG-198；AISLG-250 从 BattlefieldModal.tsx 拆出以控制单文件行数）：
 *  30×30 格子，据点按归属着色（未解锁半透明），己方队伍所在格加金圈；点据点格子选中该据点。 */

import { useMemo } from 'react';
import type { BattlefieldCamp, BattlefieldSquadView, BattlefieldStrongholdView } from '../api/protocol';

function ownerClass(camp: BattlefieldCamp | null): string {
  if (camp === 'yuan') {
    return 'border-accent bg-accent-soft text-accent';
  }
  if (camp === 'cao') {
    return 'border-st-error bg-st-error/15 text-st-error';
  }
  return 'border-line bg-panel-2 text-dim';
}

export function BattlefieldMapGrid({
  strongholds,
  squads,
  selectedStronghold,
  onSelect,
}: {
  strongholds: readonly BattlefieldStrongholdView[];
  squads: readonly BattlefieldSquadView[];
  selectedStronghold: string | null;
  onSelect: (id: string) => void;
}) {
  const mySquadsAt = useMemo(() => {
    const map = new Map<string, BattlefieldSquadView[]>();
    for (const squad of squads) {
      const key = `${squad.x},${squad.y}`;
      const list = map.get(key) ?? [];
      list.push(squad);
      map.set(key, list);
    }
    return map;
  }, [squads]);

  const mapCells = [];
  for (let y = 0; y < 30; y += 1) {
    for (let x = 0; x < 30; x += 1) {
      const stronghold = strongholds.find((item) => item.x === x && item.y === y) ?? null;
      const mine = mySquadsAt.get(`${x},${y}`) ?? [];
      const river = x === 15 && !stronghold;
      const classes = stronghold ? `${ownerClass(stronghold.ownerCamp)} border` : river ? 'bg-st-info/40' : 'bg-panel-2/40';
      mapCells.push(
        <button
          key={`${x}-${y}`}
          type="button"
          tabIndex={stronghold ? 0 : -1}
          title={stronghold ? `${stronghold.name}（${x},${y}）` : undefined}
          onClick={() => stronghold && onSelect(stronghold.id)}
          className={`relative aspect-square min-w-0 rounded-[1px] ${classes} ${stronghold ? 'cursor-pointer' : 'cursor-default'} ${
            stronghold && !stronghold.unlocked ? 'opacity-40' : ''
          } ${selectedStronghold === stronghold?.id ? 'ring-1 ring-gold' : ''}`}
        >
          {mine.length > 0 ? <span className="absolute inset-[2px] rounded-full border border-gold" /> : null}
        </button>,
      );
    }
  }

  return (
    <div
      role="战场-地图"
      className="grid w-full max-w-[320px] self-center overflow-hidden rounded border border-line"
      style={{ gridTemplateColumns: 'repeat(30, minmax(0, 1fr))' }}
    >
      {mapCells}
    </div>
  );
}
