// 组件/拼装层内联文案集中（AISLG-137）：state/ 会话层与 api/ 拼装层里用户可见的内联中文
// 从各函数体挪到这里统一维护，经 i18n/bundle 的文案包取用（getCopy().EXTRA_STATE）。
// 分组按来源文件 / 语义划分；函数键 = 按语言差异重组的整句模板，字符串键 = 兜底名与标点。
// 英文孪生见 copy-extra-state-en.ts（satisfies 本文件类型，漏译在 tsc 报错）；
// 英文版一律半角标点，中文版保留原样。加键前先查 copy*.ts 是否已有同义键，能复用就不重复建。

export const EXTRA_STATE = {
  /** api/mapping.ts：兜底名与标点拼装（括号 / 列表分隔 / 返还后缀随语言变化） */
  mapping: {
    unknownBuilding: '未知建筑',
    unknownTroop: '未知兵种',
    wildTerrain: '野地',
    /** 断粮预警 / 哗变事件的城市名兜底 */
    cityFallback: '城池',
    /** 流寇掠夺事件的资源名兜底 */
    resourceFallback: '资源',
    /** 运输送达事件的城名兜底 */
    targetCityFallback: '目标城',
    /** 收到运输事件的来处城名兜底 */
    otherCityFallback: '另一座城',
    /** 截击事件传给 MOVING_COPY.event.intercepted / lost 的目标标签 */
    movingTargetLabel: '移动目标',
    /** 黄巾营地档位标签的兜底 */
    ytCampFallback: '黄巾营地',
    /** 全服播报与名将播报里缺失玩家名时的兜底 */
    unknownPlayer: '某位玩家',
    noLoot: '（无战利品）',
    noPlunder: '（负重不足或无可抢）',
    /** 资源组后缀的括号对：中文全角、英文半角 */
    paren: (s: string) => `（${s}）`,
    /** 兵种清单等中文顿号分隔（英文逗号） */
    listSep: '、',
    /** 取消事件的返还后缀：`，返还（金 100）` */
    refundSuffix: (s: string) => `，返还${s}`,
  },
  /** api/mapping.ts scoutCompletedText：侦察完成事件的一句话摘要 */
  scout: {
    done: (pos: string) => `侦察 ${pos} 完成`,
    doneRough: (pos: string, summary: string) => `侦察 ${pos} 完成：${summary}`,
    doneGarrison: (pos: string, garrison: string, wall: string) => `侦察 ${pos} 完成：守军 ${garrison}${wall}`,
    wallDefense: (percent: number) => `，城墙减伤 ${percent}%`,
    garrisonNone: '无',
  },
  /** api/mapping.ts baseEventText：建造事件 */
  build: {
    fromQueue: (name: string, action: string) => `${name}从队列开工（${action}）`,
    start: (name: string, action: string, cost: string) => `发起${name}${action}${cost}`,
    queued: (name: string, action: string, cost: string) => `${name}${action}加入队列${cost}`,
    completed: (name: string, action: string) => `${name}${action}完成`,
    cancelled: (name: string, action: string, refund: string) => `取消${name}${action}${refund}`,
  },
  /** api/mapping.ts baseEventText：征兵事件 */
  recruit: {
    fromQueue: (name: string, count: number) => `${name} ×${count}从队列开始征募`,
    start: (name: string, count: number, cost: string) => `开始征募${name} ×${count}${cost}`,
    queued: (name: string, count: number, cost: string) => `${name} ×${count}加入征兵队列${cost}`,
    completed: (name: string, count: number) => `${name} ×${count}征募完成，已入城驻军`,
    cancelled: (name: string, count: number, refund: string) => `取消征募${name} ×${count}${refund}`,
  },
  /** api/mapping.ts baseEventText：行军 / 野地 / NPC / 预警 / 玩家攻防等事件 */
  event: {
    cityRenamed: (from: string, to: string) => `城池改名：${from} → ${to}`,
    accountReset: '账号数据已重置，回到开号初始状态',
    marchTaskPlunder: '（掠夺）',
    marchTaskOccupy: '（占领）',
    marchReturn: (pos: string, clock: string) => `驻军自 ${pos} 启程返城，预计 ${clock} 到达`,
    marchOut: (task: string, pos: string, troops: string, clock: string) =>
      `部队出征${task} → ${pos}（${troops}），预计 ${clock} 到达`,
    marchArrived: (pos: string) => `行军到达 ${pos}`,
    /** 名城外围阶段获胜（v24 AISLG-56）：survivors 为空时无幸存尾注 */
    outerCleared: (name: string, pos: string, survivors: string) =>
      `清剿名城${name} ${pos} 外围获胜，外围已清空，限时内可攻城守${survivors ? `（幸存 ${survivors} 返程）` : ''}`,
    pvpSeized: (pos: string, owner: string, survivors: string) =>
      `抢占 ${pos}（${owner} 的野地）获胜，地块已归你${survivors ? `，幸存 ${survivors} 驻守` : ''}`,
    occupiedBranch: (pos: string, survivors: string) =>
      `进攻 ${pos} 获胜，已占领为分城${survivors ? `，幸存 ${survivors} 进城驻守` : ''}`,
    wonNotOccupied: (pos: string, reason: string, survivors: string) =>
      `进攻 ${pos} 获胜但未占领（${reason}），幸存部队返程${survivors ? `（${survivors}）` : ''}`,
    wonLoot: (pos: string, loot: string, survivors: string) =>
      `进攻 ${pos} 获胜：掠得${loot}${survivors ? `，幸存 ${survivors}` : ''}`,
    pvpCityWhere: (pos: string, owner: string) => `${pos}（${owner} 的城）`,
    plunderWon: (where: string, loot: string, survivors: string) =>
      `掠夺 ${where} 得手：掠得${loot}${survivors ? `，幸存 ${survivors} 返程` : ''}`,
    battleLost: (pos: string, survivors: string) =>
      `进攻 ${pos} 失败${survivors ? `，残部撤回（${survivors}）` : '，出击部队全灭'}`,
    reinforced: (pos: string, troops: string) => `增援 ${pos} 并入驻军（${troops}）`,
    returnedGarrison: (troops: string) => `部队返程回城并入驻军（${troops}）`,
    aborted: (pos: string, cause: string, cargoTail: string) =>
      `目标 ${pos} 已不可攻击${cause}，部队原路返回${cargoTail}`,
    /** abort 原因（cause 码 → 后缀） */
    cause: {
      target_gone: '（目标已失效）',
      owner_changed: '（目标已易主）',
      TILE_PROTECTED: '（地块换主保护中）',
      NEWBIE_PROTECTED: '（对方新手保护中）',
      TARGET_IN_TRUCE: '（对方免战中）',
    } as Record<string, string>,
    wildOccupied: (pos: string, terrain: string, level: string, bonus: string, gather: string) =>
      `占领野地 ${pos}：${terrain} Lv${level}${bonus}${gather}`,
    wildBonus: (resource: string, rate: number) => `，${resource} +${rate}/h`,
    wildGather: (rate: number) => `（采集 +${rate}/h）`,
    wildRecall: (pos: string) => `撤回驻军，放弃野地 ${pos}`,
    wildConquest: (pos: string, by: string) => `野地 ${pos} 被${by ? `玩家 ${by} ` : ''}抢占，占领失效`,
    wildLost: (pos: string) => `野地 ${pos} 失守，占领失效`,
    npcCityOccupied: (pos: string, name: string, loot: string) =>
      `占领 NPC 城池 ${pos} 为分城${name ? `「${name}」` : ''}${loot ? `，接收库存${loot}` : ''}`,
    npcRaidRepelled: (pos: string, losses: string) => `NPC 袭击 ${pos} 被击退${losses ? `，损失 ${losses}` : ''}`,
    npcRaidWiped: (pos: string) => `NPC 袭击 ${pos}，驻军全灭、占领失效`,
    npcWarning: (target: string, arriveAt: string, mins: string, armyMin: string, armyMax: string) =>
      `斥候发现一支 NPC 部队正向 ${target} 进发，预计 ${arriveAt} 到达${mins}，兵力约 ${armyMin}–${armyMax}`,
    minutesLeft: (n: number) => `，约 ${n} 分钟后`,
    playerWarning: (who: string, where: string, arriveAt: string, mins: string, armyMin: string, armyMax: string) =>
      `烽火台示警：${who} 正向${where}进发，预计 ${arriveAt} 到达${mins}，兵力约 ${armyMin}–${armyMax}`,
    playerUnknown: '一支玩家部队',
    playerTargetWild: (pos: string, terrain: string, level: number | null) =>
      `你占领的野地 ${pos}${terrain ? ` ${terrain}` : ''}${level !== null ? ` Lv${level}` : ''}`,
    playerTargetCity: (pos: string) => `你的城 ${pos}`,
    pvpUnknown: '未知玩家',
    pvpRepelled: (who: string, pos: string, losses: string) =>
      `${who} 进攻你的城 ${pos} 被击退${losses ? `，损失 ${losses}` : ''}`,
    pvpDefenseLine: (before: string, after: string) => `城防值 ${before} → ${after}`,
    pvpTransferred: (who: string, pos: string, defense: string) =>
      `${who} 攻破了你的分城 ${pos}——城防归零，城已易主（${defense}）`,
    pvpTruceUntil: (clock: string) => `，城免战至 ${clock}`,
    pvpRamBonus: (ram: number) => `，含冲车 +${ram}`,
    pvpConquestHit: (who: string, defense: string, damage: string, ramTail: string, truce: string) =>
      `${who} 攻破了你的城防（${defense}，一击 −${damage}${ramTail}）${truce}`,
    pvpTrucePeriodUntil: (clock: string) => `，城进入免战期至 ${clock}`,
    pvpLooted: (who: string, pos: string, loot: string, truce: string) =>
      `${who} 攻破了你的城 ${pos}，被掠${loot}${truce}`,
    pvpNoLoot: '空手而归',
    /** city_conquered 事件的城名兜底 */
    branchFallback: '分城',
    conquestLost: (cityName: string, pos: string, by: string) =>
      `你的分城「${cityName}」${pos} 被${by ? `玩家 ${by} ` : ''}占领，城防归零易主（野地已无主、在外部队回主城）`,
    conquestGained: (from: string, cityName: string, pos: string, until: string) =>
      `占领了${from ? ` ${from} 的` : ''}分城「${cityName}」${pos}：建筑与资源已接收、城防回满${until}`,
    protectionUntil: (clock: string) => `，保护期至 ${clock}`,
    truceStarted: (until: string) => `主动免战开启，至 ${until}（期间别人打不了你，你也不能出兵打玩家）`,
    newbieCauseGovernment: '官府升级',
    newbieCauseAttack: '主动进攻其他玩家',
    newbieEnded: (cause: string) => `新手保护结束（${cause}）：此后可被其他玩家侦察 / 攻击`,
    agentConnected: 'Agent 连接上线',
    agentDisconnected: 'Agent 连接离线',
  },
  /** api/mapping.ts serverBroadcastText：全服播报 */
  broadcast: {
    npcCityEmptied: (actor: string, level: string, pos: string) => `${actor} 掠空了 NPC 城池 Lv${level} ${pos}`,
    goldMineFirst: (actor: string, pos: string) => `${actor} 首个占领了金矿 ${pos}`,
    cityBroken: (actor: string) => `${actor} 的主城被 NPC 攻破`,
    winStreak: (actor: string, streak: string) => `${actor} 的军队一小时内连胜 ${streak} 场`,
    cityConquered: (actor: string, from: string, cityName: string, pos: string) =>
      `${actor} 攻占了${from ? ` ${from} 的` : '他人的'}分城「${cityName}」${pos}`,
    headline: (type: string) => `全服大事：${type}`,
  },
  /** api/mapping.ts：占领未成功的原因（battle_won 事件 detail.denial） */
  denial: {
    TERRITORY_LIMIT: '已达官府占领上限',
    GOVERNMENT_TOO_LOW: '主城官府不足 3 级',
    BRANCH_LIMIT: '分城数量已达上限',
    TARGET_LEVEL_TOO_HIGH: '目标城等级高于出发城官府等级',
  } as Record<string, string>,
  /** api/errorText.ts：本地兜底的人读提示（错误码映射仍在 errorText.ts） */
  errorText: {
    heroGoldInsufficient: '金币不足，招募费 = 500 + 三项属性合计 × 20',
    newbieProtected: '对方处于新手保护期（注册 3 天或官府 5 级前），不能被侦察 / 攻击；等保护结束再打',
    targetInTruce: '对方处于免战期（被打后免战或主动免战），期间不能再被攻击',
    selfTruceActive: '你的主动免战生效中，不能出兵攻打玩家（打野地 / NPC 不受影响）',
    tileProtected: '该野地刚换主人，处于保护期（约 1 小时基准随倍速缩短），期间不能再抢',
    movingTargetGone: '该移动目标已消失（被击败或过时），请重新选择目标',
    /** 资源缺口后缀：parts 为「粮 200 / 石 50」样式清单，eta 为既有的攒够预估片段 */
    shortfall: (parts: string, eta: string) => `，还缺 ${parts}${eta}`,
    populationShortfall: (missing: number, eta: string) => `，还差 ${missing} 人口${eta}`,
  },
  /** api/client.ts：连接类错误（会以 err.message 展示在登录 / 动作错误位） */
  client: {
    connectFailedCode: (code: number) => `连接失败（close code ${code}）`,
    notConnected: '连接未建立',
    requestTimeout: (op: number) => `请求 op=${op} 超时`,
    closed: '连接已关闭',
    disconnected: '连接已断开',
  },
  /** state/ 会话层的一次性内联文案 */
  state: {
    /** 动作被拒的本地事件里，服务端 message 缺失时的兜底 */
    rejectedFallback: '失败',
    recallNoGarrison: (x: number, y: number) => `召回 (${x},${y})：地块已无驻军，占领已清除`,
    scoutFailed: '侦察发起失败',
    recallMarchFailed: '行军撤回失败',
    /** state/googleGsi.ts：GSI 脚本加载失败（err.message 会展示在登录位） */
    gsiTimeout: 'Google 脚本加载超时',
    gsiInitFailed: 'Google 脚本已加载但初始化失败',
    gsiLoadFailed: 'Google 脚本加载失败（需要能访问 Google 的网络）',
  },
  /** api/heroEventText.ts：武将名兜底 */
  hero: {
    nameFallback: '武将',
  },
};
// 不写 as const：英文孪生（copy-extra-state-en.ts）以本对象的类型为基准（satisfies typeof）。
