// 资源缺口获取途径（建筑 / 征兵消耗行点「缺」弹出的浮层）：文案集中在此，
// 英文孪生见 copy-shortfall-en.ts。不要写进 copy.ts（已超行数提醒）。

export const SHORTFALL_COPY = {
  /** 消耗行上「缺」标记的可点提示 */
  openTitle: '点击查看如何获取',
  openAria: (label: string) => `查看如何获取${label}`,
  closeAria: '关闭获取途径',
  /** 建筑详情在资源不足且可发起时，替换原来的建造/升级提示 */
  hintClick: '点标红的消耗，选择如何补齐',
  /** 浮层标题：还缺 金 60 */
  title: (label: string, missing: number) => `还缺 ${label} ${missing}`,
  have: (have: number, need: number) => `现有 ${have} / 需要 ${need}`,
  eta: (duration: string, rate: number) => `约 ${duration}攒够（当前 +${rate}/h）`,
  noRate: '当前净产量攒不够，需要兑换、掠夺或升级对应建筑',
  chevron: '▾',
  exchange: {
    title: '去集市兑换',
    hintCovered: (need: number) => `手头粮/木/石/铁够换出 ${need} 金`,
    hintShort: '手头四资源不够一次换齐，可先换一部分',
    /** 集市浮层里的预填说明 */
    prefill: (gold: number) => `还缺 ${gold} 金，已按缺口预填兑换数量`,
  },
  building: {
    titleBuild: (name: string) => `去建造${name}`,
    titleUpgrade: (name: string) => `去升级${name}`,
    hintBuild: (label: string) => `建成后持续产出${label}`,
    hintUpgrade: (label: string) => `升级后提高${label}产量`,
  },
  map: {
    titleGold: '去地图占领金矿',
    hintGold: '金矿不可掠夺，占领后持续产金',
    titleOther: '去地图掠夺或占领',
    hintOther: (label: string) => `掠夺对应地形野地可立刻获得${label}，占领后持续加成`,
  },
};
