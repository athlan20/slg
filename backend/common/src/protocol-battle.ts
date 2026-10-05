// 战斗、侦察、调兵与战报协议的类型（v13；战斗结构见 common/src/battle.ts）。
// 本文件只 import protocol / protocol-world / protocol-army 的类型（类型导入在运行时
// 被擦除，不构成加载环）。

import type { InitiatorRole } from './protocol';
import type { ArmyCounts, TroopKind } from './protocol-army';
import type { MarchView, TerrainKind, TileKind } from './protocol-world';

/** 行军目的（marches.purpose 的合法取值；v16 起 attack 仅存量在途行军使用） */
export const MARCH_PURPOSES = ['attack', 'scout', 'transfer', 'return', 'plunder', 'occupy', 'reinforce', 'transport', 'intercept'] as const;

export type MarchPurpose = (typeof MARCH_PURPOSES)[number];

export function isMarchPurpose(value: unknown): value is MarchPurpose {
  return typeof value === 'string' && (MARCH_PURPOSES as readonly string[]).includes(value);
}

/**
 * 出征任务（MARCH.task，v16）：plunder=掠夺（缺省）、occupy=占领。只作用于
 * 出征类目标（野地 / NPC 城）；侦察、调兵、增援、返程不接受 task。
 * v26（AISLG-79）：transport=运输，目标只能是本账号的另一座城，须带 cargo。
 */
export const MARCH_TASKS = ['plunder', 'occupy', 'transport'] as const;

export type MarchTask = (typeof MARCH_TASKS)[number];

export function isMarchTask(value: unknown): value is MarchTask {
  return typeof value === 'string' && (MARCH_TASKS as readonly string[]).includes(value);
}

/** 战报中一方的汇总（攻方 / 守方共用） */
/** 战报一方的随队 / 城守武将（v36，AISLG-114/115；未配将为 null / 缺省） */
export interface BattleHeroView {
  name: string;
  lead: number;
  force: number;
  wit: number;
  /** 全军攻击加成（百分数；已含统率摊薄与 20% 封顶，随部队规模生效） */
  atkPercent: number;
  /** 全军受到伤害减免（百分数；同上） */
  defPercent: number;
}

export interface BattleSideView {
  /** 展示名：攻方「玩家名 · 城池名」；守方「野地 Lv3」等描述 */
  name: string;
  troops: ArmyCounts;
  losses: ArmyCounts;
  survivors: ArmyCounts;
  /** 全场总输出伤害 */
  damage: number;
  /** 总单位数 = Σ troops（v21 AISLG-33；服务端按 troops 汇总下发，历史战报同样补齐） */
  units: number;
  /** 总血量 = Σ troops × 单兵生命（v21 AISLG-33，按「兵种与战斗属性」表可对账） */
  totalHp: number;
  /** 编成平均射程 = Σ troops × 单兵射程 ÷ units（v21 AISLG-30，1 位小数，空编成为 0）：
   *  数量加权平均会被大量近战稀释——「近战为主 + 少量远程」时它读起来像全军射程，
   *  不代表克制关系；判断远程威胁请用 maxRange / rangedUnits 或按 troops 拆射程（v23，AISLG-49） */
  avgRange: number;
  /** 编成中单兵射程的最大值（v23，AISLG-49；空编成为 0）：对方 maxRange 远超我方即
   *  「他打得到我、我够不到他」的单方面压制信号（当前兵种表：近战 10 / 弓箭兵 70） */
  maxRange: number;
  /** 远程单位数 = 射程超过近战基准（>10）的单位数（v23，AISLG-49；当前兵种表即弓箭兵）：
   *  与 maxRange 组合可直接读出「有多少单位在远端输出」，无需客户端查兵种表反推 */
  rangedUnits: number;
  /** 该方武将（v36，AISLG-114/115）：攻方 = 随队武将、守方 = 城守（仅守城战）；未配将 / 历史战报为 null / 缺省 */
  hero?: BattleHeroView | null;
}

/** 战报的逐回合统计（结构占位：每回合双方伤害与损失，不含逐兵堆明细） */
export interface BattleRoundLogEntryView {
  round: number;
  attackerDamage: number;
  defenderDamage: number;
  attackerKilled: number;
  defenderKilled: number;
  /** 本回合箭塔造成的伤害（v30，AISLG-82；已含在 defenderDamage 内；历史战报 / 无箭塔缺省视为 0） */
  towerDamage?: number;
}

/** Agent 写回的战报点评（v23，AISLG-53；每份战报最新一条，重写覆盖） */
export interface BattleReportCommentView {
  /** 点评正文（1..200 字符） */
  text: string;
  /** 最近一次写入时间（ISO 8601） */
  updatedAt: string;
}

/** 战报视图（GET_BATTLE_REPORTS / PUSH_BATTLE_REPORT 共用） */
export interface BattleReportView {
  /** 战报序号（自增，查询游标用） */
  id: number;
  x: number;
  y: number;
  /** 战斗类别：wilderness 野地 / npc_city NPC 城池攻城 / npc_raid NPC 袭击驻军 /
   *  city_raid NPC 袭击玩家主城（v21，AISLG-32 方案 A；守方走守城战，城墙减伤生效） /
   *  pvp_raid 玩家攻打玩家城（v38，AISLG-122；守城战同 city_raid，攻守双方各得一份战报） /
   *  pvp_wilderness 玩家抢占玩家野地（v39，AISLG-123；野地战无城墙，双方各得一份） /
   *  pvp_conquest 玩家攻打玩家分城「占领」（v40，AISLG-124；守城战，打赢降城防值 / 归零换主） */
  kind: 'wilderness' | 'npc_city' | 'npc_raid' | 'city_raid' | 'intercept' | 'yellow_turban' | 'pvp_raid' | 'pvp_wilderness' | 'pvp_conquest';
  /** 报告持有方在本场战斗中的角色（攻方 = 出征者；守方 = 被袭击的驻军主） */
  role: 'attacker' | 'defender';
  /** 报告持有方是否获胜 */
  won: boolean;
  /** 实际回合数 */
  rounds: number;
  /** 终局原因：defender_wiped 守方全灭 / attacker_wiped 攻方全灭 / round_limit 回合耗尽（攻方未突破） */
  endReason: 'defender_wiped' | 'attacker_wiped' | 'round_limit' | 'no_contact';
  /** 未接战结果（v28，AISLG-78，仅 kind='intercept'）：missed 扑空（到达时目标已走远）/ gone 目标消失（已被击败或过时）；
   *  此时 endReason='no_contact'、rounds=0、双方无损失；接战的截击为 undefined */
  contact?: 'missed' | 'gone';
  attacker: BattleSideView;
  defender: BattleSideView;
  /** 守方城墙防御加成（百分数；非守城战斗为 0） */
  wallDefensePercent: number;
  /** 箭塔造成的总伤害（v30，AISLG-82；仅守城战有箭塔时 > 0，历史战报缺省视为 0；已含在 defender.damage 内） */
  towerDamage?: number;
  /** 冲车破墙（v33，AISLG-86）：攻城战攻方带冲车且城墙减伤 > 0 时，开战时（第 1 回合）城墙减伤的原值与破墙后的值
   *  （百分数，1 位小数；例：70 → 42）；每回合按当时存活的冲车重算，此处只给开战时数值；其余为 undefined */
  wallBreak?: { from: number; to: number };
  roundLog: BattleRoundLogEntryView[];
  /** Agent 写回的点评（v23，AISLG-53；玩家自己的 Agent 读战报后写回的大白话复盘）；
   *  尚未有点评为 null——没有点评时战报照常展示 */
  comment: BattleReportCommentView | null;
  createdAt: string;
}

/** SCOUT（op 34）请求载荷 */
export interface ScoutRequestData {
  x: number;
  y: number;
  /** 派出斥候数量，1..100；城内斥候不足返回 INSUFFICIENT_TROOPS */
  count: number;
}

export interface ScoutResponseData {
  /** 侦察行军（purpose='scout'；到达产出情报事件并自动返程） */
  march: MarchView;
}

/** RECALL_MARCH（op 35）请求载荷：把行军中的部队原地折返（不结算目标） */
export interface RecallMarchRequestData {
  marchId: string;
}

export interface RecallMarchResponseData {
  /** 折返后的行军（purpose='return'；到达后部队回并入城内驻军） */
  march: MarchView;
}

/** GET_BATTLE_REPORTS（op 36）请求载荷 */
export interface GetBattleReportsRequestData {
  /** 返回条数上限，1..50，默认 20 */
  limit?: number;
  /** 分页游标：返回 id 小于它的最新战报（与 limit 组合） */
  beforeId?: number;
}

export interface GetBattleReportsResponseData {
  reports: BattleReportView[];
}

/** PUSH_BATTLE_REPORT（op 2007）推送载荷：战斗结算生成战报时推给持有方账号 */
export interface BattleReportPushData {
  report: BattleReportView;
}

/** AGENT_COMMENT_REPORT（op 39）请求载荷（v23，AISLG-53；仅 Agent 连接） */
export interface AgentCommentReportRequestData {
  /** 战报 id（须为本账号持有的战报） */
  reportId: number;
  /** 点评正文，trim 后 1..200 字符；建议大白话复盘（为什么输 / 下次带什么兵），不出现字段名 */
  text: string;
}

export interface AgentCommentReportResponseData {
  reportId: number;
  comment: BattleReportCommentView;
}

/** PUSH_BATTLE_REPORT_COMMENT（op 2009）推送载荷：点评写入后推给账号全部在线连接 */
export interface BattleReportCommentPushData {
  reportId: number;
  comment: BattleReportCommentView;
}

/** 侦察情报快照（march_completed 事件 detail.intel 与 scout_intel 表共用形态） */
export interface ScoutIntel {
  x: number;
  y: number;
  kind: TileKind;
  terrain: TerrainKind;
  level: number;
  /** 地块占领者（占领野地的城 / NPC 城池城主）；无主为 null */
  owner: { username: string; cityName: string } | null;
  /** 地块驻军（占领野地或 NPC 城池驻防；未占领野地为原住守军）。v27（AISLG-77）起按侦察科技降级：
   *  detail='rough' 时全 0（只给 garrisonTotal 范围）、'kinds' 时各兵种为近似值、'exact' 为精确 */
  garrison: ArmyCounts;
  /** 侦察详细度（v27，AISLG-77；缺省视为 exact，兼容历史情报）：rough / kinds / exact，由发起侦察时的侦察科技等级决定 */
  detail?: 'rough' | 'kinds' | 'exact';
  /** 总兵力范围（v27，AISLG-77）：exact 时 min = max = 真实总数；其余为真实总数 ±20% */
  garrisonTotal?: { min: number; max: number };
  /** 守方城墙防御加成（百分数；NPC 城池按其城墙等级推导，其余 0） */
  wallDefensePercent: number;
  /** NPC 城池可掠夺库存快照；非 NPC 城为 null */
  npcStock: Partial<Record<'gold' | 'wood' | 'food' | 'stone' | 'iron', number>> | null;
  /** 情报获取时间（ISO 8601） */
  scoutedAt: string;
  /** 名城信息（v24，AISLG-56）：侦察时刻的阶段——garrison / wallDefensePercent 即该阶段的守军与城墙口径；非名城无此字段 */
  famous?: { name: string; stage: 'outer' | 'keeper' };
}

/** 发起人角色（战报 / 事件的 initiator；与协议登录类型同构） */
export type BattleInitiator = InitiatorRole;

/** 兵种编队的快照形态（调兵 / 侦察复用；键为兵种，值 ≥ 0） */
export type TroopCounts = Partial<Record<TroopKind, number>>;
