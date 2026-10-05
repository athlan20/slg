// 英文文案孪生（AISLG-137）：copy-hero.ts 的英文版；satisfies 校验结构与函数签名一致。
// 武将系统文案（v36，AISLG-114/115/116；与 copy.ts 分文件以控制单文件行数）

import { HERO_BONUS_CAP, HERO_COPY } from './copy-hero';
import type { ErrorCode } from './api/protocol';

/** 武将带兵加成上限（百分数）：镜像 backend/common/src/hero.ts 的 HERO_BONUS_CAP_PERCENT，仅用于说明文字 */
export const HERO_BONUS_CAP_EN = HERO_BONUS_CAP;

export const HERO_COPY_EN = {
  building: {
    name: 'Tavern',
    short: 'Ta',
    tag: 'Recruit',
    desc: 'One per city. Refreshes 3 hero candidates every 4 hours (the refresh interval scales with the global speed multiplier) — recruit them with gold. Account regular hero cap = highest Tavern level ÷ 2 (rounded up) + 1. Recruit and manage heroes in the "Heroes" panel on the left.',
    effect: (level: number, cap: number) => `Tavern Lv${level}: account regular hero cap ${cap} (famous heroes counted separately, max 3)`,
  },
  panel: {
    title: 'Heroes',
    meta: (normal: number, normalCap: number, famous: number, famousCap: number) =>
      `Regular ${normal}/${normalCap} · Famous ${famous}/${famousCap}`,
    hint: 'Heroes are shared across the account: bring 1 along on march / scout / intercept / transport tasks, or assign one as City Guard. Attributes only decide combat bonuses, and each bonus is capped at 20%.',
    loading: 'Loading heroes…',
    noTavern: 'This city has no Tavern yet: build one and it refreshes 3 hero candidates every 4 hours — recruit them with gold.',
    noHeroes: 'No heroes yet. Go recruit one from the Tavern candidates.',
  },
  candidates: {
    title: 'Tavern candidates',
    refreshAt: (clock: string) => `Next candidates refresh at ${clock}`,
    empty: 'All candidates in this batch are recruited — waiting for the next refresh',
    attrs: (lead: number, force: number, wit: number) => `Lead ${lead} · Force ${force} · Wit ${wit}`,
    cost: (gold: number) => `${gold} gold`,
    recruit: 'Recruit',
    recruiting: 'Recruiting…',
    needGold: (gold: number) => `Not enough gold (need ${gold})`,
    capReached: (cap: number) => `Regular hero cap reached (${cap}) — upgrade the Tavern to raise it`,
  },
  card: {
    famousTag: 'Famous',
    level: (level: number, max: number) => `Lv${level}/${max}`,
    exp: (exp: number, next: number) => (next > 0 ? `Exp ${exp}/${next}` : 'Max level'),
    attrs: (lead: number, force: number, wit: number) => `Leadership ${lead} · Force ${force} · Intelligence ${wit}`,
    bonus: (atk: number, def: number, leadCap: number) =>
      `Full-formation bonus: Attack +${atk}% · damage taken reduced by ${def}% (troops up to ${leadCap} get the full bonus, beyond that it scales down)`,
    salary: (gold: number) => `Salary ${gold} gold/h`,
    guardProd: (percent: number) => `City Guard output +${percent}%`,
    statusIdle: 'Idle',
    statusMarching: 'Marching with an army',
    statusGuard: (cityName: string) => `City Guard · ${cityName}`,
    statusArrears: 'Salary in arrears (auto-recovers once gold is paid; cannot march out meanwhile)',
    statusWounded: (clock: string) => `Wounded — cannot march out until ${clock}`,
    assignGuard: 'Assign as City Guard',
    removeGuard: 'Remove as City Guard',
    guardOther: "Reassign as this city's City Guard",
    dismiss: 'Dismiss',
    dismissConfirm: 'Confirm dismissal?',
    dismissFamousHint: 'Once dismissed, this Famous Hero returns to the server-wide obtainable pool and may be obtained by another player',
    cancel: 'Cancel',
    busy: 'Processing…',
    guardDenied: 'This hero is marching with an army and cannot serve as City Guard',
  },
  guard: {
    title: 'City Guard of this city',
    none: 'No City Guard assigned: defense battles gain attack and damage-reduction bonuses, and normally this city\'s four resource outputs gain +Intelligence × 0.1% (capped at 5%)',
    row: (name: string, atk: number, def: number, prod: number) =>
      `${name}: attack +${atk}% · damage taken reduced by ${def}% · output +${prod}%`,
  },
  famous: {
    title: 'Famous Hero ownership (unique server-wide)',
    toggleShow: 'Show',
    toggleHide: 'Hide',
    owner: (name: string) => `Owner: ${name}`,
    free: 'Not obtained yet',
  },
  picker: {
    label: 'Attached hero',
    none: 'No hero',
    option: (name: string, level: number, lead: number, force: number, wit: number) =>
      `${name} Lv${level} (Lead ${lead} Force ${force} Wit ${wit})`,
    unavailable: {
      wounded: 'Wounded',
      arrears: 'Salary arrears',
      busy: 'Away',
      guard: 'City Guard',
    },
    preview: (atk: number, def: number, scale: number) =>
      `Bonus: Attack +${atk}% · damage taken reduced by ${def}%${scale < 1 ? ` (formation exceeds the leadership cap, scaled down to ${Math.round(scale * 100)}%)` : ''}`,
    previewIdle: 'The actual bonus shows once the formation is chosen',
  },
  event: {
    recruited: (name: string, cost: number) => `Recruited hero ${name} (cost ${cost} gold)`,
    dismissed: (name: string) => `Dismissed hero ${name}`,
    arrears: (name: string) => `Hero ${name} is in salary arrears: not enough gold to pay the salary — cannot march out until it is paid`,
    wounded: (name: string, clock: string) => `Hero ${name} lost the battle while leading troops — wounded until ${clock}`,
    levelUp: (name: string, level: number) => `Hero ${name} reached Lv${level}`,
    granted: (name: string, source: string) => `Obtained Famous Hero ${name} (${source})`,
    guardAssigned: (name: string) => `Assigned ${name} as City Guard`,
    guardRemoved: () => 'Removed as City Guard',
    expSuffix: (name: string, gained: number, leveledTo: number | null) =>
      `; hero ${name} gained +${gained} exp${leveledTo ? `, reached Lv${leveledTo}` : ''}`,
    woundedSuffix: (name: string) => `; hero ${name} was wounded`,
  },
  report: {
    attackerHero: (name: string, lead: number, force: number, wit: number, atk: number, def: number) =>
      `Hero ${name} (Lead ${lead} Force ${force} Wit ${wit}): Attack +${atk}% · damage taken reduced by ${def}%`,
    defenderHero: (name: string, lead: number, force: number, wit: number, atk: number, def: number) =>
      `City Guard ${name} (Lead ${lead} Force ${force} Wit ${wit}): Attack +${atk}% · damage taken reduced by ${def}%`,
  },
  broadcast: {
    granted: (username: string, name: string, source: string) => `${username} obtained Famous Hero ${name} (${source})`,
  },
  errors: {
    fallback: 'Hero operation failed, please retry',
    byCode: {
      TAVERN_NOT_BUILT: 'This city has no Tavern yet — build one first',
      HERO_CANDIDATE_GONE: 'This candidate is no longer in the Tavern (already recruited or the list refreshed) — check the latest candidates',
      HERO_CAP_REACHED: 'Regular hero cap reached — dismiss one or upgrade the Tavern, then recruit again',
      HERO_NOT_FOUND: 'This hero was not found',
      HERO_BUSY: 'This hero is marching with another army',
      HERO_WOUNDED: 'This hero is wounded and cannot march out until recovered',
      HERO_ARREARS: 'This hero is in salary arrears — pay the owed gold before marching out',
      GUARD_ASSIGN_DENIED: 'This hero is serving as City Guard and cannot march out at the same time, or is marching with an army and cannot be assigned as City Guard',
    } as Partial<Record<ErrorCode, string>>,
  },
} satisfies typeof HERO_COPY;
