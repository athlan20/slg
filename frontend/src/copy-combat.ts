import type { HeroSpecialty, FormationKind } from './api/protocol-combat';
import { getLang } from './i18n/lang';

const SPECIALTY_NAMES: Record<HeroSpecialty, [string, string]> = {
  infantry: ['步兵统御', 'Infantry command'], ranged: ['远程指挥', 'Ranged command'],
  cavalry: ['骑兵突击', 'Cavalry command'], siege: ['攻城专精', 'Siege command'],
  assault: ['奋勇进攻', 'Assault'], defense: ['沉着坚守', 'Defense'],
};
const SPECIALTY_EFFECTS: Record<HeroSpecialty, [string, string]> = {
  infantry: ['提升义兵、长枪兵和刀盾兵的攻防', 'Improves militia, pikemen and swordsmen attack and defense'],
  ranged: ['提升弓箭兵和床弩的攻击', 'Improves archer and ballista attack'],
  cavalry: ['提升轻骑兵和铁骑兵的攻防', 'Improves light and heavy cavalry attack and defense'],
  siege: ['仅攻城战中提升床弩和冲车的攻防', 'Improves ballista and ram attack and defense during sieges only'],
  assault: ['提升战斗兵种的攻击', 'Improves combat troop attack'],
  defense: ['降低战斗兵种受到的伤害', 'Reduces damage taken by combat troops'],
};
const FORMATION_NAMES: Record<FormationKind, [string, string]> = {
  balanced: ['均衡：刀盾＋弓箭', 'Balanced: swordsmen + archers'],
  infantry: ['步兵：长枪＋刀盾', 'Infantry: pikemen + swordsmen'],
  ranged: ['远程：刀盾＋弓箭', 'Ranged: swordsmen + archers'],
  cavalry: ['突击：轻骑＋长枪', 'Cavalry: cavalry + pikemen'],
};

export function specialtyName(kind: HeroSpecialty): string {
  return SPECIALTY_NAMES[kind][getLang() === 'zh' ? 0 : 1];
}
export function specialtyEffect(kind: HeroSpecialty): string {
  return SPECIALTY_EFFECTS[kind][getLang() === 'zh' ? 0 : 1];
}
export function formationName(kind: FormationKind): string {
  return FORMATION_NAMES[kind][getLang() === 'zh' ? 0 : 1];
}
export function combatText(zh: string, en: string): string {
  return getLang() === 'zh' ? zh : en;
}

export function specialtyBonusText(bonus: { atkPercent: number; defPercent: number }, scale = 1): string {
  const attack = Math.round(bonus.atkPercent * scale * 10) / 10;
  const defense = Math.round(bonus.defPercent * scale * 10) / 10;
  return combatText(`攻击 +${attack}% · 减伤 ${defense}%`, `Attack +${attack}% · Damage reduction ${defense}%`);
}
