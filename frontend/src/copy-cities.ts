// 多城与分城文案（v24，AISLG-58；从 copy.ts 拆出以控制单文件行数）

export const CITY_COPY = {
  /** 城池切换条 */
  switcher: {
    title: '城池',
    levelTag: (level: number) => `Lv.${level}`,
    mainTag: '主城',
    tabTitle: (name: string, level: number, x: number | null, y: number | null) =>
      `${name} · 城池 Lv.${level}${x !== null && y !== null ? ` · (${x},${y})` : ''}`,
    branchQuota: (count: number, limit: number) => `分城 ${count}/${limit}`,
    branchLocked: (minGovernment: number) => `主城官府 ${minGovernment} 级起可占领 NPC 城变分城`,
    switching: '切换中…',
  },
  /** 出征任务：占领 NPC 城（变分城） */
  worldMap: {
    attackHintNpc:
      '掠夺：战胜按幸存部队负重携走库存（含金币，库存不再生）；占领：打赢后该城变成你的分城，接收其建筑与剩余库存。建议先侦察',
    taskOccupyNpcHint: (minGovernment: number) =>
      `变成分城需：主城官府 ≥ ${minGovernment} 级、分城未满、目标城等级 ≤ 出发城官府等级；不满足时会被拒绝并说明原因`,
    confirmOccupyNpc: '占领为分城',
  },
  /** 自有城池间运输（v26 AISLG-79） */
  transport: {
    modeTroop: '调兵',
    modeTransport: '运输',
    hint: '把资源运到本账号另一座城：出发即从本城扣除，到达后即时入账目标城（不受储量上限限制），部队随后自动返回；途中撤回则资源随部队回来。民夫负重最高（单兵 500）',
    cargoTitle: '运送资源',
    cargoInputLabel: (name: string, have: number) => `${name}（现有 ${have}）`,
    cargoMax: '最多',
    usedLine: (used: number, capacity: number) => `已用负重 ${used} / 总负重 ${capacity}`,
    overCapacity: '货物超过编队负重：请减少货物或多派部队（民夫负重最高）',
    insufficient: (name: string) => `出发城${name}不足`,
    pickCargo: '请填写要运送的资源数量',
    submit: '开始运输',
    marchLabel: (x: number, y: number) => `运输 → (${x},${y})`,
    marchCargo: (cargo: string) => `（货物 ${cargo}）`,
    startedLog: (x: number, y: number, cargo: string, dueClock: string) => `运输队出发 → (${x},${y})，货物 ${cargo}，预计 ${dueClock} 到达`,
    eventDelivered: (pos: string, cityName: string, cargo: string, troops: string) =>
      `运输完成：${cargo} 已送达 ${cityName}（${pos}），运输部队 ${troops} 返程`,
    eventReceived: (fromName: string, cargo: string) => `收到来自${fromName}的运输：${cargo}`,
    eventAbortedCargo: (cargo: string) => `，货物 ${cargo} 随部队带回`,
  },
  /** 名城（v24 AISLG-56）：地图图标 / 悬浮提示 / 详情 */
  famous: {
    legend: '名城（分两阶段攻打，占领独享加成）',
    stageOuter: '外围阶段：先清外围驻军',
    stageKeeper: '城守阶段：外围已清，可攻城守并占领',
    bonus: (percent: number) => `占领独享：该城产量 +${percent}%`,
    recoversAt: (clock: string) => `${clock} 前攻下城守，否则外围恢复满编`,
    title: (name: string) => `名城 · ${name}`,
    cityBonusRow: (percent: number) => `名城加成：产量 +${percent}%`,
    hintOuter: '名城分两阶段：先出征清理外围（打赢无战利品），外围清空后限时内再出征攻城守；外围未清时不能直接占领',
    hintKeeper: '外围已清空：限时内出征攻城守——掠夺库存或占领变分城（占领独享产量加成）；超时外围恢复满编',
  },
  errors: {
    governmentTooLow: '占领 NPC 城需要主城官府达到指定等级（见分城名额提示）',
    branchLimit: '分城数量已达上限（分城上限 = 主城官府等级 ÷ 3，向下取整，升级主城官府可提高）',
    outerNotCleared: '名城外围驻军尚未清空，请先出征清理外围（掠夺），外围清空后限时内可攻城守并占领',
    transportInsufficient: '出发城的资源不足以运送这批货物（已按最新库存刷新）',
    targetLevelTooHigh: '目标 NPC 城等级高于出发城的官府等级，只能占领不高于出发城官府等级的城',
  },
};

/** 占领 NPC 城所需的主城官府最低等级（占位值，与服务端 branch.minGovernment 对齐；仅用于静态提示） */
export const BRANCH_MIN_GOVERNMENT = 3;
