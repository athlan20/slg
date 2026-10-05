/** NPC 来袭预警弹窗（v23 AISLG-57 推送的前端消费，AISLG-66）：斥候发现 NPC 部队进发时立即弹出，
 *  展示目标 / 预计到达（倒计时）/ 兵力规模，留时间给玩家增援或撤退；「增援」直达处理页面。
 *  预警只给兵力估算区间（±20%），精确编成要等战斗结算的战报。顶栏警报胶囊可重新打开。
 */

import type { NpcAttackWarningPushData, TroopKind } from '../api/protocol';
import { formatClock, formatDurationText } from '../api/mapping';
import { useCopy } from '../i18n/bundle';
import { tName } from '../i18n/names';
import { useNow } from '../state/useNow';
import { Modal } from './ui/Modal';

interface NpcWarningModalProps {
  warning: NpcAttackWarningPushData;
  onDismiss: () => void;
  /** 增援：主城被袭 → 去征兵；野地被袭 → 定位到地图上的目标 */
  onReinforce: () => void;
}

export function NpcWarningModal({ warning, onDismiss, onReinforce }: NpcWarningModalProps) {
  const copy = useCopy();
  const { COPY, DEFENSE_COPY, EXTRA_PANEL, TERRAIN_LABEL, WARN_COPY } = copy;
  // 到达倒计时本地推进；到点后战斗由服务端结算，战报推送随后到达
  const now = useNow(true);
  const secondsLeft = Math.max(0, Math.ceil((Date.parse(warning.arriveAt) - now) / 1000));
  const terrain = warning.terrain !== null && warning.terrain in TERRAIN_LABEL ? TERRAIN_LABEL[warning.terrain as keyof typeof TERRAIN_LABEL] : null;
  const isCity = warning.target === 'city';

  return (
    <Modal role="NPC来袭预警弹窗" title={<span className="text-warn">{warning.attacker ? COPY.npcWarning.titlePlayer : COPY.npcWarning.title}</span>} size="sm" accent="warn" onClose={onDismiss}>
      <div role="NPC来袭预警弹窗-详情" className="flex flex-col gap-1 font-mono text-[13px] text-dim">
        <p>
          {COPY.npcWarning.targetLabel}
          {isCity ? COPY.npcWarning.targetCity : COPY.npcWarning.targetWild(warning.x, warning.y, terrain ?? '', warning.level)}
        </p>
        {warning.attacker ? (
          <p role="NPC来袭预警弹窗-进攻方">
            {COPY.npcWarning.attackerLabel}
            {COPY.npcWarning.attackerRow(warning.attacker.username, tName(warning.attacker.cityName))}
          </p>
        ) : null}
        <p>
          {COPY.npcWarning.arriveLabel}
          <span className="text-warn">{formatClock(warning.arriveAt)}</span>
          {COPY.npcWarning.arriveLeft(formatDurationText(secondsLeft))}
        </p>
        <p>
          {COPY.npcWarning.armyLabel}
          {warning.armyMin}–{warning.armyMax}
          <span className="ml-1 text-faint">{COPY.npcWarning.armyNote}</span>
        </p>
        {warning.intel === 'kinds' && warning.armyKinds ? (
          <p role="NPC来袭预警弹窗-兵种估算">
            {DEFENSE_COPY.warning.kindsLabel}
            {(Object.entries(warning.armyKinds) as Array<[TroopKind, { min: number; max: number }]>).map(([kind, range]) => DEFENSE_COPY.warning.kindRange(kind, range.min, range.max)).join(EXTRA_PANEL.joiners.enum)}
            <span className="ml-1 text-faint">{EXTRA_PANEL.joiners.paren(DEFENSE_COPY.warning.beaconNote(warning.beaconLevel ?? 0))}</span>
          </p>
        ) : null}
        {warning.intel === 'exact' && warning.army ? (
          <p role="NPC来袭预警弹窗-精确编成">
            {DEFENSE_COPY.warning.exactLabel}
            {(Object.entries(warning.army) as Array<[TroopKind, number]>).map(([kind, count]) => DEFENSE_COPY.warning.exactRow(kind, count)).join(EXTRA_PANEL.joiners.enum)}
            <span className="ml-1 text-faint">{EXTRA_PANEL.joiners.paren(DEFENSE_COPY.warning.beaconNote(warning.beaconLevel ?? 0))}</span>
          </p>
        ) : null}
      </div>

      <p role="NPC来袭预警弹窗-建议" className="rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-[12px] leading-relaxed text-dim">
        {warning.attacker ? COPY.npcWarning.advicePlayer : isCity ? COPY.npcWarning.adviceCity : COPY.npcWarning.adviceWild}
      </p>

      <div className="flex justify-end gap-2">
        <button type="button" role="NPC来袭预警弹窗-增援按钮" className="btn px-3" onClick={onReinforce}>
          {isCity ? WARN_COPY.reinforceCity : WARN_COPY.reinforceWild}
        </button>
        <button type="button" role="NPC来袭预警弹窗-确认按钮" className="btn px-3" onClick={onDismiss}>
          {COPY.npcWarning.acknowledge}
        </button>
      </div>
    </Modal>
  );
}
