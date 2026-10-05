/** 地图页右侧「选中目标详情与就地操作」（取代原地块详情弹窗，docs/frontend-nav-layout.md 第 5 / 7 节）：
 *  标题 / 要点 / 补充说明 → 操作页签（按目标类型：掠夺·占领·侦察 / 清剿·侦察 / 截击 / 增援·撤回驻军 / 调兵·运输）→
 *  编队表单 + 判断条 + 确认大按钮。所有会改变游戏状态的操作都在这里就地完成，不弹窗。
 *  出征 / 侦察 / 撤回的动作与会话切片 worldSession 对接；权威状态随按需查询对齐。
 */

import { useEffect, useMemo, useState } from 'react';
import { DeployContext } from '../../state/deployContext';
import { useGame } from '../../state/GameContext';
import { useHeroPick } from '../../state/heroContext';
import { interceptCandidates } from '../../state/interceptPlan';
import { useNow } from '../../state/useNow';
import { useCopy } from '../../i18n/bundle';
// role 定位值取静态中文文案源（AISLG-137 约定：role 不随界面语言变）
import { TARGET_COPY as TARGET_COPY_ZH } from '../../copy-pages';
import { InterceptForm } from './forms/InterceptForm';
import { MarchForm } from './forms/MarchForm';
import { RecallForm } from './forms/RecallForm';
import { ScoutForm } from './forms/ScoutForm';
import { TransportForm } from './forms/TransportForm';
import type { TargetCtx, TroopInput } from './forms/targetTypes';
import { TargetHeader } from './TargetHeader';

type Act = 'plunder' | 'occupy' | 'scout' | 'clear' | 'intercept' | 'reinforce' | 'recall' | 'transfer' | 'transport';

export function TargetPanel() {
  const copy = useCopy();
  const { TARGET_COPY } = copy;
  const { session, marchOrigin } = useGame();
  const { world, city } = session;
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
      // 他人玩家城（v38 AISLG-122）：可掠夺；分城（v40 AISLG-124，城防值非 null）另可攻占，主城不可占
      acts.push(...(detail.durability != null ? (['plunder', 'occupy', 'scout'] as const) : (['plunder', 'scout'] as const)));
    } else {
      acts.push('scout');
    }
  }
  const current: Act | null = act && acts.includes(act) ? act : (acts[0] ?? null);

  const ctx: TargetCtx = {
    world,
    city,
    x,
    y,
    detail,
    origin: marchOrigin,
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
          now={now}
          mover={candidates[0]?.target.kind ?? null}
          isOwnCity={isOwnCity}
          onClose={world.deselectTile}
        />
        {world.error ? (
          <p role="世界地图详情区-错误" className="line-clamp-2 shrink-0 text-[12px] text-warn" title={world.error}>
            {world.error}
          </p>
        ) : null}
        {detail && acts.length > 0 && current ? (
          <>
            <div role="选中详情-操作类型" className="flex shrink-0 flex-wrap gap-1">
              {acts.map((item) => (
                <button
                  key={item}
                  type="button"
                  role={`选中详情-操作-${TARGET_COPY_ZH.actions[item]}`}
                  aria-pressed={item === current}
                  onClick={() => setAct(item)}
                  className={`cursor-pointer rounded border px-2.5 py-0.5 text-[12px] ${
                    item === current ? 'border-accent bg-accent-soft text-accent' : 'border-line text-dim hover:text-fg'
                  }`}
                >
                  {TARGET_COPY.actions[item]}
                </button>
              ))}
            </div>
            {current === 'scout' ? <ScoutForm key={`${x},${y}`} ctx={ctx} /> : null}
            {current === 'intercept' ? <InterceptForm ctx={ctx} candidates={candidates} onPickCell={world.selectTile} /> : null}
            {current === 'transport' ? <TransportForm key={`${x},${y}`} ctx={ctx} /> : null}
            {current === 'recall' ? <RecallForm ctx={ctx} /> : null}
            {current === 'plunder' || current === 'occupy' || current === 'clear' || current === 'reinforce' || current === 'transfer' ? (
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
