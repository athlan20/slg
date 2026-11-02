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
  raid: {
    label: (time: string) => `来袭 ${time}`,
    /** 视野外红色箭头的提示 */
    arrowHint: '点击跳到被袭击的格子',
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
