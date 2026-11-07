/** NPC 来袭预警弹窗（v23 AISLG-57 推送的前端消费，AISLG-66）：斥候发现 NPC 部队进发时立即弹出，
 *  展示目标 / 预计到达（倒计时）/ 兵力规模，留时间给玩家增援或撤退；「增援」直达处理页面。
 *  预警只给兵力估算区间（±20%），精确编成要等战斗结算的战报。顶栏警报胶囊可重新打开。
 */

import type { NpcAttackWarningPushData, TroopKind } from '../api/protocol';
import { formatClock, formatDurationText } from '../api/mapping';
import { useCopy } from '../i18n/bundle';
import { getLang } from '../i18n/lang';
import { tName } from '../i18n/names';
import { useNow } from '../state/useNow';
import { Modal } from './ui/Modal';
import { StratagemEntry } from './stratagem/StratagemEntry';

interface NpcWarningModalProps {
  warning: NpcAttackWarningPushData;
  onDismiss: () => void;
  /** 增援：主城被袭 → 去征兵；野地被袭 → 定位到地图上的目标 */
  onReinforce: () => void;
}

export function NpcWarningModal({ warning, onDismiss, onReinforce }: NpcWarningModalProps) {
  const copy = useCopy();
  const { COPY, ALLIANCE_COPY, DEFENSE_COPY, EXTRA_PANEL, EXTRA_MAP, TERRAIN_LABEL, WARN_COPY } = copy;
  // 到达倒计时本地推进；到点后战斗由服务端结算，战报推送随后到达
  const now = useNow(true);
  const secondsLeft = Math.max(0, Math.ceil((Date.parse(warning.arriveAt) - now) / 1000));
  const terrain = warning.terrain !== null && warning.terrain in TERRAIN_LABEL ? TERRAIN_LABEL[warning.terrain as keyof typeof TERRAIN_LABEL] : null;
  const isCity = warning.target === 'city';
  // v100（AISLG-240）：势力围攻用同一个弹窗，标题写明是哪一家、正文给出当前城防值
  const siege = warning.siege ?? null;
  const siegeName = siege ? (getLang() === 'en' ? siege.faction.nameEn : siege.faction.name) : '';
  // v100（AISLG-240）：势力范围内的普通袭击也把「NPC」换成势力名（如「南蛮来袭」）
  const raidName = !siege && warning.faction ? (getLang() === 'en' ? warning.faction.nameEn : warning.faction.name) : '';
  const title = siege
    ? EXTRA_MAP.faction.siege.warningTitle(siegeName)
    : raidName
      ? EXTRA_MAP.faction.siege.raidTitle(raidName)
      : warning.attacker
        ? COPY.npcWarning.titlePlayer
        : COPY.npcWarning.title;

  return (
    <Modal role="NPC来袭预警弹窗" title={<span className="text-warn">{title}</span>} size="sm" accent="warn" onClose={onDismiss}>
      <div role="NPC来袭预警弹窗-详情" className="flex flex-col gap-1 font-mono text-[13px] text-dim">
        <p>
          {COPY.npcWarning.targetLabel}
          {siege
            ? EXTRA_MAP.faction.siege.targetBranch
            : isCity
              ? COPY.npcWarning.targetCity
              : COPY.npcWarning.targetWild(warning.x, warning.y, terrain ?? '', warning.level)}
          {siege?.cityName ? <span className="ml-1 text-dim">{tName(siege.cityName)}</span> : null}
        </p>
        {siege ? (
          <p role="NPC来袭预警弹窗-城防值" className="text-warn">
            {EXTRA_MAP.faction.siege.durabilityLine(String(siege.durability))}
          </p>
        ) : null}
        {raidName ? (
          <p role="NPC来袭预警弹窗-势力旗号" className="text-warn">
            {EXTRA_MAP.faction.siege.raidFrom(raidName, warning.lair?.x ?? 0, warning.lair?.y ?? 0)}
          </p>
        ) : null}
        {warning.attacker ? (
          <p role="NPC来袭预警弹窗-进攻方">
            {COPY.npcWarning.attackerLabel}
            {COPY.npcWarning.attackerRow(warning.attacker.username, tName(warning.attacker.cityName))}
          </p>
        ) : null}
        {warning.hostileAlliance ? (
          <p role="NPC来袭预警弹窗-敌对联盟" className="text-st-error">
            {ALLIANCE_COPY.diplomacy.hostileWarning(warning.hostileAlliance.name)}
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
        {siege
          ? EXTRA_MAP.faction.siege.advice
          : warning.attacker
            ? COPY.npcWarning.advicePlayer
            : isCity
              ? COPY.npcWarning.adviceCity
              : COPY.npcWarning.adviceWild}
      </p>

      <div className="flex flex-wrap justify-end gap-2">
        {/* v86（AISLG-211）：八门金锁快捷入口——把这支敌军的行军时间拖长（玩家出征或 NPC 袭击都能挡） */}
        {/* 围攻的 attackId 是围攻编号，不是真实袭击，八门金锁拖不了，不给入口 */}
        {siege ? null : (
          <StratagemEntry
            role="NPC来袭预警弹窗-八门金锁按钮"
            label={copy.STRATAGEM_COPY.entry.eightGates}
            target={{
              // 玩家来袭的预警把行军 id 放在 attackId 里（去重口径），NPC 袭击才是真正的 attackId
              ...(warning.attacker ? { marchId: warning.attackId } : { attackId: warning.attackId }),
              label: `(${warning.x},${warning.y})`,
              only: ['eight_gates'],
            }}
            className="btn px-3"
          />
        )}
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
