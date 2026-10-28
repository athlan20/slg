/** 洛阳争夺面板（v79，AISLG-200）：占领者 / 争夺窗口 / 洛阳之主加成 / 政令发布。
 *  状态来自会话切片（GET_LUOYANG 每分钟刷新）；发布政令仅洛阳之主盟主可操作。 */

import { useEffect, useState } from 'react';
import { formatReportTime } from '../../api/format';
import { DECREE_KINDS, type DecreeKind } from '../../api/protocol';
import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';

export function LuoyangPanel() {
  const { session } = useGame();
  const { LUOYANG_COPY: L } = useCopy();
  const luoyang = session.luoyang;
  const state = luoyang.state;
  const [kind, setKind] = useState<DecreeKind>('recruit');

  useEffect(() => {
    void luoyang.fetchState();
  }, [luoyang.fetchState]);

  return (
    <div role="联盟-洛阳面板" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto text-[12.5px]">
      {state?.owner ? (
        <>
          <p className="text-gold">{L.owner(state.owner.username, state.owner.allianceName)}</p>
          <p className="text-dim">{L.durability(state.owner.durability)}</p>
          <p className="text-faint">{L.assist(state.assistCap)}</p>
        </>
      ) : (
        <p className="text-faint">{L.noOwner}</p>
      )}
      {state ? (
        <p className={state.windowOpen ? 'text-ok' : 'text-warn'}>
          {state.windowOpen ? L.windowOpen(formatReportTime(state.windowEndAt)) : L.windowClosed(formatReportTime(state.nextOpenAt))}
        </p>
      ) : null}
      {state ? <p className="text-accent">{L.bonus(state.bonusPercent)}</p> : null}

      <section role="联盟-洛阳-政令" className="flex flex-col gap-1 rounded border border-line-soft p-2">
        <h4 className="text-gold">{L.decree.title}</h4>
        {state?.decree ? (
          <p className="text-dim">{L.decree.active(L.decree.kinds[state.decree.kind], formatReportTime(state.decree.until))}</p>
        ) : (
          <p className="text-faint">{L.decree.none}</p>
        )}
        {state?.decreeNextAt ? <p className="text-faint">{L.decree.next(formatReportTime(state.decreeNextAt))}</p> : null}
        {state?.canPublishDecree ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as DecreeKind)}
              className="rounded border border-line bg-panel px-1.5 py-0.5 text-[12px]"
            >
              {DECREE_KINDS.map((item) => (
                <option key={item} value={item}>
                  {L.decree.kinds[item]}
                </option>
              ))}
            </select>
            <button
              type="button"
              role="联盟-洛阳-发布政令"
              disabled={luoyang.busy}
              onClick={() => void luoyang.publishDecree(kind)}
              className="cursor-pointer rounded border border-gold/60 px-2 py-0.5 text-gold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {L.decree.publish}
            </button>
          </div>
        ) : null}
        {luoyang.error ? (
          <p role="联盟-洛阳-错误" className="text-st-error" onClick={luoyang.clearError}>
            {luoyang.error}
          </p>
        ) : null}
        <p className="text-[11px] leading-relaxed text-faint">{L.decree.note}</p>
      </section>
    </div>
  );
}
