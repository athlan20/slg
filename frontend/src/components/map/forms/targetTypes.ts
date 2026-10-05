// 地图页右侧「选中目标」面板里各表单共享的上下文（从 TargetPanel 传下来，避免逐个表单重复传一长串参数）。

import type { CityView, TileDetailView, TroopKind } from '../../../api/protocol';
import type { HeroPickState } from '../../../state/heroContext';
import type { WorldSession } from '../../../state/worldSession';

export type TroopInput = Partial<Record<TroopKind, number>>;

export interface TargetCtx {
  world: WorldSession;
  city: CityView;
  /** 选中的格与其详情（detail 可能还在加载） */
  x: number;
  y: number;
  detail: TileDetailView | null;
  /** 出发城坐标（AISLG-72）；未分配为 null（不给时长预估） */
  origin: { x: number; y: number } | null;
  hero: HeroPickState | null;
  now: number;
  troops: TroopInput;
  setTroops: (value: TroopInput) => void;
  busy: boolean;
  /** 在 busy 状态下执行一个异步动作（防重复提交） */
  run: (action: () => Promise<unknown>) => Promise<void>;
}
