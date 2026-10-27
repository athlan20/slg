/** 联盟外交面板（v77，AISLG-195）：友盟 / 敌对名单、待处理邀请、发起邀请与宣布敌对。
 *  管理操作仅盟主 / 副盟主可见；权威判定在服务端。 */

import { useEffect, useMemo, useState } from 'react';
import { useCopy } from '../../i18n/bundle';
import type { AllianceSession } from '../../state/allianceSession';
import { isAllianceManager } from '../../state/allianceSession';
import type { GetAllianceResponseData } from '../../api/protocol';

export function AllianceDiplomacyPanel({
  alliance,
  state,
}: {
  alliance: AllianceSession;
  state: GetAllianceResponseData;
}) {
  const { ALLIANCE_COPY: COPY } = useCopy();
  const manager = isAllianceManager(state.myRole);
  const diplomacy = alliance.diplomacy;
  const [picked, setPicked] = useState('');

  // 打开外交页时补一次联盟列表（发起邀请 / 宣布敌对要选目标）
  useEffect(() => {
    if (manager) {
      void alliance.loadList();
    }
  }, [manager, alliance.loadList]);

  const candidates = useMemo(() => {
    const current = state.alliance?.id ?? '';
    const related = new Set([
      ...(diplomacy?.friends ?? []).map((item) => item.alliance.id),
      ...(diplomacy?.hostiles ?? []).map((item) => item.alliance.id),
    ]);
    return (alliance.list?.alliances ?? []).filter((item) => item.id !== current && !related.has(item.id));
  }, [alliance.list, diplomacy, state.alliance?.id]);

  const targetName = candidates.find((item) => item.id === picked)?.name ?? '';

  return (
    <div role="联盟-外交面板" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto text-[12.5px]">
      {manager ? (
        <div role="联盟-外交操作" className="flex shrink-0 flex-wrap items-center gap-1.5 rounded border border-line-soft bg-panel-2/40 px-2 py-1.5">
          <select
            role="联盟-外交目标"
            value={picked}
            onChange={(event) => setPicked(event.target.value)}
            className="min-w-0 max-w-[160px] rounded border border-line bg-panel px-1.5 py-0.5 text-[12px]"
          >
            <option value="">{COPY.diplomacy.pick}</option>
            {candidates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            role="联盟-外交-邀请按钮"
            disabled={!picked || alliance.busy}
            onClick={() => void alliance.inviteFriendly(picked).then((ok) => ok && setPicked(''))}
            className="cursor-pointer rounded border border-accent-dim bg-accent-soft px-2 py-0.5 text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {COPY.diplomacy.invite}
          </button>
          <button
            type="button"
            role="联盟-外交-宣布敌对"
            disabled={!picked || alliance.busy}
            onClick={() => void alliance.declareHostile(picked).then((ok) => ok && setPicked(''))}
            className="cursor-pointer rounded border border-st-error/60 px-2 py-0.5 text-st-error disabled:cursor-not-allowed disabled:opacity-50"
          >
            {COPY.diplomacy.declare}
          </button>
          {targetName ? <span className="truncate text-faint">{targetName}</span> : null}
        </div>
      ) : (
        <p className="shrink-0 text-faint">{COPY.diplomacy.managerOnly}</p>
      )}

      <p className="shrink-0 text-[11.5px] leading-relaxed text-faint">{COPY.diplomacy.note}</p>

      <section role="联盟-外交-友盟" className="flex shrink-0 flex-col gap-1">
        <h4 className="text-gold">
          {COPY.diplomacy.friends}（{diplomacy?.friends.length ?? 0}/{diplomacy?.limits.friends ?? 2}）
        </h4>
        {(diplomacy?.friends ?? []).length === 0 ? <p className="text-faint">{COPY.diplomacy.none}</p> : null}
        {(diplomacy?.friends ?? []).map((entry) => (
          <div key={entry.alliance.id} className="flex items-center justify-between gap-2 border-b border-line-soft py-0.5">
            <span className="min-w-0 truncate">
              {entry.alliance.name}
              <span className="ml-1.5 text-faint">({entry.alliance.memberCount})</span>
            </span>
            {manager ? (
              <button
                type="button"
                role="联盟-外交-解除友盟"
                disabled={alliance.busy}
                onClick={() => void alliance.endRelation(entry.alliance.id)}
                className="shrink-0 cursor-pointer text-faint hover:text-accent"
              >
                {COPY.diplomacy.end}
              </button>
            ) : null}
          </div>
        ))}
      </section>

      <section role="联盟-外交-敌对列表" className="flex shrink-0 flex-col gap-1">
        <h4 className="text-st-error">
          {COPY.diplomacy.hostiles}（{diplomacy?.hostiles.length ?? 0}/{diplomacy?.limits.hostiles ?? 5}）
        </h4>
        {(diplomacy?.hostiles ?? []).length === 0 ? <p className="text-faint">{COPY.diplomacy.none}</p> : null}
        {(diplomacy?.hostiles ?? []).map((entry) => (
          <div key={entry.alliance.id} className="flex items-center justify-between gap-2 border-b border-line-soft py-0.5">
            <span className="min-w-0 truncate">{entry.alliance.name}</span>
            {manager ? (
              <button
                type="button"
                role="联盟-外交-解除敌对"
                disabled={alliance.busy}
                onClick={() => void alliance.endRelation(entry.alliance.id)}
                className="shrink-0 cursor-pointer text-faint hover:text-accent"
              >
                {COPY.diplomacy.end}
              </button>
            ) : null}
          </div>
        ))}
      </section>

      <section role="联盟-外交-邀请列表" className="flex shrink-0 flex-col gap-1">
        <h4 className="text-accent">{COPY.diplomacy.invites}</h4>
        {(diplomacy?.invites ?? []).length === 0 ? <p className="text-faint">{COPY.diplomacy.none}</p> : null}
        {(diplomacy?.invites ?? []).map((invite) => (
          <div key={`${invite.direction}-${invite.id}`} className="flex items-center justify-between gap-2 border-b border-line-soft py-0.5">
            <span className="min-w-0 truncate">
              {invite.alliance.name}
              <span className="ml-1.5 text-faint">
                {invite.direction === 'sent' ? COPY.diplomacy.directionSent : COPY.diplomacy.directionReceived} · {invite.inviter.username}
              </span>
            </span>
            {manager && invite.direction === 'received' ? (
              <span className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  role="联盟-外交-同意"
                  disabled={alliance.busy}
                  onClick={() => void alliance.respondFriendly(invite.id, true)}
                  className="cursor-pointer text-accent"
                >
                  {COPY.diplomacy.accept}
                </button>
                <button
                  type="button"
                  role="联盟-外交-拒绝"
                  disabled={alliance.busy}
                  onClick={() => void alliance.respondFriendly(invite.id, false)}
                  className="cursor-pointer text-faint hover:text-st-error"
                >
                  {COPY.diplomacy.reject}
                </button>
              </span>
            ) : null}
          </div>
        ))}
      </section>
    </div>
  );
}