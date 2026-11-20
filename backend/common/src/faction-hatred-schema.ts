// 五方势力记仇（AISLG-264，v116）的表结构：只加不改。
//
// faction_hatred：每家势力对每个账号的**报复**仇恨（随换季清空，season-tables.ts 的 RESET_TABLES）。
//  - key / account_id：哪一家、哪个账号（复合主键：一家一行）；
//  - retaliation：累计报复仇恨（打这家老巢每场歼灭的守军战力，1:1 累加，与 faction_contrib 同口径）；
//    这只是「累计原值」，**读和写时都按半衰期（3 天，随 time_scale 缩放）折算**，折算后小于 1 视为 0，
//    所以不需要每天扫全表（见 faction-hatred.ts 的 factionHatredDecayedRetaliation）；
//  - updated_at：最后一次累加的时刻（折算的起点）。
// 基础仇恨（全服战力榜前 20 名）不入库：它是「当前榜单 × 这家 G1」的派生值，榜单每天刷新一次，
// 快照存 settings（key = 'faction_hatred_base_ranks'，value = { at, ranks: [{ accountId, rank }] }），
// 不随换季删除——下次读取时按「超过一天」或「快照早于本季开始」立即重算。
// faction_contrib 仍是灭亡榜单用的累计值，不衰减，与本表各算一套（需求「faction_contrib 保持原样」）。

export const FACTION_HATRED_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS faction_hatred (
  key text NOT NULL,
  account_id uuid NOT NULL,
  retaliation bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, account_id)
);
`;