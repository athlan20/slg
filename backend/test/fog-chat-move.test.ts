// 战争迷雾的聊天坐标卡片与高级迁城令（AISLG-224 第四步）：未探索坐标的卡片返回 unexplored（发送时
// CHAT_COORD_UNEXPLORED）；已探索坐标的卡片只含发送者看到的快照；指定坐标迁城未探索返回 MOVE_CITY_TILE_UNEXPLORED。
// 需要 TEST_DATABASE_URL（一次性临时库，别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { setFogEnabledCache } from '../common/src/fog-config';
import { buildChatCard, CHAT_CARD_UNEXPLORED } from '../api/src/chat-cards';
import { buildBannedWordFilter } from '../api/src/chat-words';
import { moveCityTx } from '../api/src/handlers-move-city-tx';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('战争迷雾：坐标卡片与高级迁城令（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let A: string;
  let cityA: string;
  let B: string;
  const tag = `fogc-${Date.now()}`;
  const filter = buildBannedWordFilter([]);

  async function tile(x: number, y: number, fields: { kind: string; terrain?: string; level?: number; owner?: string | null }): Promise<void> {
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, $3, $4, $5, $6, NULL)
       ON CONFLICT (x, y) DO UPDATE SET terrain = EXCLUDED.terrain, kind = EXCLUDED.kind, level = EXCLUDED.level,
         owner_city_id = EXCLUDED.owner_city_id, npc = NULL`,
      [x, y, fields.terrain ?? 'plain', fields.kind, fields.level ?? 3, fields.owner ?? null],
    );
  }

  /** 在事务内取卡片（与 handlers-chat-send 同口径） */
  async function card(x: number, y: number) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await buildChatCard(client, A, { kind: 'coord', x, y } as never, filter);
      await client.query('COMMIT');
      return out;
    } finally {
      client.release();
    }
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'fog_chat_move');
    pool = new pg.Pool({ connectionString: tmp.url, max: 6 });
    await ensureSchema(pool);
    A = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${tag}-a`])).rows[0].id as string;
    B = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${tag}-b`])).rows[0].id as string;
    cityA = (await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, 'A主城', 0, 0, 0, 700, 700) RETURNING id`, [A])).rows[0].id as string;
    await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, 'B城', 0, 0, 0, 900, 900)`, [B]);
    await tile(700, 700, { kind: 'city', owner: cityA, level: 0 });
    await tile(900, 900, { kind: 'city', owner: null, level: 0 });
    await tile(735, 700, { kind: 'npc_city', level: 4 });
    await tile(905, 905, { kind: 'wilderness', level: 6, terrain: 'gold_mine' });
    await pool.query(`INSERT INTO user_items (account_id, item_id, count) VALUES ($1, 'city_order_adv', 2) ON CONFLICT DO NOTHING`, [A]);
  });

  after(async () => {
    setFogEnabledCache(null);
    await pool?.end();
    await tmp?.drop();
  });

  test('开关关闭：坐标卡片照常返回地块内容', async () => {
    setFogEnabledCache(false);
    const out = await card(900, 900);
    assert.ok(typeof out === 'object' && out !== null);
    if (typeof out === 'object' && out !== null) {
      assert.equal(out.card.kind, 'coord');
    }
  });

  test('开关开启：未探索的坐标返回 unexplored（不含任何地块信息）', async () => {
    setFogEnabledCache(true);
    assert.equal(await card(905, 905), CHAT_CARD_UNEXPLORED);
  });

  test('开关开启：已探索的 NPC 城坐标卡片内容只含快照（等级与种类）', async () => {
    setFogEnabledCache(true);
    const out = await card(735, 700);
    assert.ok(typeof out === 'object' && out !== null);
    if (typeof out === 'object' && out !== null) {
      assert.equal(out.card.kind, 'coord');
      assert.equal(out.card.tileKind, 'npc_city');
      assert.equal(out.card.level, 4);
    }
  });

  test('高级迁城令指定未探索坐标：MOVE_CITY_TILE_UNEXPLORED（先于地块内容判定）', async () => {
    setFogEnabledCache(true);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await moveCityTx(client, { accountId: A, cityId: cityA, mode: 'pointing', target: { x: 950, y: 950 }, preview: true });
      await client.query('ROLLBACK');
      assert.equal(out.ok, false);
      if (!out.ok) {
        assert.equal(out.code, 'MOVE_CITY_TILE_UNEXPLORED');
      }
    } finally {
      client.release();
    }
  });
});
