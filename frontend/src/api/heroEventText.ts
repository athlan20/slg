// 武将事件的文案拼装（v36 AISLG-114/115/116，从 mapping.ts 拆出以控制单文件行数）

import type { EventView } from './protocol';
import type { HeroExpDetail } from './protocol-hero';
import { formatClock } from './format';
import { HERO_COPY } from '../copy-hero';

/** 武将相关事件文案（v36 AISLG-114/115/116）；非武将事件返回 null */
export function heroEventText(view: EventView): string | null {
  const d = view.detail;
  const name = String(d.heroName ?? d.name ?? '武将');
  switch (view.type) {
    case 'hero_recruited':
      return HERO_COPY.event.recruited(name, Number(d.cost ?? 0));
    case 'hero_dismissed':
      return HERO_COPY.event.dismissed(name);
    case 'hero_arrears':
      return HERO_COPY.event.arrears(name);
    case 'hero_wounded':
      return HERO_COPY.event.wounded(name, formatClock(String(d.woundedUntil ?? '')));
    case 'hero_level_up':
      return HERO_COPY.event.levelUp(name, Number(d.level ?? d.leveledTo ?? 0));
    case 'hero_granted':
      return HERO_COPY.event.granted(name, String(d.source ?? ''));
    case 'guard_changed':
      return d.heroId ? HERO_COPY.event.guardAssigned(name) : HERO_COPY.event.guardRemoved();
    default:
      return null;
  }
}

/** 行军 / 战斗事件后追加的武将经验与重伤信息（march_completed.detail.heroExp） */
export function heroExpSuffix(view: EventView): string {
  const exp = view.detail.heroExp as HeroExpDetail | undefined;
  if (view.type !== 'march_completed' || !exp) {
    return '';
  }
  return (
    HERO_COPY.event.expSuffix(exp.heroName, exp.expGained, exp.leveledTo) +
    (exp.woundedUntil ? HERO_COPY.event.woundedSuffix(exp.heroName) : '')
  );
}
