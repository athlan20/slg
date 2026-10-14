import type { ArenaRoundView } from '../api/protocol-arena';
import { combatText, formationName, specialtyName } from '../copy-combat';

export function ArenaRoundDetails({ rounds }: { rounds: ArenaRoundView[] }) {
  return (
    <details role="arena-round-details" className="min-w-0 text-[11px] text-dim">
      <summary role="arena-round-summary" className="cursor-pointer text-accent">{combatText('阵容与逐局结果', 'Lineups and round results')}</summary>
      <div role="arena-round-list" className="flex flex-col gap-1 pt-1">
        {rounds.map(round => (
          <div key={round.slot} role={`arena-round-${round.slot}`} className="rounded border border-line-soft px-1.5 py-1">
            <p>{combatText('号位', 'Slot')} {round.slot} · {round.winner === 'challenger' ? combatText('挑战方胜', 'Challenger won') : combatText('守方胜', 'Defender won')}</p>
            {[round.challenger, round.defender].map((fighter, index) => (
              <p key={index} className="break-words">
                {index === 0 ? combatText('攻', 'Attack') : combatText('守', 'Defense')}: {fighter ? `${fighter.name} · ${formationName(fighter.formation ?? 'balanced')}${fighter.specialty ? ` · ${specialtyName(fighter.specialty)}` : ''}` : combatText('空位', 'Empty')}
              </p>
            ))}
            {round.battle ? <p>{combatText('兵力', 'Troops')}: {round.battle.challengerTroops} → {round.battle.challengerSurvivors} / {round.battle.defenderTroops} → {round.battle.defenderSurvivors}</p> : null}
          </div>
        ))}
      </div>
    </details>
  );
}
