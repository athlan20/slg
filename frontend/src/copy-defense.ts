// 二期新建筑（校场 / 烽火台 / 驿站 / 箭塔，v30 AISLG-80~83）文案；与 copy.ts 分文件以控制单文件行数

import type { TroopKind } from './api/protocol';
import { TROOP_LABEL } from './copy';

export const DEFENSE_COPY = {
  deploy: {
    meta: (count: number, limit: number) => `在外部队 ${count} / 上限 ${limit}`,
    full: (limit: number) => `校场等级不足，最多同时派出 ${limit} 支部队（行军中、返程中、驻守野地都算；城内驻军不算）`,
    hint: '本城同时在外的部队数 ≤ 校场等级（未建按 1）；分城各算各的，升级校场可提高',
  },
  building: {
    parade: (count: number, limit: number) => `在外部队 ${count} / 上限 ${limit}（上限 = 校场等级，未建按 1）`,
    beacon: (level: number) =>
      `来袭预警提前量 +${level * 10}%；敌情：${level >= 6 ? '精确兵种与数量' : level >= 3 ? '各兵种大概范围' : '只有总兵力大概范围（3 级起见兵种、6 级起精确）'}`,
    station: (level: number) => `自己城池之间的调兵 / 运输速度 +${level * 10}%`,
    tower: (damage: number, range: number) =>
      damage > 0 ? `守城每回合固定射击 ${damage} 点伤害，射程 ${range}（仅守城战生效）` : '守城每回合固定射击（建成后生效，伤害 = 150 × 等级）',
  },
  desc: {
    parade_ground: '限制本城同时在外的部队数：行军中、返程中、驻守野地的部队合计不能超过校场等级（没建按 1 支）；城内驻军不计。',
    beacon: '来袭预警更早、敌情更清楚：每级预警提前量 +10%（10 级翻倍）；0–2 级只看到兵力大概范围，3–5 级看到各兵种大概范围，6 级起精确。作用于本城和本城占领的野地。',
    post_station: '加快自己城池之间的调兵和资源运输：行军速度每级 +10%（10 级翻倍），出征野地 / NPC 城不受影响。',
    arrow_tower: '守城战（NPC 袭击主城）里城墙位上不会被消灭的远程单位：每回合对射程内最近的敌军造成固定伤害，伤害与射程随等级提升；野地战斗不生效。',
  },
  warning: {
    kindsLabel: '兵种估算：',
    exactLabel: '精确编成：',
    beaconNote: (level: number) => `烽火台 Lv${level}`,
    kindRange: (kind: TroopKind, min: number, max: number) => `${TROOP_LABEL[kind].name} ${min}–${max}`,
    exactRow: (kind: TroopKind, count: number) => `${TROOP_LABEL[kind].name}×${count}`,
  },
  report: {
    towerDamage: (damage: number) => `箭塔造成伤害 ${damage}`,
    wallBreak: (from: number, to: number) => `冲车破墙：城墙减伤 ${from}% → ${to}%`,
  },
  /** 兵种说明（征兵面板选中兵种时显示；v33 二期四兵种与克制关系，数值与后端 troops.ts / troop-counter.ts 对齐） */
  troopNote: {
    porter: '负重最高的一般兵种（500），战斗力很弱，适合运输与带回战利品。',
    militia: '基础近战兵，便宜、数量多，适合前排与攻打低级野地。',
    scout: '行军速度 ×2，用于侦察目标。',
    pikeman: '近战前排。克制：骑兵（轻骑兵 / 铁骑兵）伤害 +20%。',
    swordsman: '厚血高防的近战主力。抗性：受弓箭兵 / 床弩攻击伤害 −20%。',
    archer: '射程 70 的远程输出，脆；对刀盾兵伤害 −20%。',
    cavalry: '战斗速度最快，一轮穿越弓箭射程，专职反远程；受长枪兵克制（伤害 −20%）。',
    iron_cavalry: '后期重装主力：生命 2400、攻击 620、防御 420，贵且耗粮高（30/h）；受长枪兵克制。',
    supply_wagon: '负重 5000（民夫的 10 倍）的纯后勤：几乎没有战斗力，必须有战斗部队护送；运输 / 带回战利品。行军速度 0.7。',
    ballista: '射程 95 的远程器械，可站在弓箭射程外输出，反制弓箭阵；脆而慢（行军 0.6），需要近战掩护；打不到箭塔。对刀盾兵伤害 −20%。',
    siege_ram: '行军最慢（0.6）、负重 0；只在攻城战生效：每占攻方存活兵数 1%，守方城墙减伤相对降低 8%（最多 80%）；野地等战斗里只是肉厚攻低的单位。',
  } as Record<string, string>,
};
