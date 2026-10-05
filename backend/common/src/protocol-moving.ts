// 移动目标协议的类型（v28，AISLG-78；从 protocol.ts 拆出以控制单文件行数）。
// 规则与数值见 common/src/moving-target.ts。类型导入在运行时被擦除，不构成加载环。

import type { MovingKind, ScheduleEntry } from './moving-target';

/** 移动目标视图（GET_MOVING_TARGETS / 推送共用） */
export interface MovingTargetView {
  id: string;
  kind: MovingKind;
  /** 中文名：运粮商队 / 流寇 */
  label: string;
  level: number;
  status: 'active' | 'defeated' | 'expired';
  startedAt: string;
  /** 存在截止时刻（过时消失） */
  endsAt: string;
  /** 单步时长（秒）：每格停留的时间 */
  stepSeconds: number;
  /** 当前所在格（按服务端当前时刻）；未出发 / 已消失为 null */
  position: { x: number; y: number; index: number } | null;
  /** 公开时刻表：路线每格的坐标与进入时刻（持续到下一格的 at；最后一格持续到 endsAt） */
  route: ScheduleEntry[];
  /** 守军总兵力大概范围（真实 ±20%，不给精确编成；要精确情报派斥候） */
  garrisonTotal: { min: number; max: number };
  /** 携带资源总量大概范围（真实 ±20%；流寇会随掠夺增加） */
  stockTotal: { min: number; max: number };
}

/** GET_MOVING_TARGETS（op 47）响应：当前存在的全部移动目标（按截止时刻升序） */
export interface GetMovingTargetsResponseData {
  targets: MovingTargetView[];
}

/** PUSH_MOVING_TARGET_STATE（op 2013）推送载荷：全服广播 */
export interface MovingTargetPushData {
  /** spawned=新刷出；defeated=被截获消失；expired=过时消失 */
  reason: 'spawned' | 'defeated' | 'expired';
  target: MovingTargetView;
}
