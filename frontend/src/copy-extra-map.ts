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
