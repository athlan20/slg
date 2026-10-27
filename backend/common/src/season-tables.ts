// 换季时各表的去向（AISLG-134，docs/season-system.md §2.3）：每一张表必须且只能归入一类。
// - KEEP：换季后保留（账号身份与登录、运行时配置、公告、聊天屏蔽等）；
// - RESET：换季时清空（世界数据与账号游戏态、榜单快照）；
// - ARCHIVE：赛季历史（名人堂存档与荣誉），换季只追加、永不清空。
// 新增表时必须同步归类：单测 test/season-tables.test.ts 对照 information_schema 断言“所有表都已归类”。
// 清空的执行顺序与方式（DELETE / TRUNCATE、外键顺序）由换季引擎决定，这里只定义集合。

/** 换季后保留的表（账号行保留，赛季字段在 accounts 上单独重置） */
export const KEEP_TABLES: readonly string[] = [
  'accounts',
  'sessions',
  'agent_tokens',
  'wechat_identities',
  'google_identities',
  'oauth_identities',
  'settings',
  'announcements',
  'announcement_reads',
  'chat_blocks',
  // 联盟（v66，AISLG-181）：联盟本身与成员关系跨季保留（账号保留，社交关系随之保留）
  'alliances',
  'alliance_members',
];

/** 换季时清空的表：世界级 + 账号级游戏态 + 榜单快照 */
export const RESET_TABLES: readonly string[] = [
  // 世界级
  'world_tiles',
  'tile_army',
  'native_garrison_state',
  'famous_cities',
  'npc_attacks',
  'moving_targets',
  'yt_events',
  'yt_camps',
  'yt_contrib',
  'city_discards',
  // 账号级游戏态
  'cities',
  'city_buildings',
  'city_army',
  'builds',
  'recruits',
  'city_defenses',
  'defense_crafts',
  'city_assist',
  'marches',
  'battle_reports',
  'scout_intel',
  'events',
  'account_techs',
  'tech_research',
  'account_heroes',
  'tavern_candidates',
  'famous_heroes',
  'hero_unlocks',
  'hero_friendship',
  'arena_entries',
  'arena_daily',
  'arena_matches',
  'star_tower_progress',
  'star_tower_matches',
  'quest_claims',
  'quest_claims_once',
  'signin_state',
  'agent_plans',
  'agent_daily_reports',
  'win_streaks',
  'leaderboard_snapshots',
  'leaderboard_model_snapshots',
  'server_broadcasts',
  'chat_messages',
  'chat_reads',
  // 联盟的申请与邀请（v66，AISLG-181）：换季清空；联盟频道消息在 chat_messages 里一并清
  'alliance_requests',
  'alliance_invites',
  // 联盟地图标记（v69，AISLG-184）：换季清空
  'alliance_marks',
  // 联盟榜快照（v70，AISLG-185）：与 leaderboard_snapshots 同理，换季清空（换季前已存档前三）
  'alliance_leaderboard_snapshots',
  // 剧本战场（v75，AISLG-198）：战场、报名 / 队伍 / 据点 / 军功与商店额度都随赛季清空
  'battlefield_events',
  'battlefield_participants',
  'battlefield_squads',
  'battlefield_strongholds',
  'battlefield_merit',
  'battlefield_purchases',
];

/** 赛季历史：只追加，换季不清空 */
export const ARCHIVE_TABLES: readonly string[] = [
  'seasons',
  'season_archives',
  'season_archive_models',
  'season_honors',
];
