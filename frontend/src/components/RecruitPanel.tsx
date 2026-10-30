/** 军队卡（军队页左，v84 起两种模式）：上边「招募 / 遣散」切换——招募 = 征兵表单（RecruitForm），
 *  遣散 = 城内驻军解散表单（DisbandForm，AISLG-209）。两种模式共用同一个兵种表位置与卡片高度，
 *  切换不改变页面网格。
 */

import { useState } from 'react';
import { TROOP_KINDS, type CityView, type TroopKind } from '../api/protocol';
import { useCopy } from '../i18n/bundle';
import type { ConnectionStatus } from '../state/useGameSession';
import { Card } from './ui/Card';
import { DisbandForm } from './army/DisbandForm';
import { RecruitForm } from './army/RecruitForm';

interface RecruitPanelProps {
  city: CityView | null;
  connection: ConnectionStatus;
  recruitError: string | null;
  onStartRecruit: (troop: TroopKind, count: number) => void;
  onCancelRecruit: (recruitId: string) => void;
  /** 遣散（v84，AISLG-209）：成功返回 null，失败返回人读错误 */
  onDisband: (troops: Partial<Record<TroopKind, number>>) => Promise<string | null>;
}

export function RecruitPanel({ city, connection, recruitError, onStartRecruit, onCancelRecruit, onDisband }: RecruitPanelProps) {
  const copy = useCopy();
  const { ARMY_COPY, COPY } = copy;
  const [mode, setMode] = useState<'recruit' | 'disband'>('recruit');
  const barracks = city?.levels.barracks ?? 0;
  const troopsInCity = city ? TROOP_KINDS.reduce((sum, kind) => sum + (city.army[kind] ?? 0), 0) : 0;

  const tabClass = (active: boolean): string =>
    `rounded border px-1.5 py-px text-[11px] leading-tight ${active ? 'border-accent-dim bg-accent-soft text-accent' : 'border-line-soft bg-panel text-dim hover:border-accent-dim'}`;

  return (
    <Card
      role="军队面板"
      title={mode === 'recruit' ? ARMY_COPY.recruitTitle : ARMY_COPY.disbandTitle}
      meta={
        mode === 'recruit' ? (
          <span role="征兵面板-守城加成">{city ? `${ARMY_COPY.recruitMeta(barracks, Math.max(0, city.population.cap - city.population.current))} · ${COPY.recruitPanel.defenseMeta(city.defenseBonus)}` : ''}</span>
        ) : (
          <span role="遣散面板-兵力">{ARMY_COPY.disbandMeta(troopsInCity)}</span>
        )
      }
      actions={
        <div role="军队面板-模式切换" className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            role="军队面板-模式-征兵"
            aria-pressed={mode === 'recruit'}
            className={tabClass(mode === 'recruit')}
            onClick={() => setMode('recruit')}
          >
            {ARMY_COPY.modeRecruit}
          </button>
          <button
            type="button"
            role="军队面板-模式-遣散"
            aria-pressed={mode === 'disband'}
            className={tabClass(mode === 'disband')}
            onClick={() => setMode('disband')}
          >
            {ARMY_COPY.modeDisband}
          </button>
        </div>
      }
    >
      {mode === 'disband' ? (
        <DisbandForm city={city} connection={connection} onDisband={onDisband} />
      ) : (
        <RecruitForm
          city={city}
          connection={connection}
          recruitError={recruitError}
          onStartRecruit={onStartRecruit}
          onCancelRecruit={onCancelRecruit}
        />
      )}
    </Card>
  );
}
