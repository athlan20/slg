// 计谋的文字拼装（v86，AISLG-211）：名字、效果预览、持续时长、事件流与被施计警报的整句。
// 文案在 copy-stratagem*.ts；数值来自服务端下发的 preview / effect（与后端同一套公式）。

import { formatDurationText } from './format';
import { getCopy } from '../i18n/bundle';
import type { EventView } from './protocol-session';
import type { StratagemEffectPreview, StratagemKind, StratagemTargetView } from './protocol-stratagem';

/** 计谋名（按界面语言） */
export function stratagemName(kind: string): string {
  const { STRATAGEM_COPY } = getCopy();
  return (STRATAGEM_COPY.name as Record<string, string>)[kind] ?? kind;
}

/** 计谋令名 */
export function stratagemTokenName(kind: string): string {
  const { STRATAGEM_COPY } = getCopy();
  return (STRATAGEM_COPY.tokenName as Record<string, string>)[kind] ?? kind;
}

/** 效果一句话（按武将智力算好的 preview 直接拼，纯展示） */
export function stratagemEffectText(kind: StratagemKind, preview: StratagemEffectPreview | undefined): string {
  const { STRATAGEM_COPY } = getCopy();
  const effect = STRATAGEM_COPY.effect;
  if (!preview) {
    return '';
  }
  switch (kind) {
    case 'phantom_army': {
      const range = preview.multiplierPercent ?? [];
      return effect.multiplierRange(range[0] ?? 300, range[1] ?? 500);
    }
    case 'empty_fort': {
      const values = (preview.multiplierPercent ?? [10, 20, 30]).map((value) => `${value}%`).join(' / ');
      return effect.emptyFortRange(values);
    }
    case 'burn_granary':
      return effect.burnFood(preview.burnFoodPercent ?? 0);
    case 'loot_fire':
      return effect.protectionDown(preview.protectionDownPercent ?? 0);
    case 'ambush_all_sides':
      return effect.ambushMinutes(preview.ambushMinutes ?? 0);
    case 'golden_cicada':
      return effect.cicada(preview.returnFasterPercent ?? 0);
    case 'eight_gates':
      return effect.eightGates(preview.marchSlowerPercent ?? 0);
    default:
      return effect.spyTrail;
  }
}

/** 持续时长一句话（没持续期返回空串） */
export function stratagemDurationText(preview: StratagemEffectPreview | undefined): string {
  const { STRATAGEM_COPY } = getCopy();
  if (!preview?.durationMs) {
    return '';
  }
  const seconds = Math.max(0, Math.round(preview.durationMs / 1000));
  return `${STRATAGEM_COPY.panel.durationLabel}${formatDurationText(seconds)}`;
}

/** 确认框里「对方会不会收到警报」 */
export function stratagemAlertHint(canFail: boolean): string {
  const { STRATAGEM_COPY } = getCopy();
  return canFail ? STRATAGEM_COPY.panel.alertYes : STRATAGEM_COPY.panel.alertNo;
}

/** 成功率一句话（不会失败的计谋写「必定成功」） */
export function stratagemSuccessText(canFail: boolean, target: StratagemTargetView | null): string {
  const { STRATAGEM_COPY } = getCopy();
  if (!canFail) {
    return STRATAGEM_COPY.panel.alwaysSuccess;
  }
  // 还没拿到对目标的判定（未选目标 / 未带武将）时不编数字
  return target ? STRATAGEM_COPY.panel.successRate(target.successPercent) : '';
}

/** 事件流文案：stratagem_cast / stratagem_received；其余类型返回 null 交给 baseEventText */
export function stratagemEventText(view: EventView): string | null {
  if (view.type !== 'stratagem_cast' && view.type !== 'stratagem_received') {
    return null;
  }
  const { STRATAGEM_COPY } = getCopy();
  const detail = view.detail;
  const name = stratagemName(String(detail.stratagem ?? ''));
  const outcome = detail.success === true ? STRATAGEM_COPY.event.success : STRATAGEM_COPY.event.failure;
  if (view.type === 'stratagem_received') {
    const caster = detail.caster as { username?: string; heroName?: string } | undefined;
    return STRATAGEM_COPY.event.received(name, caster?.username ?? '', caster?.heroName ?? '', outcome);
  }
  const hero = String(detail.heroName ?? '');
  return STRATAGEM_COPY.event.cast(name, hero, eventTargetText(detail.target as Record<string, unknown> | undefined), outcome);
}

/** 事件 / 警报里的目标短语（城给名字与坐标，部队给坐标） */
export function eventTargetText(target: Record<string, unknown> | undefined): string {
  const { STRATAGEM_COPY } = getCopy();
  if (!target || target.kind === 'city') {
    return STRATAGEM_COPY.event.targetCity(String(target?.cityName ?? ''), Number(target?.x ?? 0), Number(target?.y ?? 0));
  }
  return STRATAGEM_COPY.event.targetMarch(Number(target.x ?? 0), Number(target.y ?? 0));
}
