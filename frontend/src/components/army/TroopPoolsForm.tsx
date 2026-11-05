/** 伤兵营表单（v85，AISLG-212，嵌在军队卡里，与招募 / 遣散共用卡片）：「伤兵 / 俘虏 / 逃兵」
 *  三组页签切换池子；每组一个兵种表（兵种 + 池内数量 + 数量输入 + 「全部」），下方预览
 *  花费（治疗 / 劝回 50%、招降 60%，招降另扣人口）与最早一批的剩余时间（剩不足 6 小时
 *  红色提示），「治疗 / 招降 / 劝回」与「放弃 / 释放」各开站内确认弹窗（不用浏览器原生
 *  confirm）。逃兵没有「释放」（只能劝回或等过期）；断粮中劝回由服务端 CITY_STARVING 拒绝。
 *  v88（AISLG-218）：池子页签下方多一行「全部城池合计」，提交按钮组旁多一组「全部治疗 /
 *  全部招降 / 全部劝回 / 全部放弃 / 全部释放」（全城汇总与一键处理在 TroopPoolsAllCities.tsx）；
 *  页签红点改看「任意一座城的该池子快过期」（全城池子由 RecruitPanel 传下来）。
 */

import { useState } from 'react';
import {
  CAPTIVE_RECRUIT_COST_PERCENT,
  DESERTER_RECALL_COST_PERCENT,
  HEAL_COST_PERCENT,
  TROOP_INFO,
  TROOP_KINDS,
  restoreCostPreview,
  type AccountTroopPoolsCityView,
  type CityView,
  type TroopKind,
  type TroopPoolKind,
  type TroopPoolView,
} from '../../api/protocol';
import { formatDurationText } from '../../api/format';
import { poolCostText, poolTroopsText } from '../../api/poolText';
import { TROOP_LABEL as TROOP_LABEL_ZH } from '../../copy';
import { useCopy } from '../../i18n/bundle';
import { anyCityPoolExpiringSoon, poolExpiringSoon, poolRemainSeconds } from '../../state/troopPoolsAllCities';
import type { ConnectionStatus } from '../../state/useGameSession';
import { Modal } from '../ui/Modal';
import { TroopPoolsAllCities, TroopPoolsAllCitiesSummary } from './TroopPoolsAllCities';

interface TroopPoolsFormProps {
  city: CityView | null;
  connection: ConnectionStatus;
  /** 治疗 / 招降 / 劝回；成功返回 null，失败返回人读错误（服务端权威结果）；cityId 缺省 = 当前城 */
  onRestore: (pool: TroopPoolKind, troops: Partial<Record<TroopKind, number>>, cityId?: string) => Promise<string | null>;
  /** 放弃治疗 / 释放俘虏；成功返回 null，失败返回人读错误；cityId 缺省 = 当前城 */
  onRelease: (pool: TroopPoolKind, troops: Partial<Record<TroopKind, number>>, cityId?: string) => Promise<string | null>;
  /** 账号全部城的池子（v88，AISLG-218）：汇总行 / 一键按钮 / 页签红点用；未拉到为 null */
  allCities: AccountTroopPoolsCityView[] | null;
  /** 全城池子有变化（本城或一键处理做完）：重拉全城池子并对齐本城状态 */
  onRefreshAll: () => void;
}

/** 池子在 CityView 上的字段名（pool=captive 对应 captives） */
function poolView(city: CityView | null, pool: TroopPoolKind): TroopPoolView {
  const empty: TroopPoolView = { troops: {} as TroopPoolView['troops'], earliestExpireAt: null };
  const view = city === null ? null : pool === 'wounded' ? city.wounded : pool === 'captive' ? city.captives : city.deserters;
  return view ?? empty;
}

export function TroopPoolsForm({ city, connection, onRestore, onRelease, allCities, onRefreshAll }: TroopPoolsFormProps) {
  const copy = useCopy();
  const { TROOP_LABEL } = copy;
  const P = copy.ARMY_COPY.pools;
  const [pool, setPool] = useState<TroopPoolKind>('wounded');
  const [counts, setCounts] = useState<Partial<Record<TroopKind, number>>>({});
  const [confirming, setConfirming] = useState<'restore' | 'release' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const view = poolView(city, pool);
  const percent = pool === 'wounded' ? HEAL_COST_PERCENT : pool === 'captive' ? CAPTIVE_RECRUIT_COST_PERCENT : DESERTER_RECALL_COST_PERCENT;
  const selected: Partial<Record<TroopKind, number>> = {};
  for (const kind of TROOP_KINDS) {
    const count = Math.floor(counts[kind] ?? 0);
    if (count > 0) {
      selected[kind] = count;
    }
  }
  const total = TROOP_KINDS.reduce((sum, kind) => sum + (selected[kind] ?? 0), 0);
  const inPool = TROOP_KINDS.reduce((sum, kind) => sum + (view.troops[kind] ?? 0), 0);
  const cost = restoreCostPreview(selected, percent);
  const populationCost =
    pool === 'captive'
      ? TROOP_KINDS.reduce((sum, kind) => sum + (selected[kind] ?? 0) * TROOP_INFO[kind].population, 0)
      : 0;
  const remain = poolRemainSeconds(view.earliestExpireAt);
  const expireSoon = poolExpiringSoon(view.earliestExpireAt);
  const starving = city?.starveAt !== null && city?.starveAt !== undefined && Date.parse(city.starveAt) <= Date.now();
  const submitDisabled = connection !== 'online' || city === null || total === 0;
  const blockDeserterRecall = pool === 'deserter' && starving;

  const poolTab = (key: TroopPoolKind, label: string, count: number, hot: boolean) => (
    <button
      key={key}
      type="button"
      role={`伤兵营-页签-${label}`}
      aria-pressed={pool === key}
      className={`relative rounded border px-1.5 py-px text-[11px] leading-tight ${
        pool === key ? 'border-accent-dim bg-accent-soft text-accent' : 'border-line-soft bg-panel text-dim hover:border-accent-dim'
      }`}
      onClick={() => {
        setPool(key);
        setCounts({});
        setError(null);
      }}
    >
      {label}
      {count > 0 ? ` ${count}` : ''}
      {hot ? <span role={`伤兵营-红点-${label}`} className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-st-error" /> : null}
    </button>
  );

  const setCount = (kind: TroopKind, raw: string): void => {
    const have = view.troops[kind] ?? 0;
    const value = Math.floor(Number(raw));
    setError(null);
    setCounts((prev) => ({
      ...prev,
      [kind]: Number.isFinite(value) && value > 0 ? Math.min(have, value) : 0,
    }));
  };

  async function confirm(): Promise<void> {
    if (busy || total === 0 || confirming === null) {
      return;
    }
    setBusy(true);
    const failure = confirming === 'restore' ? await onRestore(pool, selected) : await onRelease(pool, selected);
    setBusy(false);
    if (failure === null) {
      setConfirming(null);
      setCounts({});
      // 本城池子变了 → 立即重拉全城汇总（红点与合计随之更新）
      onRefreshAll();
    } else {
      setError(failure);
    }
  }

  const restoreLabel = pool === 'wounded' ? P.restoreWounded : pool === 'captive' ? P.restoreCaptive : P.restoreDeserter;
  const costNote = pool === 'wounded' ? P.costNoteWounded : pool === 'captive' ? P.costNoteCaptive : P.costNoteDeserter;
  const expireNote = pool === 'wounded' ? P.expireNoteWounded : pool === 'captive' ? P.expireNoteCaptive : P.expireNoteDeserter;
  const summary =
    confirming === 'restore'
      ? P.restoreSummary(poolTroopsText(selected), poolCostText(cost)) +
        (populationCost > 0 ? ` ${P.populationCost(populationCost)}。` : '')
      : pool === 'wounded'
        ? P.releaseSummaryWounded(poolTroopsText(selected))
        : P.releaseSummaryCaptive(poolTroopsText(selected));
  const confirmText =
    confirming === 'restore'
      ? pool === 'wounded'
        ? P.confirmRestoreWounded
        : pool === 'captive'
          ? P.confirmRestoreCaptive
          : P.confirmRestoreDeserter
      : pool === 'wounded'
        ? P.confirmReleaseWounded
        : P.confirmReleaseCaptive;

  return (
    <>
      <div role="伤兵营-池子切换" className="flex shrink-0 items-center gap-1 px-1">
        {poolTab('wounded', P.poolWounded, TROOP_KINDS.reduce((sum, kind) => sum + (poolView(city, 'wounded').troops[kind] ?? 0), 0), anyCityPoolExpiringSoon(allCities, 'wounded'))}
        {poolTab('captive', P.poolCaptives, TROOP_KINDS.reduce((sum, kind) => sum + (poolView(city, 'captive').troops[kind] ?? 0), 0), anyCityPoolExpiringSoon(allCities, 'captive'))}
        {poolTab('deserter', P.poolDeserters, TROOP_KINDS.reduce((sum, kind) => sum + (poolView(city, 'deserter').troops[kind] ?? 0), 0), anyCityPoolExpiringSoon(allCities, 'deserter'))}
      </div>

      {/* v88（AISLG-218）：池子页签下方的「全部城池合计」 */}
      <TroopPoolsAllCitiesSummary cities={allCities} pool={pool} />

      <div role="伤兵营-兵种表" className="flex min-h-0 flex-1 flex-col gap-px overflow-hidden">
        <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_2.6rem_5.2rem] gap-1.5 px-1.5 text-[10.5px] text-faint">
          <span>{P.colTroop}</span>
          <span className="text-right">{P.colHave}</span>
          <span className="text-right">{P.colCount}</span>
        </div>
        {TROOP_KINDS.map((kind) => {
          const have = view.troops[kind] ?? 0;
          const value = counts[kind] ?? 0;
          return (
            <div
              key={kind}
              role={`伤兵营-兵种-${TROOP_LABEL_ZH[kind].short}`}
              className={`grid max-h-9 min-h-0 flex-1 grid-cols-[minmax(0,1fr)_2.6rem_5.2rem] items-center gap-1.5 rounded px-1.5 text-[12px] even:bg-panel-2 ${have === 0 ? 'opacity-45' : ''}`}
            >
              <span className="truncate">{TROOP_LABEL[kind].name}</span>
              <span className={`text-right font-mono tabular-nums ${have > 0 ? '' : 'text-faint'}`}>{have}</span>
              <span className="flex items-center justify-end gap-1">
                <input
                  role={`伤兵营-数量-${TROOP_LABEL_ZH[kind].short}`}
                  type="number"
                  min={0}
                  max={have}
                  placeholder="0"
                  disabled={have === 0}
                  value={value > 0 ? value : ''}
                  onChange={(event) => setCount(kind, event.target.value)}
                  className="w-10 rounded border border-line bg-bg px-1 py-px text-right font-mono text-[12px] outline-none focus:border-accent-dim disabled:opacity-50"
                />
                <button
                  type="button"
                  role={`伤兵营-全部-${TROOP_LABEL_ZH[kind].short}`}
                  title={P.all}
                  disabled={have === 0}
                  onClick={() => {
                    setError(null);
                    setCounts((prev) => ({ ...prev, [kind]: have }));
                  }}
                  className="rounded border border-line-soft bg-panel px-1 py-px text-[10.5px] leading-tight text-dim hover:border-accent-dim hover:text-accent disabled:opacity-50"
                >
                  {P.all}
                </button>
              </span>
            </div>
          );
        })}
      </div>

      <div role="伤兵营-过期提示" className="shrink-0 text-[11px] leading-tight">
        {inPool > 0 && view.earliestExpireAt !== null ? (
          <span className={expireSoon ? 'font-semibold text-st-error' : 'text-dim'}>{P.expireAt(formatDurationText(remain))}</span>
        ) : (
          <span className="text-faint">{P.hintNoTroops}</span>
        )}
        <span className="text-faint">{` · ${expireNote}`}</span>
      </div>

      <div role="伤兵营-花费预览" className="line-clamp-2 shrink-0 font-mono text-[11.5px] text-dim">
        {total > 0 ? (
          <>
            <span className="text-faint">{`${P.costLabel} `}</span>
            {poolCostText(cost)}
            {populationCost > 0 ? <span className="text-faint">{` · ${P.populationCost(populationCost)}`}</span> : null}
            <span className="text-faint">{` · ${costNote}`}</span>
          </>
        ) : (
          <span className="font-sans text-faint">{inPool > 0 ? P.hintSelect : P.hintNoTroops}</span>
        )}
      </div>

      {blockDeserterRecall ? (
        <p role="伤兵营-断粮提示" className="shrink-0 rounded border border-line-soft bg-panel-2 px-2 py-1 text-[11.5px] text-dim">
          {P.cityStarving}
        </p>
      ) : null}

      <div role="伤兵营-提交按钮组" className="flex shrink-0 gap-1.5">
        <button
          type="button"
          role="伤兵营-提交"
          className="btn flex-1 py-1.5 text-[13px] font-semibold"
          disabled={submitDisabled}
          title={blockDeserterRecall ? P.cityStarving : undefined}
          onClick={() => {
            setError(null);
            setConfirming('restore');
          }}
        >
          {restoreLabel}
          {total > 0 ? ` ×${total}` : ''}
        </button>
        {pool !== 'deserter' ? (
          <button
            type="button"
            role="伤兵营-放弃释放"
            className="btn px-2 py-1.5 text-[12px]"
            disabled={submitDisabled}
            onClick={() => {
              setError(null);
              setConfirming('release');
            }}
          >
            {pool === 'wounded' ? P.releaseWounded : P.releaseCaptive}
          </button>
        ) : null}
        {/* v88（AISLG-218）：提交按钮组旁的全城一键处理（确认框 / 结果摘要都在里面） */}
        <TroopPoolsAllCities
          cities={allCities}
          pool={pool}
          connection={connection}
          onRestore={onRestore}
          onRelease={onRelease}
          onFinished={onRefreshAll}
        />
      </div>

      {error && confirming === null ? (
        <p role="伤兵营-错误" className="shrink-0 truncate rounded border border-line-soft bg-panel-2 px-2 py-1 text-[12px] text-dim" title={error}>
          {error}
        </p>
      ) : null}

      {confirming !== null ? (
        <Modal
          role="伤兵营确认框"
          title={confirming === 'restore' ? P.restoreDialogTitle : P.releaseDialogTitle}
          size="sm"
          accent="none"
          onClose={() => (busy ? undefined : setConfirming(null))}
        >
          <p role="伤兵营确认框-摘要" className="text-[13px] text-dim">
            {summary}
          </p>
          {error ? (
            <p role="伤兵营确认框-错误" className="truncate rounded border border-line-soft bg-panel-2 px-2 py-1.5 text-[12px] text-dim" title={error}>
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" role="伤兵营确认框-返回按钮" className="btn" disabled={busy} onClick={() => setConfirming(null)}>
              {P.cancel}
            </button>
            <button type="button" role="伤兵营确认框-确认按钮" className="btn px-3" disabled={busy || total === 0} onClick={() => void confirm()}>
              {busy ? P.busy : confirmText}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
