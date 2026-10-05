// 黄巾之乱协议的对外文档（GET_YELLOW_TURBAN / PUSH_YELLOW_TURBAN_STATE，v29，AISLG-76）。
// 营地出征走 MARCH（见 protocol-doc-ops-world.ts）。数值引用 yellow-turban.ts 的真实常量。

import { Op } from './protocol';
import type { PushOpDoc, RequestOpDoc } from './protocol-doc';
import { CITY_ID, STARTED_AT } from './protocol-doc-shared';
import {
  YT_BOSS_KEEPER_MULTIPLIER,
  YT_BOSS_KEEPER_WINDOW_HOURS,
  YT_BOSS_OUTER_MULTIPLIER,
  YT_BOSS_UNLOCK_RATIO,
  YT_CAMPS_MAX,
  YT_CAMPS_MIN,
  YT_CAMPS_PER_ACTIVE_PLAYER,
  YT_CYCLE_DAYS,
  YT_DURATION_HOURS,
  YT_GROW_HOURS,
  YT_RAID_HOURS,
  YT_RAID_LEVEL,
  YT_RAID_RADIUS,
  YT_REWARD_TIERS,
  YT_SCATTER_LEVEL,
  YT_TIER_INFO,
  ytBossUnlockCount,
} from './yellow-turban';

void CITY_ID;
const START_MS = Date.parse(STARTED_AT);
const EVENT_VIEW = {
  id: '5d7a1c9e-2b3f-4a60-9c18-4e5f6a7b8c9d',
  status: 'active',
  startedAt: STARTED_AT,
  endsAt: new Date(START_MS + YT_DURATION_HOURS * 3_600_000).toISOString(),
  totalCamps: 10,
  clearedCamps: 3,
  bossUnlockCount: ytBossUnlockCount(10),
  bossAppearedAt: null,
  bossClearedAt: null,
  finishReason: null,
  finishedAt: null,
  scatteredCamps: 0,
} as const;

const CAMP_VIEW = {
  id: '8a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  x: 612,
  y: 388,
  tier: 'small',
  label: YT_TIER_INFO.small.label,
  level: YT_TIER_INFO.small.level,
  garrisonTotal: { min: 19, max: 29 },
  nextGrowAt: new Date(START_MS + YT_GROW_HOURS * 3_600_000).toISOString(),
} as const;

const REWARD_TABLE = YT_REWARD_TIERS.map((tier) => `${tier.label}：金 ${tier.reward.gold}、四资源各 ${tier.reward.wood}`).join('；');

export const REQUEST_GET_YELLOW_TURBAN: RequestOpDoc = {
  kind: 'request',
  name: 'GET_YELLOW_TURBAN',
  title: '查询黄巾之乱（全服共同清剿的周期事件，v29，AISLG-76）',
  preAuth: false,
  summary: `纯 PvE、全服共同参与的周期事件（参考旧游戏剧本战场「黄巾之乱」，只取玩法结构）：**起事**——每隔基准 ${YT_CYCLE_DAYS} 天（随全局时间缩放；上一轮未结束则等其结束，没有活跃玩家不起事）全服播报「黄巾起事」，地图上冒出一批黄巾营地：数量按活跃玩家数（⌈人数 × ${YT_CAMPS_PER_ACTIVE_PLAYER}⌉ 夹在 [${YT_CAMPS_MIN}, ${YT_CAMPS_MAX}]），分小 / 中 / 大三档（占 50% / 30% / 20%），守军强度对应野地 Lv${YT_TIER_INFO.small.level} / Lv${YT_TIER_INFO.medium.level} / Lv${YT_TIER_INFO.large.level}，落在活跃玩家主城周围；**坐大**——营地放着不管每隔 ${YT_GROW_HOURS} 小时（基准）升一档，大营每隔 ${YT_RAID_HOURS} 小时向 ${YT_RAID_RADIUS} 格内最近的玩家野地 / 主城（官府 ≥ 2、不在免战期）发兵，走现有 NPC 来袭预警流程（等价来袭 Lv${YT_RAID_LEVEL}，预警期间可增援）；**清剿**——出征营地和打野地一样（MARCH 掠夺任务，营地格不可占领、不受掠夺冷却限制），打赢营地消失，按幸存部队负重（含负重科技）掉落资源与金币；**决战**——营地清掉 ${YT_BOSS_UNLOCK_RATIO * 100}%（向上取整）后出现「张角老巢」：高难度、分外围（Lv${YT_TIER_INFO.boss.level} 野地基准 ×${YT_BOSS_OUTER_MULTIPLIER}）与城守（×${YT_BOSS_KEEPER_MULTIPLIER}）两段，类似名城——外围清空后 ${YT_BOSS_KEEPER_WINDOW_HOURS} 小时（基准）内可攻城守，超时外围恢复满编，全服都能打，谁打掉谁有首杀播报；**收场**——老巢被打掉或到时限（基准 ${YT_DURATION_HOURS} 小时）事件结束，没清完的营地散成流寇（AISLG-78，小 / 中 / 大营散成 Lv${YT_SCATTER_LEVEL.small} / Lv${YT_SCATTER_LEVEL.medium} / Lv${YT_SCATTER_LEVEL.large} 流寇）。营地与老巢守军的战后存量按野地同口径每小时恢复 25%，全服可以接力消耗。**贡献与奖励**：贡献 = 每人歼灭的黄巾单位数（输赢都累计），事件期间有贡献榜（本协议返回前 10 与我的名次），结束按名次发资源与金币到各人主城（${REWARD_TABLE}；歼敌 > 0 才有奖）并写 yt_reward 事件。事件开始 / 坐大 / 老巢出现 / 首杀 / 结束都有全服播报（不受每分钟 3 条限频）。营地所在地块的 TileView.camp 带档位 / 守军大致范围 / 升档倒计时，营地所在格不显示野地原住守军。数值均为占位，上线后按数据调整。`,
  requestFields: [],
  dataFields: [
    { name: 'event', type: 'object | null', desc: '当前进行中的事件；没有进行中则为**最近一轮**（status=finished，含 finishReason / scatteredCamps，便于展示上一轮结果）；从未起过事为 null。字段：{ id, status: active|finished, startedAt, endsAt 时限, totalCamps 本轮营地总数, clearedCamps 已清剿数（总进度条：已清 x / 共 y）, bossUnlockCount 出现老巢所需清剿数, bossAppearedAt / bossClearedAt, finishReason: boss_cleared|timeout|null, finishedAt, scatteredCamps }。' },
    { name: 'nextEventAt', type: 'string | null', desc: '没有进行中事件时：下一轮预计起事时刻（最近一轮开始 + 起事间隔）；进行中 / 从未起过事为 null（从未起过事 = 有活跃玩家即起）。到点后还要有活跃玩家（24 小时内登录过）才会真起事。' },
    { name: 'camps', type: 'array', desc: '当前进行中的营地与老巢（事件进行中才有）：{ id, x, y, tier: small|medium|large|boss, label, level 守军强度对应的野地等级口径, garrisonTotal { min, max } 守军总兵力大概范围（当前存量 ±20%，不给精确编成，要精确情报派斥候），nextGrowAt 下次升档时刻（大营 / 老巢为 null）, boss? { stage: outer|keeper, recoversAt } }。' },
    { name: 'me', type: 'object | null', desc: '本账号在该事件里的贡献 { killed 歼灭黄巾单位数, rank 名次（同分并列）}；还没有贡献为 null。' },
    { name: 'top', type: 'array', desc: '贡献榜前 10 名：{ rank, username, killed }。' },
    { name: 'rewards', type: 'array', desc: '名次奖励档位：{ label, maxRank 名次上限（含）, reward 资源与金币 }（占位）。' },
  ],
  errors: [],
  examples: [
    {
      caption: '事件进行中：已清 3 / 共 10，老巢还差 5 个营地',
      request: { op: Op.GET_YELLOW_TURBAN, seq: 18, data: {} },
      responses: [
        {
          op: Op.GET_YELLOW_TURBAN,
          seq: 18,
          ok: true,
          data: {
            event: EVENT_VIEW,
            nextEventAt: null,
            camps: [CAMP_VIEW, '（其余营地同结构）'],
            me: { killed: 42, rank: 3 },
            top: [{ rank: 1, username: 'alice', killed: 180 }, '（共前 10 名）'],
            rewards: YT_REWARD_TIERS.slice(0, 1).map((tier) => ({ label: tier.label, maxRank: tier.maxRank, reward: tier.reward })),
          },
        },
      ],
    },
  ],
  agentNote: `清剿建议：先 GET_YELLOW_TURBAN 看 camps 与自己的兵力，从小营下手（守军约等于 Lv${YT_TIER_INFO.small.level} 野地，推荐兵力口径见「野地进攻口径」表），大营守军强且会向附近玩家发兵；坐大计时（nextGrowAt）是时间压力。出征用 MARCH（task 缺省 plunder）对营地坐标，task=occupy 会被拒（TASK_INVALID_FOR_TARGET）。贡献 = 歼敌单位数，打输也算——合力磨掉老巢守军（存量每小时只恢复 25%）是可行打法。老巢外围清空后注意 boss.recoversAt 的城守窗口。事件起止与进度用 PUSH_YELLOW_TURBAN_STATE 实时获得，也可定时重查。`,
};

export const PUSH_YELLOW_TURBAN_STATE: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_YELLOW_TURBAN_STATE',
  title: '推送：黄巾之乱起事 / 进度 / 老巢出现 / 收场（v29，AISLG-76）',
  summary: '黄巾之乱起事、清剿进度变化（每清掉一个营地）、老巢出现、收场时推送给当前全部在线连接（全服广播，无账号维度）。载荷里的 event 与 GET_YELLOW_TURBAN 的 event 同结构。',
  dataFields: [
    { name: 'reason', type: "'started' | 'progress' | 'boss_appeared' | 'finished'", desc: '起事 / 清剿进度变化 / 老巢出现 / 收场。' },
    { name: 'event', type: 'object', desc: '事件视图（结构同 GET_YELLOW_TURBAN 的 event）。' },
  ],
  examples: [{ op: Op.PUSH_YELLOW_TURBAN_STATE, push: true, data: { reason: 'progress', event: { ...EVENT_VIEW, clearedCamps: 4 } } }],
  agentNote: '收到 started / boss_appeared 后应重查 GET_YELLOW_TURBAN 拿营地 / 老巢坐标（推送只带事件摘要）；finished 后奖励已发到主城（yt_reward 事件）。推送可能漏收，定时重查对齐。',
};
