/** 军队卡（军队页左，v84 起三种模式）：上边「招募 / 遣散 / 伤兵营」切换——招募 = 征兵表单
 *  （RecruitForm），遣散 = 城内驻军解散表单（DisbandForm，AISLG-209），伤兵营 = 伤兵 /
 *  俘虏 / 逃兵三池表单（TroopPoolsForm，AISLG-212）。三种模式共用同一个表单位置与卡片高度，
 *  切换不改变页面网格。
 *  v88（AISLG-218）：红点改看**全账号**——任意一座城的伤兵 / 俘虏 / 逃兵快过期（剩 6 小时内）
 *  就亮；全城池子由会话切片 troopPoolsAll 提供（伤兵营可见时 30 秒刷新），页签与表单共用
 *  同一个判断函数（anyCityPoolExpiringSoon）。
 */

import { useEffect, useState } from 'react';
import { TROOP_KINDS, type AccountTroopPoolsCityView, type CityView, type TroopKind } from '../api/protocol';
import { useCopy } from '../i18n/bundle';
import type { ConnectionStatus } from '../state/useGameSession';
import { Card } from './ui/Card';
import { DisbandForm } from './army/DisbandForm';
import { RecruitForm } from './army/RecruitForm';
import { anyCityPoolExpiringSoon } from '../state/troopPoolsAllCities';
import { TroopPoolsForm } from './army/TroopPoolsForm';

interface RecruitPanelProps {
  city: CityView | null;
  connection: ConnectionStatus;
  recruitError: string | null;
  onStartRecruit: (troop: TroopKind, count: number) => void;
  onCancelRecruit: (recruitId: string) => void;
  /** 遣散（v84，AISLG-209）：成功返回 null，失败返回人读错误 */
  onDisband: (troops: Partial<Record<TroopKind, number>>) => Promise<string | null>;
  /** 治疗 / 招降 / 劝回（v85，AISLG-212）：成功返回 null，失败返回人读错误；cityId 缺省 = 当前城 */
  onRestore: (pool: import('../api/protocol').TroopPoolKind, troops: Partial<Record<TroopKind, number>>, cityId?: string) => Promise<string | null>;
  /** 放弃治疗 / 释放俘虏（v85）：成功返回 null，失败返回人读错误；cityId 缺省 = 当前城 */
  onRelease: (pool: import('../api/protocol').TroopPoolKind, troops: Partial<Record<TroopKind, number>>, cityId?: string) => Promise<string | null>;
  /** 账号全部城的池子（v88，AISLG-218）：汇总行 / 一键按钮 / 红点用；未拉到为 null */
  allCities: AccountTroopPoolsCityView[] | null;
  /** 全城池子有变化（本城或一键处理做完）：重拉全城池子并对齐本城状态 */
  onRefreshAll: () => void;
  /** 伤兵营页签是否可见（v88）：可见时全城池子每 30 秒刷新一次 */
  setPoolsVisible: (visible: boolean) => void;
}

type Mode = 'recruit' | 'disband' | 'pools';

export function RecruitPanel({
  city,
  connection,
  recruitError,
  onStartRecruit,
  onCancelRecruit,
  onDisband,
  onRestore,
  onRelease,
  allCities,
  onRefreshAll,
  setPoolsVisible,
}: RecruitPanelProps) {
  const copy = useCopy();
  const { ARMY_COPY, COPY } = copy;
  const [mode, setMode] = useState<Mode>('recruit');
  // v88（AISLG-218）：伤兵营可见时才 30 秒刷新一次全城池子（切走页签或离开军队页即停）
  useEffect(() => {
    const visible = mode === 'pools';
    setPoolsVisible(visible);
    return () => setPoolsVisible(false);
  }, [mode, setPoolsVisible]);
  const barracks = city?.levels.barracks ?? 0;
  const troopsInCity = city ? TROOP_KINDS.reduce((sum, kind) => sum + (city.army[kind] ?? 0), 0) : 0;
  const poolTotal = (view: { troops: Record<string, number> } | null | undefined): number =>
    view ? TROOP_KINDS.reduce((sum, kind) => sum + (view.troops[kind] ?? 0), 0) : 0;
  // 快过期红点（v88）：**任意一座城**的伤兵 / 俘虏 / 逃兵剩不足 6 小时就亮（站在主城也看得到分城的）
  const poolsHot =
    anyCityPoolExpiringSoon(allCities, 'wounded') ||
    anyCityPoolExpiringSoon(allCities, 'captive') ||
    anyCityPoolExpiringSoon(allCities, 'deserter');
  const meta =
    mode === 'recruit' ? (
      <span role="征兵面板-守城加成">
        {city ? `${ARMY_COPY.recruitMeta(barracks, Math.max(0, city.population.cap - city.population.current))} · ${COPY.recruitPanel.defenseMeta(city.defenseBonus)}` : ''}
      </span>
    ) : mode === 'disband' ? (
      <span role="遣散面板-兵力">{ARMY_COPY.disbandMeta(troopsInCity)}</span>
    ) : (
      <span role="伤兵营-兵力">{ARMY_COPY.poolsMeta(poolTotal(city?.wounded), poolTotal(city?.captives), poolTotal(city?.deserters))}</span>
    );
  const title = mode === 'recruit' ? ARMY_COPY.recruitTitle : mode === 'disband' ? ARMY_COPY.disbandTitle : ARMY_COPY.poolsTitle;

  const tabClass = (active: boolean): string =>
    `rounded border px-1.5 py-px text-[11px] leading-tight ${active ? 'border-accent-dim bg-accent-soft text-accent' : 'border-line-soft bg-panel text-dim hover:border-accent-dim'}`;

  const modeTab = (key: Mode, label: string, hot = false) => (
    <button key={key} type="button" role={`军队面板-模式-${label}`} aria-pressed={mode === key} className={`relative ${tabClass(mode === key)}`} onClick={() => setMode(key)}>
      {label}
      {hot ? <span role="军队面板-伤兵营红点" className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-st-error" /> : null}
    </button>
  );

  return (
    <Card
      role="军队面板"
      title={title}
      meta={meta}
      actions={
        <div role="军队面板-模式切换" className="flex shrink-0 items-center gap-1">
          {modeTab('recruit', ARMY_COPY.modeRecruit)}
          {modeTab('disband', ARMY_COPY.modeDisband)}
          {modeTab('pools', ARMY_COPY.modePools, poolsHot)}
        </div>
      }
    >
      {mode === 'disband' ? (
        <DisbandForm city={city} connection={connection} onDisband={onDisband} />
      ) : mode === 'pools' ? (
        <TroopPoolsForm
          city={city}
          connection={connection}
          onRestore={onRestore}
          onRelease={onRelease}
          allCities={allCities}
          onRefreshAll={onRefreshAll}
        />
      ) : (
        <RecruitForm city={city} connection={connection} recruitError={recruitError} onStartRecruit={onStartRecruit} onCancelRecruit={onCancelRecruit} />
      )}
    </Card>
  );
}
