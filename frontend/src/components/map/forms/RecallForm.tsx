/** 撤回驻军：本账号占领的野地。可按兵种填数量只撤一部分（保留占领，地块至少留 1 兵），
 *  也可一键全部撤回（放弃占领）。填的数量会撤空地块时禁用“撤回所选”，并引导改用全部撤回。
 */

import { useState } from 'react';
import { TROOP_KINDS, type TroopKind } from '../../../api/protocol';
import { useCopy } from '../../../i18n/bundle';
import { ConfirmButton } from './ConfirmButton';
import { troopTotal } from './TroopPicker';
import type { TargetCtx, TroopInput } from './targetTypes';

export function RecallForm({ ctx }: { ctx: TargetCtx }) {
  const copy = useCopy();
  const { COPY, TARGET_COPY, TROOP_LABEL } = copy;
  const { world, x, y, detail, busy, run } = ctx;
  const [picked, setPicked] = useState<TroopInput>({});
  const garrison: TroopInput = detail?.garrisonDetail ?? {};
  const kinds = TROOP_KINDS.filter((kind) => (garrison[kind] ?? 0) > 0);
  const garrisonTotal = troopTotal(garrison);
  const selected = troopTotal(picked);
  const wouldEmpty = selected > 0 && selected >= garrisonTotal;
  const disabledReason = selected === 0 ? COPY.worldMap.recallPickFirst : wouldEmpty ? COPY.worldMap.recallWouldEmptyBtn : null;

  const setKind = (kind: TroopKind, raw: number) => {
    const max = garrison[kind] ?? 0;
    const next = Number.isFinite(raw) ? Math.min(Math.max(0, Math.floor(raw)), max) : 0;
    setPicked((prev) => ({ ...prev, [kind]: next }));
  };

  /** 撤回所选：只提交数量大于 0 的兵种；成功后清空输入（驻军数已变，旧数量不再有效） */
  const recallPicked = async () => {
    const troops: TroopInput = {};
    for (const kind of kinds) {
      if ((picked[kind] ?? 0) > 0) {
        troops[kind] = picked[kind];
      }
    }
    if (await world.recall(x, y, troops)) {
      setPicked({});
    }
  };

  return (
    <div role="世界地图详情区-召回" className="flex min-h-0 flex-1 flex-col gap-1.5">
      <p className="text-[12px] text-faint">{COPY.worldMap.recallHint || TARGET_COPY.recallHint}</p>
      <div className="grid grid-cols-2 gap-x-2.5 gap-y-1">
        {kinds.map((kind) => (
          <div
            key={kind}
            role="世界地图详情区-召回兵种行"
            title={`${TROOP_LABEL[kind].name} ${garrison[kind]}`}
            className="grid grid-cols-[minmax(0,1fr)_auto_3.4rem_auto] items-center gap-1 text-[11.5px]"
          >
            <span className="truncate text-dim">{TROOP_LABEL[kind].name}</span>
            <span className="font-mono tabular-nums text-faint">{garrison[kind]}</span>
            <input
              role="世界地图详情区-召回数量输入"
              type="number"
              min={0}
              max={garrison[kind]}
              placeholder="0"
              value={picked[kind] ? picked[kind] : ''}
              onChange={(event) => setKind(kind, Number(event.target.value))}
              className="w-full rounded border border-line bg-bg px-1 py-0.5 text-right font-mono text-[12px] text-fg outline-none placeholder:text-faint focus:border-accent-dim"
            />
            <button
              type="button"
              role="世界地图详情区-召回兵种全部按钮"
              title={COPY.worldMap.troopMax}
              onClick={() => setKind(kind, garrison[kind] ?? 0)}
              className="cursor-pointer rounded border border-line px-1.5 text-[11px] text-dim hover:border-accent-dim hover:text-fg"
            >
              {COPY.worldMap.troopMax}
            </button>
          </div>
        ))}
      </div>
      {wouldEmpty ? (
        <p role="世界地图详情区-召回撤空提示" className="text-[12px] leading-relaxed text-warn">
          {COPY.worldMap.recallWouldEmpty}
        </p>
      ) : null}
      <div className="flex-1" />
      <ConfirmButton
        role="世界地图详情区-撤回所选按钮"
        label={COPY.worldMap.recallSubmit}
        busy={busy}
        disabledReason={disabledReason}
        onClick={() => void run(recallPicked)}
      />
      <ConfirmButton
        role="世界地图详情区-全部撤回按钮"
        label={COPY.worldMap.recallAllSubmit}
        busy={busy}
        tone="warn"
        onClick={() => void run(() => world.recall(x, y))}
      />
    </div>
  );
}
