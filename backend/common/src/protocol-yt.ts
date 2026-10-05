// 黄巾之乱协议的类型（v29，AISLG-76；从 protocol.ts 拆出以控制单文件行数）。
// 规则与数值见 common/src/yellow-turban.ts。类型导入在运行时被擦除，不构成加载环。

import type { Resources } from './protocol';
import type { YtTier } from './yellow-turban';

/** 地块上的营地信息（TileView.camp；老巢同样用本结构，tier='boss'） */
export interface YtTileCampView {
  tier: YtTier;
  /** 中文名：黄巾营地（小/中/大）/ 张角老巢 */
  label: string;
  /** 守军强度对应的野地等级口径（小 3 / 中 6 / 大 9 / 老巢 10） */
  level: number;
  /** 守军总兵力大概范围（当前存量 ±20%，不给精确编成；要精确情报派斥候） */
  garrisonTotal: { min: number; max: number };
  /** 下次升档时刻（ISO 8601）；大营 / 老巢为 null */
  nextGrowAt: string | null;
  /** 老巢专有：当前阶段与外围恢复时刻（城守阶段限时，超时外围恢复满编） */
  boss?: { stage: 'outer' | 'keeper'; recoversAt: string | null };
}

/** 营地视图（GET_YELLOW_TURBAN）：在 YtTileCampView 基础上带坐标与 id */
export interface YtCampView extends YtTileCampView {
  id: string;
  x: number;
  y: number;
}

/** 事件视图（GET_YELLOW_TURBAN / 推送共用） */
export interface YtEventView {
  id: string;
  status: 'active' | 'finished';
  startedAt: string;
  /** 时限（过时没清完则收场） */
  endsAt: string;
  /** 本轮起事的营地总数 */
  totalCamps: number;
  /** 已清剿的营地数（总进度条：已清 x / 共 y） */
  clearedCamps: number;
  /** 出现老巢所需清剿数（总数 × 80% 向上取整） */
  bossUnlockCount: number;
  /** 老巢出现时刻；尚未出现为 null */
  bossAppearedAt: string | null;
  /** 老巢被击破时刻；未击破为 null */
  bossClearedAt: string | null;
  /** 收场原因：boss_cleared 老巢被打掉 / timeout 到时限；进行中为 null */
  finishReason: 'boss_cleared' | 'timeout' | null;
  finishedAt: string | null;
  /** 收场时散成流寇的营地数（接 AISLG-78）；进行中为 0 */
  scatteredCamps: number;
}

/** 贡献榜一行 */
export interface YtContributionView {
  rank: number;
  username: string;
  /** 歼灭黄巾兵力（击杀的黄巾单位数累计） */
  killed: number;
}

/** 名次奖励档位（占位） */
export interface YtRewardTierView {
  label: string;
  maxRank: number;
  reward: Resources;
}

/** GET_YELLOW_TURBAN（op 48）响应 */
export interface GetYellowTurbanResponseData {
  /** 当前进行中的事件；没有为 null（nextEventAt 给出下一轮预计起事时刻） */
  event: YtEventView | null;
  /** 没有进行中事件时：下一轮预计起事时刻（上一轮开始后 3 天，随时间缩放）；未知为 null */
  nextEventAt: string | null;
  /** 当前存在的营地与老巢（含坐标，按档位 / 坐标排序） */
  camps: YtCampView[];
  /** 本账号的贡献与名次；本轮没有贡献为 null */
  me: { killed: number; rank: number } | null;
  /** 贡献榜前 10 名 */
  top: YtContributionView[];
  /** 名次奖励档位 */
  rewards: YtRewardTierView[];
}

/** PUSH_YELLOW_TURBAN_STATE（op 2014）推送载荷：全服广播 */
export interface YellowTurbanPushData {
  /** started 起事；progress 清剿进度变化；boss_appeared 老巢出现；finished 收场 */
  reason: 'started' | 'progress' | 'boss_appeared' | 'finished';
  event: YtEventView;
}
