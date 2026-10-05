// 世界地块面板的展示辅助（从 WorldDetailPanel 拆出以控制单文件行数）：
// 驻军行、行军标签 / 剩余秒、掠夺冷却剩余的人读拼装，不含状态与请求逻辑。

import { PLUNDER_COOLDOWN_HOURS, TROOP_KINDS, type MarchView, type TroopKind } from '../api/protocol';
import { getCopy } from '../i18n/bundle';

/** 非零驻军行（详情与 NPC 情报共用） */
export function armyRows(army: Record<TroopKind, number>) {
  const { TROOP_LABEL } = getCopy();
  return TROOP_KINDS.filter((kind) => army[kind] > 0).map((kind) => (
    <span key={kind} className="text-dim">
      {TROOP_LABEL[kind].name}×{army[kind]}
    </span>
  ));
}

export function marchSecondsLeft(march: MarchView, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(march.arriveAt) - now) / 1000));
}

/** 行军人读标签；截击埋伏中（v35 AISLG-112，now ≥ ambushAt）显示「埋伏中」变体 */
export function marchLabel(march: MarchView, now: number = Date.now()): string {
  // 非组件辅助：体内取当前语言文案包（模块顶层严禁取）
  const { COPY, CITY_COPY, MOVING_COPY } = getCopy();
  if (march.purpose === 'scout') {
    return COPY.worldMap.marchScout(march.x, march.y);
  }
  if (march.purpose === 'transfer') {
    return COPY.worldMap.marchTransfer(march.x, march.y);
  }
  if (march.purpose === 'intercept') {
    if (march.ambushAt !== null && now >= Date.parse(march.ambushAt)) {
      return MOVING_COPY.march.ambushLabel(march.x, march.y);
    }
    return MOVING_COPY.march.label(march.x, march.y);
  }
  if (march.purpose === 'transport') {
    return CITY_COPY.transport.marchLabel(march.x, march.y);
  }
  if (march.purpose === 'plunder') {
    return COPY.worldMap.marchPlunder(march.x, march.y);
  }
  if (march.purpose === 'occupy') {
    return COPY.worldMap.marchOccupy(march.x, march.y);
  }
  if (march.purpose === 'reinforce') {
    return COPY.worldMap.marchReinforce(march.x, march.y);
  }
  return march.purpose === 'return'
    ? COPY.worldMap.marchReturn(march.x, march.y)
    : COPY.worldMap.marchAttack(march.x, march.y);
}

/** 掠夺冷却剩余（v16；v20 起窗口随全局时间缩放 ÷ timeScale，与 CityView 同步下发）：人读剩余时长；否则 null */
/** 对方城池 / 野地保护状态的剩余文本（v38 / v39）：任一截止未到即返回对应提示 */
export function protectionLeftText(
  protection: { newbieUntil: string | null; truceUntil: string | null; shieldUntil: string | null; ownerChangedUntil?: string | null } | null,
  now: number,
): string | null {
  if (!protection) {
    return null;
  }
  const { COPY, EXTRA_MAP } = getCopy();
  const format = (iso: string | null): string | null => {
    if (!iso) {
      return null;
    }
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts) || ts <= now) {
      return null;
    }
    const remainingMs = ts - now;
    const hours = Math.floor(remainingMs / (60 * 60 * 1000));
    const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
    return hours > 0 ? EXTRA_MAP.duration.hm(hours, minutes) : EXTRA_MAP.duration.m(minutes);
  };
  const newbie = format(protection.newbieUntil);
  if (newbie) {
    return COPY.worldMap.protectionNewbie(newbie);
  }
  const shield = format(protection.shieldUntil);
  if (shield) {
    return COPY.worldMap.protectionShield(shield);
  }
  const truce = format(protection.truceUntil);
  if (truce) {
    return COPY.worldMap.protectionTruce(truce);
  }
  const ownerChanged = format(protection.ownerChangedUntil ?? null);
  if (ownerChanged) {
    return COPY.worldMap.protectionOwnerChanged(ownerChanged);
  }
  return null;
}

export function plunderCooldownLeft(plunderedAt: string | null, now: number, timeScale: number): string | null {
  if (!plunderedAt) {
    return null;
  }
  const ts = Date.parse(plunderedAt);
  if (!Number.isFinite(ts)) {
    return null;
  }
  const cooldownMs = (PLUNDER_COOLDOWN_HOURS * 60 * 60 * 1000) / Math.max(1, timeScale);
  const remainingMs = ts + cooldownMs - now;
  if (remainingMs <= 0) {
    return null;
  }
  const { EXTRA_MAP } = getCopy();
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
  return hours > 0 ? EXTRA_MAP.duration.hm(hours, minutes) : EXTRA_MAP.duration.m(minutes);
}
