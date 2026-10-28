/** 地图页右侧「选中目标详情与就地操作」（取代原地块详情弹窗，docs/frontend-nav-layout.md 第 5 / 7 节）：
 *  标题 / 要点 / 补充说明 → 操作页签（按目标类型：掠夺·占领·侦察 / 清剿·侦察 / 截击 / 增援·撤回驻军 / 调兵·运输）→
 *  编队表单 + 判断条 + 确认大按钮。所有会改变游戏状态的操作都在这里就地完成，不弹窗。
 *  出征 / 侦察 / 撤回的动作与会话切片 worldSession 对接；权威状态随按需查询对齐。
 */

import { useEffect, useMemo, useState } from 'react';
import { TROOP_KINDS, type AssistView } from '../../api/protocol';
import { DeployContext } from '../../state/deployContext';
import { useGame } from '../../state/GameContext';
import { useHeroPick } from '../../state/heroContext';
import { interceptCandidates } from '../../state/interceptPlan';
import { useNow } from '../../state/useNow';
import { tName } from '../../i18n/names';
import { getCopy, useCopy } from '../../i18n/bundle';
// role 定位值取静态中文文案源（AISLG-137 约定：role 不随界面语言变）
import { TARGET_COPY as TARGET_COPY_ZH } from '../../copy-pages';
import { ALLIANCE_COPY as ALLIANCE_COPY_ZH } from '../../copy-alliance';
import { InterceptForm } from './forms/InterceptForm';
import { MarchForm } from './forms/MarchForm';
import { MarkForm } from './forms/MarkForm';
import { RecallForm } from './forms/RecallForm';
import { ScoutForm } from './forms/ScoutForm';
import { TransportForm } from './forms/TransportForm';
import type { TargetCtx, TroopInput } from './forms/targetTypes';
import { TargetHeader } from './TargetHeader';
import { TargetChatActions } from './TargetChatActions';
import { TargetMarkNote } from './TargetMarkNote';

type Act = 'plunder' | 'occupy' | 'scout' | 'clear' | 'intercept' | 'reinforce' | 'recall' | 'transfer' | 'transport' | 'mark' | 'assist';

/** 攻击类操作（AISLG-182 / F2）：目标是盟友时禁用，运输 / 增援 / 调兵 / 截击不受影响 */
const ATTACK_ACTS: readonly Act[] = ['plunder', 'occupy', 'scout', 'clear'];

export function TargetPanel() {
  const copy = useCopy();
  const { TARGET_COPY, ALLIANCE_COPY, DEFENSE_COPY } = copy;
  const { session, marchOrigin } = useGame();
  const { world, city } = session;
  const branch = session.cityList.branch;
  const hero = useHeroPick();
  const selected = world.selected;
  const detail = world.detail;
  const accountId = session.account?.accountId ?? null;
  const [troops, setTroops] = useState<TroopInput>({});
  const [act, setAct] = useState<Act | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(true);

  // 切换选中地块时清空编队与页签（任务重置为缺省）
  useEffect(() => {
    setTroops({});
    setAct(null);
  }, [selected?.x, selected?.y]);

  const candidates = useMemo(
    () => (selected ? interceptCandidates(session.moving.targets, selected.x, selected.y, now) : []),
    [session.moving.targets, selected, now],
  );

  if (!selected || !city) {
    return null;
  }
  const { x, y } = selected;
  const isOwn = detail !== null && detail.owner !== null && detail.owner.accountId === accountId;
  const isOwnCity = detail?.kind === 'city' && isOwn;
  /** 调兵 / 运输目标：本账号的分城（非出发主城） */
  const transferable = isOwnCity && detail?.owner?.cityId !== city.id;
  /** 盟友的城池 / 野地（AISLG-182 / F2）：攻击类操作禁用并说明原因 */
  const allyBlocked =
    detail?.owner?.relation === 'ally' || detail?.owner?.relation === 'friendly' || detail?.owner?.ally === true;
  /** 有联盟才能打标记（AISLG-184 / F2） */
  const inAlliance = session.alliance.state?.alliance != null;

  const acts: Act[] = [];
  if (detail) {
    if (candidates.length > 0) {
      acts.push('intercept');
    }
    if (detail.kind === 'npc_city') {
      acts.push('plunder', 'occupy', 'scout');
    } else if (detail.kind === 'wilderness') {
      if (detail.owner === null) {
        acts.push(...(detail.camp ? (['clear', 'scout'] as const) : (['plunder', 'occupy', 'scout'] as const)));
      } else if (isOwn) {
        acts.push('reinforce', 'recall');
      } else {
        // 他人占领的野地（v39 AISLG-123）：只能抢占，不能掠夺
        acts.push('occupy', 'scout');
      }
    } else if (isOwnCity) {
      if (transferable) {
        acts.push('transfer', 'transport');
      }
    } else if (detail.kind === 'city' && detail.owner !== null) {
      // v74（AISLG-194）：盟友的城只能协防（掠夺 / 占领 / 侦察在 ATTACK_ACTS 里禁用）
      if (allyBlocked) {
        acts.push('assist');
      } else {
        // 他人玩家城（v38 AISLG-122）：可掠夺；分城（v40 AISLG-124，城防值非 null）另可攻占，主城不可占
        acts.push(...(detail.durability != null ? (['plunder', 'occupy', 'scout'] as const) : (['plunder', 'scout'] as const)));
      }
    } else {
      acts.push('scout');
    }
    if (inAlliance) {
      acts.push('mark');
    }
  }
  const current: Act | null = act && acts.includes(act) ? act : (acts[0] ?? null);
  const blockedNow = allyBlocked && current !== null && ATTACK_ACTS.includes(current);

  const ctx: TargetCtx = {
    world,
    city,
    x,
    y,
    detail,
    origin: marchOrigin,
    branch,
    hero,
    now,
    troops,
    setTroops,
    busy,
    run: async (action) => {
      if (busy) {
        return;
      }
      setBusy(true);
      try {
        await action();
      } finally {
        setBusy(false);
      }
    },
  };

  return (
    <DeployContext.Provider value={city.deploy}>
      <div role="世界地图详情区" className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
        <TargetHeader
          world={world}
          city={city}
          x={x}
          y={y}
          detail={detail}
          origin={marchOrigin}
          branch={branch}
          now={now}
          mover={candidates[0]?.target.kind ?? null}
          isOwnCity={isOwnCity}
          onClose={world.deselectTile}
        />
        <TargetChatActions x={x} y={y} detail={detail} accountId={accountId} />
        {detail?.assists && detail.assists.length > 0 ? (
          <div role="选中详情-协防列表" className="flex max-h-[4.5rem] shrink-0 flex-col gap-0.5 overflow-hidden rounded border border-line-soft bg-panel-2 px-2 py-1">
            <span className="text-[11px] font-semibold text-faint" title={DEFENSE_COPY.assist.capHint(5)}>
              {DEFENSE_COPY.assist.inTitle} · {detail.assists.length}
            </span>
            {detail.assists.slice(0, 2).map((item) => (
              <span key={item.id} role="选中详情-协防条目" className="truncate text-[11px] text-dim" title={DEFENSE_COPY.assist.inLine(item.username, tName(item.fromCityName))}>
                {DEFENSE_COPY.assist.inLine(item.username, tName(item.fromCityName))} · {assistTroops(item)}
              </span>
            ))}
          </div>
        ) : null}
        {inAlliance ? <TargetMarkNote x={x} y={y} marks={session.allianceMarks} myId={accountId} now={now} /> : null}
        {world.error ? (
          <p role="世界地图详情区-错误" className="line-clamp-2 shrink-0 text-[12px] text-warn" title={world.error}>
            {world.error}
          </p>
        ) : null}
        {detail && acts.length > 0 && current ? (
          <>
            <div role="选中详情-操作类型" className="flex shrink-0 flex-wrap gap-1">
              {acts.map((item) => {
                const blocked = allyBlocked && ATTACK_ACTS.includes(item);
                return (
                  <button
                    key={item}
                    type="button"
                    role={`选中详情-操作-${item === 'mark' ? ALLIANCE_COPY_ZH.marks.formTitle : TARGET_COPY_ZH.actions[item]}`}
                    aria-pressed={item === current}
                    disabled={blocked}
                    title={blocked ? ALLIANCE_COPY.ally.blockedShort : undefined}
                    onClick={() => setAct(item)}
                    className={`cursor-pointer rounded border px-2.5 py-0.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-40 ${
                      item === current ? 'border-accent bg-accent-soft text-accent' : 'border-line text-dim hover:text-fg'
                    }`}
                  >
                    {item === 'mark' ? ALLIANCE_COPY.marks.formTitle : TARGET_COPY.actions[item]}
                  </button>
                );
              })}
            </div>
            {blockedNow ? (
              <p role="选中详情-盟友提示" className="text-[12px] leading-relaxed text-st-online">
                {ALLIANCE_COPY.ally.blocked}
              </p>
            ) : null}
            {detail?.owner?.relation === 'hostile' ? (
              <p role="选中详情-敌对提示" className="text-[12px] leading-relaxed text-st-error">
                {ALLIANCE_COPY.diplomacy.hostiles}
              </p>
            ) : null}
            {!blockedNow && current === 'scout' ? <ScoutForm key={`${x},${y}`} ctx={ctx} /> : null}
            {!blockedNow && current === 'intercept' ? <InterceptForm ctx={ctx} candidates={candidates} onPickCell={world.selectTile} /> : null}
            {!blockedNow && current === 'transport' ? <TransportForm key={`${x},${y}`} ctx={ctx} /> : null}
            {!blockedNow && current === 'recall' ? <RecallForm key={`${x},${y}`} ctx={ctx} /> : null}
            {!blockedNow && current === 'mark' ? (
              <MarkForm
                key={`${x},${y}`}
                x={x}
                y={y}
                marks={session.allianceMarks}
                hasMark={session.allianceMarks.marks.some((item) => item.x === x && item.y === y && Date.parse(item.expiresAt) > now)}
              />
            ) : null}
            {!blockedNow && (current === 'plunder' || current === 'occupy' || current === 'clear' || current === 'reinforce' || current === 'transfer' || current === 'assist') ? (
              <MarchForm ctx={ctx} act={current} />
            ) : null}
          </>
        ) : detail ? (
          <p className="text-[12px] text-faint">{isOwnCity ? TARGET_COPY.ownCityHere : TARGET_COPY.noOps}</p>
        ) : null}
      </div>
    </DeployContext.Provider>
  );
}


/** 协防编成的紧凑写法（兵种简称 + 数量） */
function assistTroops(view: AssistView): string {
  const { TROOP_LABEL } = getCopy();
  return TROOP_KINDS.filter((kind) => (view.troops[kind] ?? 0) > 0)
    .map((kind) => `${TROOP_LABEL[kind].short}${view.troops[kind]}`)
    .join(' ') || '—';
}
