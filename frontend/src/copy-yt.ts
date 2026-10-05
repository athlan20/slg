// 黄巾之乱文案（v29，AISLG-76；与 copy.ts 分文件以控制单文件行数）

export const YT_COPY = {
  panel: {
    title: '黄巾之乱',
    noEvent: '黄巾之乱尚未发生：每隔一段时间全服一起清剿一次',
    nextAt: (clock: string) => `下一轮预计 ${clock} 起事（需有玩家在线活跃）`,
    lastResult: (reason: 'boss_cleared' | 'timeout' | null, cleared: number, total: number, scattered: number) =>
      reason === 'boss_cleared'
        ? `上一轮：张角老巢已被击破，营地清剿 ${cleared}/${total}`
        : `上一轮：到时限收场，营地清剿 ${cleared}/${total}，${scattered} 处营地散成流寇`,
    progress: (cleared: number, total: number) => `已清 ${cleared} / 共 ${total}`,
    bossNeed: (need: number) => `清剿 ${need} 个营地后出现张角老巢`,
    bossAppeared: '张角老巢已出现，全服可攻',
    bossCleared: '张角老巢已被击破',
    endsIn: (remaining: string) => `距结束 ${remaining}`,
    me: (killed: number, rank: number) => `我的贡献：歼敌 ${killed}（第 ${rank} 名）`,
    meNone: '我的贡献：还没有歼敌——出征营地即可累计',
    topTitle: '贡献榜',
    topRow: (rank: number, name: string, killed: number) => `${rank}. ${name} · 歼敌 ${killed}`,
    campsTitle: '营地与老巢',
    campRow: (label: string, x: number, y: number) => `${label} (${x},${y})`,
    growIn: (remaining: string) => `${remaining} 后升档`,
    strength: (min: number, max: number) => `守军约 ${min}–${max}`,
    locate: '定位',
    rewardsTitle: '名次奖励（结束发到主城）',
    rewardRow: (label: string, gold: number, res: number) => `${label}：金 ${gold} · 四资源各 ${res}`,
    bossStage: (stage: 'outer' | 'keeper', recovers: string | null) =>
      stage === 'keeper' ? `城守阶段${recovers ? `，${recovers} 前攻下否则外围恢复` : ''}` : '外围阶段：先清外围',
  },
  /** 地块详情 / 悬浮提示里的营地信息 */
  tile: {
    title: (label: string) => label,
    strength: (min: number, max: number) => `守军约 ${min}–${max}（精确编成派斥候侦察）`,
    growIn: (remaining: string) => `${remaining} 后升档`,
    attackHint: '出征同打野地（掠夺任务）；打赢营地消失并掉落资源与金币，歼敌数计入黄巾之乱贡献；营地不能占领',
    bossHint: '分外围与城守两段：外围清空后限时内可攻城守，超时外围恢复；打掉老巢事件收场并有首杀播报',
    legend: '黄巾营地（巾）/ 张角老巢（巢）',
  },
  broadcast: {
    started: (total: number) => `黄巾起事！地图上冒出 ${total} 处黄巾营地，全服一起清剿`,
    grown: (count: number, label: string) => `${count} 处黄巾营地坐大，升为${label}`,
    boss: (x: number, y: number) => `营地清剿过八成，张角老巢出现在 (${x},${y})`,
    firstKill: (actor: string) => `${actor} 击破张角老巢，拿下首杀！`,
    finished: (reason: string, cleared: number, total: number, scattered: number) =>
      reason === 'boss_cleared'
        ? `黄巾之乱平定：老巢被击破（营地清剿 ${cleared}/${total}），${scattered} 处残营散成流寇`
        : `黄巾之乱到时限收场：营地清剿 ${cleared}/${total}，${scattered} 处营地散成流寇`,
  },
  event: {
    campWon: (label: string, pos: string, killed: number, loot: string) =>
      `清剿${label} ${pos} 得手：歼敌 ${killed}，掠得${loot || '（负重不足）'}`,
    campLost: (label: string, pos: string, killed: number) => `进攻${label} ${pos} 失败，仍歼敌 ${killed}（计入贡献）`,
    bossOuter: (pos: string, killed: number) => `清空张角老巢 ${pos} 外围，歼敌 ${killed}，限时内可攻城守`,
    bossWon: (pos: string, killed: number, loot: string) => `击破张角老巢 ${pos}！歼敌 ${killed}，掠得${loot || '（负重不足）'}`,
    reward: (tier: string, rank: number, killed: number, reward: string) =>
      `黄巾之乱结算：歼敌 ${killed}，第 ${rank} 名（${tier}），奖励${reward}已发到主城`,
  },
  report: { kind: '黄巾营地' },
  tierLabel: { small: '黄巾营地（小）', medium: '黄巾营地（中）', large: '黄巾营地（大）', boss: '张角老巢' } as Record<string, string>,
};
