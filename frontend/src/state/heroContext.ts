// 出征带将上下文（v36 AISLG-114）：App 把武将会话的「可选武将 + 当前选择」提供给下层的出征 / 侦察 /
// 截击 / 运输表单，表单内的「随队将领」选择器直接读取，提交时带上 heroId，不必逐层传参。

import { createContext, useContext } from 'react';
import type { HeroView } from '../api/protocol';

export interface HeroPickState {
  heroes: HeroView[];
  selectedHeroId: string | null;
  selectHero: (heroId: string | null) => void;
  /** 带将出征 / 侦察成功后：清空选择并重拉武将（该武将已随军，状态变为出征中） */
  afterMarch: () => void;
}

export const HeroContext = createContext<HeroPickState | null>(null);

export function useHeroPick(): HeroPickState | null {
  return useContext(HeroContext);
}
