/** 遣散表单（v84，AISLG-209，嵌在军队页的军队卡里，与招募共用兵种表）：每个兵种一行
 *  （兵种 + 城内数量 + 遣散数量输入 + 「全部」快捷按钮），下方按同一公式预览返还资源，
 *  一个「遣散」按钮打开站内确认弹窗（不使用浏览器原生 confirm）。
 *  城里有敌情（city.inBattle）时按钮置灰并说明原因；权威判定仍在服务端（CITY_IN_BATTLE）。
 */

import { useState } from 'react';
import {
  TROOP_KINDS,
  disbandRefundPreview,
  type CityView,
  type TroopKind,
} from '../../api/protocol';
import { disbandRefundText, disbandTroopsText, nonZeroTroops } from '../../api/disbandText';
import { TROOP_LABEL as TROOP_LABEL_ZH } from '../../copy';
import { useCopy } from '../../i18n/bundle';
import type { ConnectionStatus } from '../../state/useGameSession';
import { Modal } from '../ui/Modal';

interface DisbandFormProps {
  city: CityView | null;
  connection: ConnectionStatus;
  /** 提交遣散；成功返回 null，失败返回人读错误（服务端权威结果） */
  onDisband: (troops: Partial<Record<TroopKind, number>>) => Promise<string | null>;
}

export function DisbandForm({ city, connection, onDisband }: DisbandFormProps) {
  const copy = useCopy();
  const { ARMY_COPY, TROOP_LABEL } = copy;
  const DIS = ARMY_COPY.disband;
  const [counts, setCounts] = useState<Partial<Record<TroopKind, number>>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const troopsInCity = TROOP_KINDS.reduce((sum, kind) => sum + (city?.army[kind] ?? 0), 0);
  const selected = nonZeroTroops(counts);
  const total = TROOP_KINDS.reduce((sum, kind) => sum + (selected[kind] ?? 0), 0);
  const refund = disbandRefundPreview(selected);
  const inBattle = city?.inBattle === true;
  const submitDisabled = connection !== 'online' || city === null || total === 0 || inBattle;

  /** 输入框：接受 0..城内数量，超出即钳到上限；清空视为 0 */
  const setCount = (kind: TroopKind, raw: string): void => {
    const have = city?.army[kind] ?? 0;
    const value = Math.floor(Number(raw));
    setError(null);
    setCounts((prev) => ({
      ...prev,
      [kind]: Number.isFinite(value) && value > 0 ? Math.min(have, value) : 0,
    }));
  };

  const reset = (): void => {
    setCounts({});
    setError(null);
  };

  async function confirm(): Promise<void> {
    if (busy || total === 0) {
      return;
    }
    setBusy(true);
    const failure = await onDisband(selected);
    setBusy(false);
    if (failure === null) {
      setConfirming(false);
      reset();
    } else {
      setError(failure);
    }
  }

  return (
    <>
      <div role="遣散面板-兵种表" className="flex min-h-0 flex-1 flex-col gap-px overflow-hidden">
        <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_2.6rem_5.2rem] gap-1.5 px-1.5 text-[10.5px] text-faint">
          <span>{DIS.colTroop}</span>
          <span className="text-right">{DIS.colHome}</span>
          <span className="text-right">{DIS.colDisband}</span>
        </div>
        {TROOP_KINDS.map((kind) => {
          const have = city?.army[kind] ?? 0;
          const value = counts[kind] ?? 0;
          return (
            <div
              key={kind}
              role={`遣散面板-兵种-${TROOP_LABEL_ZH[kind].short}`}
              className={`grid max-h-9 min-h-0 flex-1 grid-cols-[minmax(0,1fr)_2.6rem_5.2rem] items-center gap-1.5 rounded px-1.5 text-[12px] even:bg-panel-2 ${have === 0 ? 'opacity-45' : ''}`}
            >
              <span className="truncate">{TROOP_LABEL[kind].name}</span>
              <span className={`text-right font-mono tabular-nums ${have > 0 ? '' : 'text-faint'}`}>{have}</span>
              <span className="flex items-center justify-end gap-1">
                <input
                  role={`遣散面板-数量-${TROOP_LABEL_ZH[kind].short}`}
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
                  role={`遣散面板-全部-${TROOP_LABEL_ZH[kind].short}`}
                  title={DIS.all}
                  disabled={have === 0}
                  onClick={() => {
                    setError(null);
                    setCounts((prev) => ({ ...prev, [kind]: have }));
                  }}
                  className="rounded border border-line-soft bg-panel px-1 py-px text-[10.5px] leading-tight text-dim hover:border-accent-dim hover:text-accent disabled:opacity-50"
                >
                  {DIS.all}
                </button>
              </span>
            </div>
          );
        })}
      </div>

      <div role="遣散面板-返还预览" className="line-clamp-2 shrink-0 font-mono text-[11.5px] text-dim" title={inBattle ? DIS.inBattle : undefined}>
        {total > 0 ? (
          <>
            <span className="text-faint">{DIS.refundLabel} </span>
            {disbandRefundText(refund)}
            <span className="text-faint">{` · ${DIS.refundNote}`}</span>
          </>
        ) : (
          <span className="font-sans text-faint">{troopsInCity > 0 ? DIS.hint : DIS.hintNoTroops}</span>
        )}
      </div>

      {inBattle ? (
        <p role="遣散面板-敌情提示" className="shrink-0 rounded border border-line-soft bg-panel-2 px-2 py-1 text-[11.5px] text-dim">
          {DIS.inBattle}
        </p>
      ) : null}

      <button
        type="button"
        role="遣散面板-提交"
        className="btn shrink-0 py-1.5 text-[13px] font-semibold"
        disabled={submitDisabled}
        title={inBattle ? DIS.inBattle : undefined}
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
      >
        {DIS.submit}
        {total > 0 ? ` ×${total}` : ''}
      </button>

      {error && !confirming ? (
        <p role="遣散面板-错误" className="shrink-0 truncate rounded border border-line-soft bg-panel-2 px-2 py-1 text-[12px] text-dim" title={error}>
          {error}
        </p>
      ) : null}

      {confirming ? (
        <Modal role="遣散确认框" title={DIS.dialogTitle} size="sm" accent="none" onClose={() => (busy ? undefined : setConfirming(false))}>
          <p role="遣散确认框-摘要" className="text-[13px] text-dim">
            {DIS.summary(disbandTroopsText(selected), disbandRefundText(refund))}
          </p>
          {error ? (
            <p role="遣散确认框-错误" className="truncate rounded border border-line-soft bg-panel-2 px-2 py-1.5 text-[12px] text-dim" title={error}>
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" role="遣散确认框-返回按钮" className="btn" disabled={busy} onClick={() => setConfirming(false)}>
              {DIS.cancel}
            </button>
            <button type="button" role="遣散确认框-确认按钮" className="btn px-3" disabled={busy || total === 0} onClick={() => void confirm()}>
              {busy ? DIS.busy : DIS.confirm}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
