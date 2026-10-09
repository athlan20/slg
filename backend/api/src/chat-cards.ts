// 聊天卡片快照（v51，AISLG-138）：发送那一刻由服务端生成。客户端只传 id / 坐标，归属与范围在这里校验。
// 玩家可自定义的文字（城名、账号名、战报里的双方名称）发出前过屏蔽词；其余字段是游戏数据，原样保留。

import pg from 'pg';
import { loadBattleReport } from '../../common/src/battle-db';
import type { BattleReportView } from '../../common/src/protocol-battle';
import type { ChatCardRequest, ChatCardView } from '../../common/src/protocol-chat';
import type { TerrainKind, TileKind } from '../../common/src/protocol-world';
import { inWorld } from '../../common/src/world';
import type { BannedWordFilter } from './chat-words';

type Q = pg.Pool | pg.PoolClient;

export interface BuiltChatCard {
  card: ChatCardView;
  /** 战报卡片的分享快照（不含 Agent 点评）；其他卡片为 null */
  reportDetail: Omit<BattleReportView, 'comment'> | null;
}

/** 按请求生成卡片快照；id 不属于本账号、坐标越界或地块不存在时返回 null（调用方转 INVALID_PARAMS） */
export async function buildChatCard(
  q: Q,
  accountId: string,
  request: ChatCardRequest,
  filter: BannedWordFilter,
): Promise<BuiltChatCard | null> {
  switch (request.kind) {
    case 'coord':
      return coordCard(q, request.x, request.y);
    case 'hero':
      return heroCard(q, accountId, request.heroId);
    case 'report':
      return reportCard(q, accountId, request.reportId, filter);
    case 'city':
      return cityCard(q, accountId, request.cityId, filter);
  }
}

async function coordCard(q: Q, x: number, y: number): Promise<BuiltChatCard | null> {
  if (!inWorld(x, y)) {
    return null;
  }
  const res = await q.query(`SELECT terrain, kind, level FROM world_tiles WHERE x = $1 AND y = $2`, [x, y]);
  if (!res.rowCount) {
    return null;
  }
  const row = res.rows[0] as { terrain: TerrainKind; kind: TileKind; level: number };
  // 玩家城池没有野地等级，统一按 0 展示
  const card: ChatCardView = {
    kind: 'coord',
    x,
    y,
    terrain: row.terrain,
    tileKind: row.kind,
    level: row.kind === 'city' ? 0 : row.level,
  };
  return { card, reportDetail: null };
}

async function heroCard(q: Q, accountId: string, heroId: string): Promise<BuiltChatCard | null> {
  const res = await q.query(
    `SELECT name, famous, level, lead, force, wit FROM account_heroes WHERE id = $1 AND account_id = $2`,
    [heroId, accountId],
  );
  if (!res.rowCount) {
    return null;
  }
  const row = res.rows[0] as { name: string; famous: boolean; level: number; lead: number; force: number; wit: number };
  const card: ChatCardView = {
    kind: 'hero',
    name: row.name,
    famous: row.famous,
    level: row.level,
    lead: row.lead,
    force: row.force,
    wit: row.wit,
  };
  return { card, reportDetail: null };
}

async function cityCard(q: Q, accountId: string, cityId: string, filter: BannedWordFilter): Promise<BuiltChatCard | null> {
  const res = await q.query(
    `SELECT c.name, c.x, c.y, a.username, COALESCE(g.level, 0)::int AS level
     FROM cities c
     JOIN accounts a ON a.id = c.account_id
     LEFT JOIN city_buildings g ON g.city_id = c.id AND g.kind = 'government'
     WHERE c.id = $1 AND c.account_id = $2`,
    [cityId, accountId],
  );
  if (!res.rowCount) {
    return null;
  }
  const row = res.rows[0] as { name: string; x: number | null; y: number | null; username: string; level: number };
  if (row.x === null || row.y === null) {
    return null;
  }
  const card: ChatCardView = {
    kind: 'city',
    name: filter.mask(row.name),
    ownerName: filter.mask(row.username),
    level: row.level,
    x: row.x,
    y: row.y,
  };
  return { card, reportDetail: null };
}

async function reportCard(q: Q, accountId: string, reportId: number, filter: BannedWordFilter): Promise<BuiltChatCard | null> {
  // loadBattleReport 只返回本账号参与的战报（battle_reports 按参与方各存一份）
  const view = await loadBattleReport(q, accountId, reportId);
  if (!view) {
    return null;
  }
  const snapshot = withoutComment(view);
  const detail: Omit<BattleReportView, 'comment'> = {
    ...snapshot,
    attacker: { ...snapshot.attacker, name: filter.mask(snapshot.attacker.name) },
    defender: { ...snapshot.defender, name: filter.mask(snapshot.defender.name) },
  };
  const card: ChatCardView = {
    kind: 'report',
    battleKind: detail.kind,
    role: detail.role,
    won: detail.won,
    attackerName: detail.attacker.name,
    defenderName: detail.defender.name,
    reportedAt: detail.createdAt,
  };
  return { card, reportDetail: detail };
}

function withoutComment(view: BattleReportView): Omit<BattleReportView, 'comment'> {
  const snapshot: Partial<BattleReportView> = { ...view };
  delete snapshot.comment;
  return snapshot as Omit<BattleReportView, 'comment'>;
}
