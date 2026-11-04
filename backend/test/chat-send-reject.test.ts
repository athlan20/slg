// CHAT_SEND 的拒绝路径（AISLG-224 测试发现）：拒绝时要等 ROLLBACK 完成再归还连接。线上连接池（createPool）的
// release 钩子会结束还有未完成查询的连接，ROLLBACK 随之失败，玩家收到 INTERNAL。普通 pg.Pool 没有这个钩子，
// 所以本文件必须用 createPool。需要 TEST_DATABASE_URL（一次性临时库，别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type pg from 'pg';
import { createPool, ensureSchema } from '../common/src/db';
import { Op, type InitiatorRole } from '../common/src/protocol';
import { setFogEnabledCache } from '../common/src/fog-config';
import { setTimeScaleCache } from '../common/src/time-scale';
import { initBannedWordFilter } from '../api/src/chat-words';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import type { ConnInfo, ConnectionRegistry } from '../api/src/connections';
import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('CHAT_SEND 拒绝路径（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  const savedUrl = process.env.DATABASE_URL;
  let wordsDir: string;
  const tag = `chatrej-${Date.now()}`;

  async function makeAccount(name: string, government: number): Promise<string> {
    const id = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${tag}-${name}`])).rows[0].id as string;
    const city = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, '主城', 0, 0, 0, 100, 100) RETURNING id`,
      [id],
    )).rows[0].id as string;
    await pool.query(
      `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', $2)
       ON CONFLICT (city_id, kind) DO UPDATE SET level = EXCLUDED.level`,
      [city, government],
    );
    return id;
  }

  async function send(accountId: string, data: Record<string, unknown>) {
    const frames: Array<{ ok?: boolean; error?: { code: string } }> = [];
    const registry = {
      send: (_conn: ConnInfo, frame: { ok?: boolean; error?: { code: string } }) => {
        frames.push(frame);
      },
    } as unknown as ConnectionRegistry;
    const ctx = { pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;
    const conn = { accountId, role: 'player' as InitiatorRole } as unknown as ConnInfo;
    await handleMessage(ctx, conn, JSON.stringify({ op: Op.CHAT_SEND, seq: 1, data }));
    return frames[frames.length - 1];
  }

  before(async () => {
    setTimeScaleCache(1);
    wordsDir = mkdtempSync(join(tmpdir(), 'chat-reject-'));
    writeFileSync(join(wordsDir, 'words.txt'), '敏感词\n');
    initBannedWordFilter({ CHAT_BANNED_WORDS_FILE: join(wordsDir, 'words.txt') });
    tmp = await createTempDatabase(dbUrl as string, 'chat_reject');
    process.env.DATABASE_URL = tmp.url;
    const maintenance = createPool('chat-reject-schema', 2, { maintenance: true });
    await ensureSchema(maintenance);
    await maintenance.end();
    pool = createPool('chat-reject-test', 4);
  });

  after(async () => {
    setFogEnabledCache(null);
    await pool?.end();
    await tmp?.drop();
    rmSync(wordsDir, { recursive: true, force: true });
    if (savedUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = savedUrl;
    }
  });

  test('官府等级不足返回 CHAT_GOVERNMENT_TOO_LOW', async () => {
    const low = await makeAccount('low', 1);
    const res = await send(low, { channel: 'world', text: '你好' });
    assert.equal(res.error?.code, 'CHAT_GOVERNMENT_TOO_LOW');
  });

  test('同频道限频返回 CHAT_RATE_LIMITED', async () => {
    const talker = await makeAccount('talker', 3);
    const first = await send(talker, { channel: 'world', text: '第一条' });
    assert.equal(first.ok, true, JSON.stringify(first.error));
    const second = await send(talker, { channel: 'world', text: '第二条' });
    assert.equal(second.error?.code, 'CHAT_RATE_LIMITED');
  });

  test('迷雾开启时，未探索坐标的卡片返回 CHAT_COORD_UNEXPLORED', async () => {
    setFogEnabledCache(true);
    const scout = await makeAccount('scout', 3);
    await pool.query(`INSERT INTO world_tiles (x, y, terrain, kind, level) VALUES (900, 900, 'plain', 'wilderness', 3) ON CONFLICT DO NOTHING`);
    const res = await send(scout, { channel: 'world', card: { kind: 'coord', x: 900, y: 900 } });
    assert.equal(res.error?.code, 'CHAT_COORD_UNEXPLORED');
  });

  test('连续拒绝后连接池仍可用', async () => {
    const low = await makeAccount('low2', 1);
    for (let index = 0; index < 8; index += 1) {
      const res = await send(low, { channel: 'world', text: `第 ${index} 条` });
      assert.equal(res.error?.code, 'CHAT_GOVERNMENT_TOO_LOW');
    }
    assert.equal((await pool.query(`SELECT 1 AS ok`)).rows[0].ok, 1);
  });
});
