// 武将事件的文案拼装（v36 AISLG-114/115/116，从 mapping.ts 拆出以控制单文件行数）
// 文案按界面语言取用（AISLG-137）：函数体内经 getCopy() 取当前语言包；武将名是后端
// 固定词，英文界面经 tName 按码表翻译（zh 下原样返回）。

import type { EventView } from './protocol';
import type { HeroExpDetail } from './protocol-hero';
import { formatClock } from './format';
import { getCopy } from '../i18n/bundle';
import { tName, tHeroSource } from '../i18n/names';

/** 武将相关事件文案（v36 AISLG-114/115/116）；非武将事件返回 null */
export function heroEventText(view: EventView): string | null {
  const { HERO_COPY, EXTRA_STATE } = getCopy();
  const d = view.detail;
  const name = tName(String(d.heroName ?? d.name ?? EXTRA_STATE.hero.nameFallback));
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
      // 来源标签（首占名城 / 黄巾老巢首杀 / 贡献榜名次）经 tHeroSource 翻译
      return HERO_COPY.event.granted(name, tHeroSource(String(d.source ?? '')));
    case 'guard_changed':
      return d.heroId ? HERO_COPY.event.guardAssigned(name) : HERO_COPY.event.guardRemoved();
    default:
      return null;
  }
}

/** 行军 / 战斗事件后追加的武将经验与重伤信息（march_completed.detail.heroExp） */
export function heroExpSuffix(view: EventView): string {
  const { HERO_COPY } = getCopy();
  const exp = view.detail.heroExp as HeroExpDetail | undefined;
  if (view.type !== 'march_completed' || !exp) {
    return '';
  }
  return (
    HERO_COPY.event.expSuffix(tName(exp.heroName), exp.expGained, exp.leveledTo) +
    (exp.woundedUntil ? HERO_COPY.event.woundedSuffix(tName(exp.heroName)) : '')
  );
}
