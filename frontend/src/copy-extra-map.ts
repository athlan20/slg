// 地图与世界视图组件内联文案集中（AISLG-137）：components/map/、components/map/forms/ 与
// components/ 根下世界视图文件里用户可见的内联中文从各组件挪到这里统一维护，
// 经 i18n/bundle 的文案包取用（useCopy().EXTRA_MAP / getCopy().EXTRA_MAP）。
// 分组按语义划分：tileGlyphs = 地图格单字图形字符（窄格展示，英文 1-2 字符短码），
// 其余为各组件的内联文案。英文孪生见 copy-extra-map-en.ts（satisfies 本文件类型，漏译在 tsc 报错）；
// 英文版一律半角标点，中文版保留原样。加键前先查 copy*.ts 是否已有同义键，能复用就不重复建。

export const EXTRA_MAP = {
  /** 地图格上的单字图形字符（CityMark / WorldTileBadges / TargetHeader 图标）：窄格展示，英文用 1 字符短码 */
  tileGlyphs: {
    /** 城池（本方 / 他方玩家城共用） */
    city: '城',
    /** 名城 */
    famous: '名',
    /** 黄巾营地 */
    ytCamp: '巾',
    /** 张角老巢 */
    ytBoss: '巢',
    /** 流寇 */
    bandit: '寇',
    /** 运粮商队 */
    caravan: '商',
    /** 敌方城池图标（TargetHeader） */
    enemy: '敌',
    /** 野地图标兜底（TargetHeader，取地形名首字失败时） */
    wild: '野',
    /** 势力老巢（v99，AISLG-239：地图与迷雾层上的单字标记） */
    factionLair: '势',
    /** 老巢废墟（v101，AISLG-241：这家本季已灭亡） */
    factionLairRuins: '墟',
  },
  /** 顶栏主动免战按钮的单字图形（TruceShieldBadge） */
  truceBadge: {
    glyph: '免',
  },
  /** worldMapTip：地块标题 / 归属说明 / 读屏文案的内联片段 */
  tileTip: {
    ownCity: '本方城池',
    playerCity: '玩家城池',
    /** 野地无主时（npc_city 兜底同源） */
    npcGuard: 'NPC 守城',
    yourCity: '你的城池',
    ownOccupied: '本方占领',
    /** 城池归属行 */
    owner: (name: string) => `城主：${name}`,
    /** 读屏文案里标题与归属的分隔（中文全角逗号） */
    ariaSep: (owner: string) => `，${owner}`,
  },
  /** 图层开关新增的两项（AISLG-216）：流寇·商队 / 黄巾 / 领地三条既有文案在 copy-pages 的 MAPUI_COPY */
  layers: {
    marches: '行军',
    yield: '产出',
    /** 手机端图层入口按钮与面板（AISLG-231）：宽度 < 640px 时横排复选框收进这里 */
    button: '图层',
    /** 面板的读屏名称 */
    panelAria: '地图图层',
  },
  /** 行军图层（AISLG-216）：任务单字、倒计时、图标提示、同格合并与视野外箭头 */
  march: {
    /** 图标里的单字（英文用任务英文首字母，返程用 ↩） */
    glyph: {
      plunder: '掠',
      occupy: '占',
      reinforce: '援',
      attack: '攻',
      scout: '侦',
      transfer: '调',
      transport: '运',
      intercept: '截',
      return: '返',
      assist: '协',
    },
    /** 同一格多支部队的角标 */
    stack: (count: number) => `×${count}`,
    /** 视野外箭头超过上限时的合并角标 */
    overflow: (count: number) => `+${count}`,
    /** 截击到埋伏点后的倒计时（到接战时刻） */
    ambushLeft: (time: string) => `埋伏 ${time}`,
    /** 图标提示：兵力 / 目标 / 剩余 */
    tipTroops: (total: number) => `兵力 ${total}`,
    tipTarget: (x: number, y: number) => `目标 (${x},${y})`,
    tipLeft: (time: string) => `剩余 ${time}`,
    /** 同格多支部队的选单标题 */
    stackTitle: (count: number) => `同一格 ${count} 支部队`,
    /** 视野外箭头的提示 */
    arrowHint: '点击跳到行军所在位置',
    /** 图标提示里的操作说明（手机上先出提示、再点一次开详情） */
    detailHint: '再点一次查看行军详情',
  },
  /** 敌人来袭标记（AISLG-216）：目标格上的红标与倒计时 */
  /** 战争迷雾（AISLG-224）：未探索的黑雾、已探索的角标、探索简报与小地图进度 */
  fog: {
    unknownTitle: '未探索：这里是黑雾，派斥候或部队过去才能看到',
    exploredTitle: (time: string) => `已探索 · 上次看到 ${time}`,
    unknownNotice: (x: number, y: number) => `目标 (${x}, ${y}) 在迷雾中，情况未知`,
    exploredPercent: (pct: number) => `已探索 ${pct}%`,
    reportTitle: '探索简报',
    reportSummary: (chunks: number) => `新探索 ${chunks} 个区块`,
    reportCells: '发现的坐标（点击跳转）',
    reportClose: '关闭',
    reportKind: {
      famous: '名城',
      wild_hero: '在野名将',
      gold_mine: '金矿',
      player_city: '玩家城',
      npc_city: 'NPC 城',
      high_wilderness: '高级野地',
      relic: '遗迹',
    } as Record<string, string>,
    rumor: '名城大致方位',
    relicTier: { common: '普通遗迹', rare: '稀有遗迹', legendary: '传说遗迹' } as Record<string, string>,
    relicKind: {
      granary: '废弃粮仓', lumberyard: '荒废林场', quarry: '旧采石场', ironworks: '废弃铁坊', caravan: '商队遗骸',
      battlefield: '古战场', treasury: '前朝府库', mausoleum: '帝王陵寝',
    } as Record<string, string>,
    siteName: { 茅庐: '茅庐', 关公庙: '关公庙', 子龙庙: '子龙庙', 桃园: '桃园', 铜雀台: '铜雀台', 甘露寺: '甘露寺', 点将台: '点将台', 司马故里: '司马故里' } as Record<string, string>,
    heroSiteLabel: (site: string, hero: string, claimed: boolean) => (claimed ? `${site}（${hero}）· 已出山` : `${site}（${hero}）· 名将处所`),
    firstExplorer: (name: string) => `首探者：${name}`,
    noFirstExplorer: '尚无人首探',
    claimed: '已出山',
    heroSiteTag: '名将处所',
    detailReward: '领取奖励',
    claimHint: '派一支部队到达即可领取，全服先到先得，每天最多 2 处',
    moveCity: '迁城令',
    heroLabel: (hero: string) => `名将：${hero}`,
    heroClaimed: '名将已出山：处所与名字保留，首探只发资源，不再给结交资格',
    heroNotClaimed: '名将未出山：首探者不打守军即可结交，其他人打赢守军也可结交',
    reportRelics: (n: number) => `发现遗迹 ${n} 处`,
    /** 视野半径说明里的一行（AISLG-232）：望楼把这块野地的视野扩到 6 / 8 / 10 格 */
    watchtowerVision: '望楼：6 / 8 / 10 格（取代野地原来的 3 格）',
    /** 视野半径说明里的一行（AISLG-233）：丘陵上的野地与望楼再加 2 格 */
    hillVision: '丘陵上的野地和望楼视野 +2',
  },
  /** 丘陵视野（AISLG-233）：丘陵野地的详情里在地形之后补一行 */
  hillVision: {
    detail: '高地：视野 +2',
  },
  /** 望楼（AISLG-232，v97）：地图标记、详情区里的建造 / 升级一栏 */
  watchtower: {
    /** 地图格上的小标记（单字；英文用 W) */
    glyph: '望',
    title: (level: number, radius: number) => `望楼 Lv${level}（视野 ${radius} 格）`,
    aria: (level: number) => `望楼 ${level} 级`,
    /** 详情区标题与等级行 */
    sectionTitle: '望楼',
    levelLine: (level: number, radius: number) => `${level} 级 · 视野 ${radius} 格`,
    noneLine: '这块地上还没有望楼',
    build: '建造',
    upgrade: '升级',
    building: (target: number) => `建造中（升到 ${target} 级）`,
    buildingUpgrade: (target: number) => `升级中（升到 ${target} 级）`,
    left: (time: string) => `剩余 ${time}`,
    costLine: (gold: number, wood: number, stone: number) => `花费 金 ${gold} / 木 ${wood} / 石 ${stone}`,
    timeLine: (time: string) => `耗时 ${time}`,
    costAndTime: (gold: number, wood: number, stone: number, time: string) => `金 ${gold} / 木 ${wood} / 石 ${stone} · ${time}`,
    maxLevel: '已满级（3 级）',
    quota: (count: number, limit: number) => `本城望楼 ${count}/${limit}`,
    quotaFull: (limit: number) => `本城望楼已满 ${limit} 座（升级现有望楼不受限制）`,
    fogOff: '迷雾未开启：望楼照常可建，但不产生视野效果',
    /** 别人的望楼（不含进度） */
    othersLine: (level: number, radius: number) => `这里的望楼 ${level} 级（视野 ${radius} 格）`,
    /** 发起建造后写进事件流的一句 */
    startedLog: (x: number, y: number) => `已开工：(${x}, ${y}) 的望楼`,
    /** 失败提示（服务端错误码 → 人读文案） */
    errors: {
      tileInvalid: '只能在自己占领的野地上建望楼',
      maxLevel: '这块地的望楼已满级（3 级）',
      building: '这块地的望楼正在建造 / 升级中',
      limit: '这座城的望楼已满 2 座（升级现有望楼不受限制）',
      fallback: '望楼建造失败，请稍后再试',
    },
  },
  raid: {
    label: (time: string) => `来袭 ${time}`,
    /** 视野外红色箭头的提示 */
    arrowHint: '点击跳到被袭击的格子',
  },
  /** 他人部队图层（AISLG-230）：图例、图标提示与规模档位；颜色依次为来袭 / 敌对 / 中立 / 同盟友盟 */
  enemyMarch: {
    legend: '他人部队',
    /** 图标里的单字（英文用短码 E = Enemy） */
    glyph: '他',
    legendIncoming: '来袭自己',
    legendHostile: '敌对',
    legendNeutral: '中立',
    legendFriend: '同盟 / 友盟',
    /** 规模档位（协议值 small / medium / large） */
    scale: {
      small: '小股',
      medium: '中军',
      large: '大军',
    } as Record<string, string>,
    /** 图标提示：玩家名 / 联盟 / 规模 / 去程还是返程 */
    tipOwner: (name: string) => `玩家：${name}`,
    tipAlliance: (name: string) => `联盟：${name}`,
    tipNoAlliance: '联盟：无',
    tipScale: (label: string) => `规模：${label}`,
    tipReturning: '返程中',
    tipOutbound: '前往目标',
    /** 提示底部说明：看不到目标与时刻，也不发起交互 */
    tipNote: '只能看到视野内的部队，看不到目标与到达时间',
    /** 读屏文案 */
    aria: (owner: string, scale: string, returning: boolean) =>
      `${owner} 的部队 · ${scale} · ${returning ? '返程中' : '前往目标'}`,
  },
  /** 领地图例（AISLG-216）：四种关系色 + 连片加成金边 */
  territoryLegend: {
    own: '自己',
    ally: '盟友',
    hostile: '敌对',
    other: '其他玩家',
    cluster: '金边 = 连片加成',
  },
  /** 产出图层（AISLG-216）：资源图标单字、产量与储量的提示 */
  yield: {
    /** 资源图标单字（与顶栏资源栏同一套资源名取首字） */
    glyph: {
      food: '粮',
      wood: '木',
      stone: '石',
      iron: '铁',
      gold: '金',
    },
    rate: (amount: string) => `产出 +${amount}/小时`,
    reserveValue: (current: string, cap: string) => `储量 ${current}/${cap}`,
    etaEmpty: (clock: string) => `预计 ${clock} 采空`,
    etaFull: (clock: string) => `预计 ${clock} 回满`,
    tier: {
      ample: '储量充足',
      normal: '储量一般',
      depleted: '储量枯竭',
    },
    /** 采空不等于没有产出：占领加成照拿，驻军采集降到恢复速度 */
    depletedNote: '采空后占领加成照拿，驻军采集降到恢复速度',
    /** 只给图标时的读屏文案 */
    aria: (resource: string, amount: string) => `产出 ${resource} +${amount}/小时`,
  },
  /** MapZoomControls：缩放控件文案 */
  zoom: {
    zoomIn: '放大',
    zoomOut: '缩小',
    reset: '复位',
    view: (w: number, h: number) => `视野 ${w}×${h}`,
    atMin: '已放到最大',
    atMax: '已缩到最小',
    zoomInHint: '放大（Ctrl+滚轮向上 / + / 双指张开）',
    zoomOutHint: '缩小（Ctrl+滚轮向下 / - / 双指捏合）',
  },
  /** worldPanelText：小时 + 分钟的时长拼装（保护状态 / 掠夺冷却剩余）；m = 不足一小时只给分钟 */
  duration: {
    hm: (hours: number, minutes: number) => `${hours} 小时 ${minutes} 分`,
    m: (minutes: number) => `${minutes} 分`,
  },
  /** 五方势力（v99，AISLG-239）：图层开关 / 面板 / 范围与老巢标记 / 半径扩大的播报 */
  faction: {
    /** 图层面板里的开关名 */
    layer: '势力范围',
    /** 面板标题与读屏名称 */
    panelTitle: '五方势力',
    panelAria: '五方势力面板',
    /** 面板每行的字段标签 */
    leaderLabel: '首领',
    lairLabel: '老巢',
    radiusLabel: '范围',
    citiesLabel: '持城',
    /** 半径单位（格） */
    radius: (radius: number) => `${radius} 格`,
    /** 持城数单位（座） */
    cities: (count: number) => `${count} 座`,
    /** 老巢坐标（(x, y)） */
    lair: (x: number, y: number) => `(${x}, ${y})`,
    /** 地图上老巢标记的提示 */
    lairHint: (name: string, leader: string) => `${name}老巢 · 首领${leader}`,
    /** 势力城地块的悬浮说明 */
    cityHint: (name: string) => `${name}势力城`,
    /** 老巢地块的悬浮说明 */
    lairTile: (name: string) => `${name}老巢`,
    /** 势力范围色块的读屏文本 */
    cellAria: (name: string) => `${name}势力范围`,
    /** 全服播报：半径扩大（每周最多一次） */
    broadcastExpanded: (radius: number) => `五方势力扩张：势力范围半径扩大至 ${radius} 格`,
    /** 老巢：城墙减伤（AISLG-241） */
    lairWall: '城墙减伤 50%',
    /** 老巢的进攻按钮 */
    lairAttack: '进攻',
    /** 老巢的出征说明 */
    lairAttackHint: '一次只打当前一营，打掉多少算多少，打输也算。按歼灭的守军战力当场发金币和资源，不占部队负重。',
    /** 老巢废墟的提示（v101，AISLG-241：这家本季已被攻破） */
    lairHintRuins: (name: string) => `${name}老巢已被攻破，本季只剩废墟`,
    /** 面板：营数（剩余 / 总数） */
    camps: (remaining: number, total: number) => `${remaining}/${total} 营`,
    /** 面板：当前营剩余百分比 */
    campRemaining: (percent: number) => `当前营 ${percent}%`,
    /** 面板：本季已灭亡 */
    destroyed: '已灭亡',
    /** 战报类别名（打老巢） */
    reportKind: '势力老巢',
    /** 全服播报：这家势力被攻破（带最后一击的玩家名） */
    broadcastDestroyed: (actor: string, faction: string, leader: string) =>
      `${actor} 攻破了${faction}老巢，${faction}本季灭亡，首领${leader}归其所有`,
    /** 攻破老巢（v101，AISLG-241）：战斗 / 灭亡奖励 / 灭亡的事件文案 */
    lairBattle: {
      /** 打老巢的一场战斗：势力名 + 第几营 + 歼灭战力 + 当场奖励 + 输赢（打输也发奖） */
      battle: (name: string, campNo: number, killedPower: number, gold: number, outcome: 'won' | 'lost') =>
        outcome === 'won'
          ? `你攻破${name}老巢第 ${campNo} 营：歼灭守军战力 ${killedPower}，当场得金币 ${gold}（按歼灭战力发放，不占负重）`
          : `你进攻${name}老巢第 ${campNo} 营未克：守军残血保留，仍歼灭战力 ${killedPower}，当场得金币 ${gold}（按歼灭战力发放，不占负重）`,
      /** 灭亡奖励：名次 + 金币 + 每种资源 */
      reward: (name: string, rank: number, gold: number, each: number) =>
        `${name}已被攻破：贡献榜第 ${rank} 名奖励金币 ${gold}、木粮石铁各 ${each}`,
      /** 最后一击的玩家：本季灭亡 + 首领名将归你 */
      destroyedByYou: (name: string, heroName: string) =>
        heroName
          ? `你打掉了${name}最后一营：${name}本季灭亡，首领名将${heroName}归你所有`
          : `你打掉了${name}最后一营：${name}本季灭亡（首领名将已被他人获得）`,
    },
    /** 势力出兵（v100，AISLG-240）：袭击旗号与围攻的文案，全部带势力名 */
    siege: {
      /** 势力袭击（普通 NPC 袭击打上旗号）的标题：如「南蛮来袭」 */
      raidTitle: (name: string) => `${name}来袭`,
      /** 势力袭击的出处行 */
      raidFrom: (name: string, x: number, y: number) => `${name}（老巢 (${x}, ${y})）`,
      /** 预警弹窗 / 警报胶囊的标题 */
      warningTitle: (name: string) => `${name}围攻`,
      /** 警报胶囊与军情摘要：哪家在打哪座分城 */
      alert: (name: string, cityName: string) => `${name}围攻 · ${cityName}`,
      /** 势力袭击的警报胶囊与军情摘要 */
      raidAlert: (name: string, target: string) => `${name}来袭 · ${target}`,
      /** 预警弹窗的目标行 */
      targetBranch: '你的分城',
      /** 预警弹窗的建议 */
      advice: '守军被全灭时扣 35 城防，城防归零这座城就被吞。来得及的话：增援驻军、请盟友协防。守住一次，这家 24 小时内不再打这座城。',
      /** 预警正文：兵力范围 + 预计到达 + 当前城防值 */
      warning: (name: string, where: string, arriveAt: string, mins: string, armyMin: string, armyMax: string, durability: string) =>
        `斥候来报：${name}围城军正向${where}进发，预计 ${arriveAt} 到达${mins}，兵力约 ${armyMin}–${armyMax}，当前城防 ${durability}`,
      /** 预警里的城防行 */
      durabilityLine: (durability: string) => `当前城防值 ${durability}`,
      /** 守住（势力打输） */
      repelled: (name: string, pos: string, durability: string) => `${name}围攻 ${pos} 被击退，城防 ${durability}`,
      /** 被扣城防（势力打赢一次） */
      hit: (name: string, pos: string, before: string, after: string, damage: string, truce: string) =>
        `${name}攻破 ${pos} 守军（城防 ${before} → ${after}，一击 −${damage}）${truce}`,
      /** 免战尾注 */
      truceUntil: (clock: string) => `，城免战至 ${clock}`,
      /** 城被吞 */
      swallowed: (name: string, pos: string) => `${name}吞下了你的分城 ${pos}（城防归零）`,
      /** 失城事件（faction_city_lost） */
      cityLost: (name: string, cityName: string, pos: string) =>
        `你的分城「${cityName}」${pos} 被${name}吞下：建筑与资源留在城里，分城名额已腾出，可在 4 小时后按占领 NPC 城的流程打回来`,
      /** 全服播报：某人的城被势力吞下 */
      broadcastSwallowed: (actor: string, cityName: string, faction: string, pos: string) =>
        `${actor} 的分城「${cityName}」${pos} 被${faction}吞下`,
    },
  },
  /** WorldReportsPanel：战报列表行的内联片段 */
  reports: {
    /** 非零损失编队摘要为空时的兜底 */
    lossesNone: '无',
    /** 战报结果（no_contact）：目标消失 / 扑空 */
    resultGone: '消失',
    resultMissed: '扑空',
    /** 侦察记录行摘要的城墙减伤口缀 */
    wallShort: (percent: number) => `城墙 ${percent}%`,
  },
};
// 不写 as const：英文孪生（copy-extra-map-en.ts）以本对象的类型为基准（satisfies typeof）。
