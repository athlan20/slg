// 武将系统文案（v36，AISLG-114/115/116；与 copy.ts 分文件以控制单文件行数）

import type { ErrorCode } from './api/protocol';

/** 武将带兵加成上限（百分数）：镜像 backend/common/src/hero.ts 的 HERO_BONUS_CAP_PERCENT，仅用于说明文字 */
export const HERO_BONUS_CAP = 20;

export const HERO_COPY = {
  building: {
    name: '酒馆',
    short: '酒',
    tag: '招将',
    desc: '每城限一座。每 4 小时刷新 3 名候选将领（刷新周期随全局倍速缩放），花金币招募；账号普通将上限 = 酒馆最高等级 ÷ 2（向上取整）+ 1。招募与管理在左侧「武将」面板。',
    effect: (level: number, cap: number) => `酒馆 Lv${level}：账号普通将上限 ${cap} 名（名将另算，最多 3 名）`,
  },
  panel: {
    title: '武将',
    meta: (normal: number, normalCap: number, famous: number, famousCap: number) =>
      `普通将 ${normal}/${normalCap} · 名将 ${famous}/${famousCap}`,
    hint: '武将账号共享：出征 / 侦察 / 截击 / 运输时可带 1 名；也可任命为城守。属性只决定战斗加成，且加成各自封顶 20%。',
    loading: '正在读取武将…',
    noTavern: '本城还没有酒馆：建造酒馆后每 4 小时刷新 3 名候选将领，花金币招募。',
    noHeroes: '还没有武将。到酒馆候选里招募一名吧。',
  },
  candidates: {
    title: '酒馆候选',
    refreshAt: (clock: string) => `下一批候选 ${clock} 刷新`,
    empty: '本批候选已招完，等待下一批刷新',
    attrs: (lead: number, force: number, wit: number) => `统 ${lead} · 武 ${force} · 智 ${wit}`,
    cost: (gold: number) => `${gold} 金`,
    recruit: '招募',
    recruiting: '招募中…',
    needGold: (gold: number) => `金币不足（需 ${gold}）`,
    capReached: (cap: number) => `普通将已达上限 ${cap}（升级酒馆可提高）`,
  },
  card: {
    famousTag: '名将',
    level: (level: number, max: number) => `Lv${level}/${max}`,
    exp: (exp: number, next: number) => (next > 0 ? `经验 ${exp}/${next}` : '已满级'),
    attrs: (lead: number, force: number, wit: number) => `统率 ${lead} · 武力 ${force} · 智力 ${wit}`,
    bonus: (atk: number, def: number, leadCap: number) =>
      `满编加成：攻击 +${atk}% · 减伤 ${def}%（统率可带 ${leadCap} 兵吃满，超出按比例摊薄）`,
    salary: (gold: number) => `俸禄 ${gold} 金/小时`,
    guardProd: (percent: number) => `城守产量 +${percent}%`,
    statusIdle: '空闲',
    statusMarching: '随军出征中',
    statusGuard: (cityName: string) => `城守 · ${cityName}`,
    statusArrears: '欠饷（金币补足后自动恢复，期间不能出征）',
    statusWounded: (clock: string) => `重伤，${clock} 前不能出征`,
    assignGuard: '任命为本城城守',
    removeGuard: '撤任城守',
    guardOther: '改任本城城守',
    dismiss: '解雇',
    dismissConfirm: '确认解雇？',
    dismissFamousHint: '解雇后该名将回到全服「可获得」状态，可能被他人得到',
    cancel: '取消',
    busy: '处理中…',
    guardDenied: '该武将正随军出征，不能任城守',
  },
  guard: {
    title: '本城城守',
    none: '未任命城守：守城战享攻防加成，平时该城四资源产量 +智力 × 0.1%（封顶 5%）',
    row: (name: string, atk: number, def: number, prod: number) =>
      `${name}：守城攻击 +${atk}% · 减伤 ${def}% · 产量 +${prod}%`,
  },
  famous: {
    title: '名将归属（全服唯一）',
    toggleShow: '展开',
    toggleHide: '收起',
    owner: (name: string) => `主人：${name}`,
    free: '尚未被获得',
  },
  picker: {
    label: '随队将领',
    none: '不带将',
    option: (name: string, level: number, lead: number, force: number, wit: number) =>
      `${name} Lv${level}（统${lead} 武${force} 智${wit}）`,
    unavailable: {
      wounded: '重伤',
      arrears: '欠饷',
      busy: '在外',
      guard: '城守',
    },
    preview: (atk: number, def: number, scale: number) =>
      `加成：攻击 +${atk}% · 减伤 ${def}%${scale < 1 ? `（编队超过统率上限，已按 ${Math.round(scale * 100)}% 摊薄）` : ''}`,
    previewIdle: '选好编队后显示实际加成',
  },
  event: {
    recruited: (name: string, cost: number) => `招募武将 ${name}（花费 ${cost} 金）`,
    dismissed: (name: string) => `解雇武将 ${name}`,
    arrears: (name: string) => `武将 ${name} 欠饷：金币不足发俸禄，补足前不能出征`,
    wounded: (name: string, clock: string) => `武将 ${name} 带队战败，重伤至 ${clock}`,
    levelUp: (name: string, level: number) => `武将 ${name} 升到 Lv${level}`,
    granted: (name: string, source: string) => `获得名将 ${name}（${source}）`,
    guardAssigned: (name: string) => `任命 ${name} 为城守`,
    guardRemoved: () => '撤任城守',
    expSuffix: (name: string, gained: number, leveledTo: number | null) =>
      `；武将 ${name} 经验 +${gained}${leveledTo ? `，升到 Lv${leveledTo}` : ''}`,
    woundedSuffix: (name: string) => `；武将 ${name} 重伤`,
  },
  report: {
    attackerHero: (name: string, lead: number, force: number, wit: number, atk: number, def: number) =>
      `将领 ${name}（统${lead} 武${force} 智${wit}）：攻击 +${atk}% · 减伤 ${def}%`,
    defenderHero: (name: string, lead: number, force: number, wit: number, atk: number, def: number) =>
      `城守 ${name}（统${lead} 武${force} 智${wit}）：攻击 +${atk}% · 减伤 ${def}%`,
  },
  broadcast: {
    granted: (username: string, name: string, source: string) => `${username} ${source}，获得名将 ${name}`,
  },
  errors: {
    fallback: '武将操作失败，请稍后重试',
    byCode: {
      TAVERN_NOT_BUILT: '本城还没有酒馆，先建造酒馆',
      HERO_CANDIDATE_GONE: '这名候选已不在酒馆（已招走或已刷新），请看最新候选',
      HERO_CAP_REACHED: '普通将已达上限，解雇一名或升级酒馆后再招募',
      HERO_NOT_FOUND: '没有找到这名武将',
      HERO_BUSY: '该武将正随另一支部队出征',
      HERO_WOUNDED: '该武将重伤中，伤愈前不能出征',
      HERO_ARREARS: '该武将欠饷，补足金币后才能出征',
      GUARD_ASSIGN_DENIED: '该武将正在城守，不能同时出征；或正随军出征，不能任城守',
    } as Partial<Record<ErrorCode, string>>,
  },
};
