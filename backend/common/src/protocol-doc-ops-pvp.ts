// 玩家对抗（一）（v38，AISLG-122）的协议文档：TRUCE 主动免战与 PUSH_ATTACK_WARNING
// 玩家来袭预警。规则与数值见 common/src/protection.ts。

import type { PushOpDoc, RequestOpDoc } from './protocol-doc';

export const REQUEST_TRUCE: RequestOpDoc = {
  kind: 'request',
  name: 'TRUCE',
  title: '开启主动免战（每周一次免费）',
  preAuth: false,
  summary:
    '开启账号级主动免战：持续 12 小时基准（随全局时间缩放），期间别的玩家打不了你（MARCH 打你返回 TARGET_IN_TRUCE）、NPC 袭击目标池也会跳过你；你自己也不能出兵攻打玩家（MARCH 打玩家返回 SELF_TRUCE_ACTIVE），打野地 / NPC 城池、侦察、运输、调兵均不受影响。每个账号每周（7 天基准，随缩放）可免费开一次；城被攻破 / 被抢后的被动免战（4 小时基准）与本免战相互独立、共用「免战中」的不可攻击效果。',
  requestFields: [],
  dataFields: [
    { name: 'shieldUntil', type: 'string', desc: '免战截止时刻（ISO 8601，本次开启 12 小时基准随缩放）。' },
    { name: 'nextAvailableAt', type: 'string', desc: '下一次可开启时刻（ISO 8601，本次使用后 7 天基准随缩放）。' },
  ],
  errors: ['TRUCE_ALREADY_ACTIVE', 'TRUCE_WEEKLY_USED'],
  examples: [
    {
      request: { op: 53, seq: 41 },
      responses: [
        {
          op: 53,
          seq: 41,
          ok: true,
          data: {
            shieldUntil: '2026-10-03T12:00:00.000Z',
            nextAvailableAt: '2026-10-10T00:00:00.000Z',
          },
        },
      ],
    },
    {
      caption: '本周已用过（每周一次）',
      request: { op: 53, seq: 42 },
      responses: [
        {
          op: 53,
          seq: 42,
          ok: false,
          error: { code: 'TRUCE_WEEKLY_USED', message: '本周的主动免战已用过（每周一次免费）；data.nextAvailableAt / retryAfterSeconds 为下次可开启时刻与剩余秒数' },
          data: { nextAvailableAt: '2026-10-08T00:00:00.000Z', retryAfterSeconds: 7200 },
        },
      ],
    },
  ],
  agentNote:
    '免战适合「要下线睡觉 / 资源涨满怕被抢」的时间窗：开启后 12 小时（基准）内别人打不了你。注意开启后你也不能出兵打玩家（打野地 / NPC 不受限）；每周只有一次，规划好使用时机（city.shieldNextAt 可查下次可用时刻）。',
};

export const PUSH_ATTACK_WARNING: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_ATTACK_WARNING',
  title: '玩家部队来袭预警',
  summary:
    '（v38，AISLG-122）别的玩家向你的一座城（主城或分城）发起掠夺出征时立即推送（与事件 player_attack_warning 同构）。预警提前量 = 行军时长本身（部队出发你就能看到）；敌情详细度按被袭击城的烽火台等级分档（与 NPC 来袭预警同口径：0–2 级只给总兵力范围、3–5 级给各兵种范围、6+ 级给精确编成），并始终给出进攻方玩家名与出发城。预警期间可以增援（调兵进该城）、迁走资源或组织反打。v39（AISLG-123）起抢占你占领野地的出征（target=wilderness）同样推送：敌情按该地块所属城的烽火台分档，预警期间可向该地块增援（MARCH 打自己的地块 = 增援）。',
  dataFields: [
    { name: 'marchId', type: 'string', desc: '进攻方行军 id（去重键；同一行军只推一次）。' },
    { name: 'x / y', type: 'number', desc: '被袭击目标的地块坐标（城池或野地）。' },
    { name: 'target', type: "'city' | 'wilderness'", desc: '来袭目标：city = 城池（v38）；wilderness = 抢占你占领的野地（v39）。' },
    { name: 'terrain / level', type: 'string | null / number', desc: '（v39，仅 target=wilderness）目标野地的地形与等级；city 为 null / 0。' },
    { name: 'attacker', type: 'object', desc: '进攻方：{ username 玩家名, cityId 出发城 id, cityName 出发城名 }。' },
    { name: 'armyMin / armyMax', type: 'number', desc: '来袭兵力的大致范围（编成总单位数 ±20% 取整）。' },
    { name: 'intel', type: "'range' | 'kinds' | 'exact'", desc: '敌情详细度（由被袭击城的烽火台等级决定）：range 只给总兵力范围 / kinds 另给 armyKinds 各兵种范围 / exact 另给 army 精确编成。' },
    { name: 'beaconLevel', type: 'number', desc: '被袭击城的烽火台等级（0 = 未建）。' },
    { name: 'armyKinds', type: 'object', desc: '（intel=kinds）各兵种的数量范围 { min, max }。' },
    { name: 'army', type: 'object', desc: '（intel=exact）精确编成（按兵种的数量）。' },
    { name: 'arriveAt', type: 'string', desc: '预计到达时刻（ISO 8601；即战斗结算时刻，以此为增援的截止线）。' },
  ],
  examples: [
    {
      push: true,
      op: 2017,
      data: {
        marchId: '3f2c9a58-1b7e-4d60-8a92-9c41d2f7a001',
        x: 210,
        y: 195,
        target: 'city',
        terrain: null,
        level: 0,
        intel: 'range',
        beaconLevel: 2,
        armyMin: 80,
        armyMax: 120,
        attacker: { username: '曹操', cityId: '1a2b3c4d-0000-4000-8000-000000000001', cityName: '许昌' },
        arriveAt: '2026-10-03T08:30:00.000Z',
      },
    },
    {
      push: true,
      op: 2017,
      data: {
        marchId: '5e8d1b70-2c4f-4a51-9b83-ad62e3f8b002',
        x: 208,
        y: 197,
        target: 'wilderness',
        terrain: 'forest',
        level: 3,
        intel: 'kinds',
        beaconLevel: 4,
        armyMin: 16,
        armyMax: 24,
        armyKinds: { militia: { min: 16, max: 24 } },
        attacker: { username: '孙权', cityId: '2b3c4d5e-0000-4000-8000-000000000002', cityName: '建业' },
        arriveAt: '2026-10-03T08:36:00.000Z',
      },
    },
  ],
  agentNote:
    '收到预警先看 target 与 armyMax：城池目标比该城守军——守得住就原地不动（守城战有城墙 / 箭塔 / 城守加成），守不住就在 arriveAt 前把资源用掉（建造 / 征兵 / 研究锁定资源）、必要时从其他城调兵增援（MARCH 到自己的城 = 调兵），被攻破后该城进入 4 小时（基准）免战；野地目标（v39）看地块驻军——来得及就向该地块增援（MARCH 打自己的地块 = 增援，不战斗并入驻军），守不住可考虑主动召回（RECALL_GARRISON 弃守保兵，袭击 / 抢占随之作废）。',
};
