// 公告（v60，AISLG-162）：正文过滤（纯函数，总是运行）；可见性、语言回落、往期、已读、站点定向与发布校验
// （需要真实 PostgreSQL：设置 TEST_DATABASE_URL 才会跑，用一次性的临时库，别指向开发库）。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { sanitizeAnnouncementBody, normalizeAnnouncementBody, normalizeAnnouncementTitle } from '../common/src/announcement-body';
import { ANNOUNCEMENT_BODY_MAX_CHARS, ANNOUNCEMENT_TITLE_MAX_CHARS, Op, type InitiatorRole } from '../common/src/protocol';
import { publishAnnouncement } from '../common/src/announcement-publish';
import { countUnreadAnnouncements, loadAnnouncementDetail, markAnnouncementRead, listAnnouncements } from '../common/src/announcement-db';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import type { HandlerContext } from '../api/src/handlers';
import { handleAnnouncementOp } from '../api/src/handlers-announcement';

describe('公告正文过滤', () => {
  test('脚本与 HTML 标签被去掉，只留文字', () => {
    const body = sanitizeAnnouncementBody('维护公告<script>alert(1)</script>，请注意<b>时间</b>');
    assert.ok(!body.includes('<'), body);
    assert.ok(!body.includes('script'), body);
    assert.ok(body.includes('维护公告') && body.includes('时间'), body);
  });

  test('图片整体去掉', () => {
    const body = sanitizeAnnouncementBody('看图 ![封面](https://img.example.com/a.png) 结束');
    assert.ok(!body.includes('!['), body);
    assert.ok(!body.includes('a.png'), body);
  });

  test('只保留 http(s) 链接，其余链接只留文字', () => {
    assert.equal(
      sanitizeAnnouncementBody('官网 [这里](https://slg.yuntianyou.cc) 与 [钓鱼](javascript:alert(1))'),
      '官网 [这里](https://slg.yuntianyou.cc) 与 钓鱼',
    );
    assert.equal(sanitizeAnnouncementBody('[旧站](http://example.com/x)'), '[旧站](http://example.com/x)');
  });

  test('段落以空行分隔，段内换行保留，标题符号降为段落', () => {
    assert.equal(sanitizeAnnouncementBody('# 标题\n正文一行\n\n\n第二段  \n  换行'), '标题\n正文一行\n\n第二段\n换行');
  });

  test('过滤后为空的正文不合法', () => {
    assert.equal(normalizeAnnouncementBody('<img src=x onerror=alert(1)>'), null);
    assert.equal(normalizeAnnouncementBody('   \n\n  '), null);
  });

  test('正文上限按过滤后的字数计', () => {
    assert.ok(normalizeAnnouncementBody('字'.repeat(ANNOUNCEMENT_BODY_MAX_CHARS)) !== null);
    assert.equal(normalizeAnnouncementBody('字'.repeat(ANNOUNCEMENT_BODY_MAX_CHARS + 1)), null);
  });

  test('标题去首尾空白，超过上限或为空不合法', () => {
    assert.equal(normalizeAnnouncementTitle('  金秋福利  '), '金秋福利');
    assert.ok(normalizeAnnouncementTitle('字'.repeat(ANNOUNCEMENT_TITLE_MAX_CHARS)) !== null);
    assert.equal(normalizeAnnouncementTitle('字'.repeat(ANNOUNCEMENT_TITLE_MAX_CHARS + 1)), null);
    assert.equal(normalizeAnnouncementTitle('   '), null);
  });
});

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;
const TITLE_PREFIX = '公告测试';
const HOST_A = 'slg-announce-a.test';
const HOST_B = 'slg-announce-b.test';
const DAY = 24 * 60 * 60 * 1000;

describe('公告可见性、已读与发布（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let accountId: string;
  let otherAccountId: string;
  const ids: Record<string, number> = {};

  const sent: Array<{ ok: boolean; data?: Record<string, unknown>; error?: { code: string } }> = [];
  const registry = {
    send: (_conn: ConnInfo, frame: { ok?: boolean; data?: Record<string, unknown>; error?: { code: string } }) => {
      sent.push({ ok: frame.ok ?? true, data: frame.data, error: frame.error });
    },
    broadcast: () => 0,
  } as unknown as ConnectionRegistry;
  const ctx = { pool: undefined as unknown as pg.Pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;

  function connFor(account: string, host: string | null): ConnInfo {
    return { accountId: account, host, role: 'player' as InitiatorRole } as unknown as ConnInfo;
  }

  /** 以某连接调用公告协议，返回最后一帧 */
  async function call(op: number, conn: ConnInfo, data?: Record<string, unknown>) {
    sent.length = 0;
    await handleAnnouncementOp(ctx, conn, op, 1, data);
    return sent[sent.length - 1];
  }

  async function cleanFixtures(): Promise<void> {
    await pool.query(`DELETE FROM announcements WHERE title_zh LIKE $1`, [`${TITLE_PREFIX}%`]);
  }

  /**
   * 直接插入夹具（不走 publishAnnouncement）：LISTEN/NOTIFY 按数据库投递，测试库若与开发 / 测试环境共用，
   * 发布生效公告会把测试数据推给在线玩家。
   */
  async function insertFixture(row: {
    key: string;
    category?: 'system' | 'event';
    titleZh: string;
    bodyZh: string;
    titleEn?: string;
    bodyEn?: string;
    pinned?: boolean;
    host?: string;
    startsAt?: Date;
    endsAt?: Date | null;
    withdrawn?: boolean;
  }): Promise<void> {
    const res = await pool.query(
      `INSERT INTO announcements (category, title_zh, body_zh, title_en, body_en, pinned, host, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        row.category ?? 'system',
        row.titleZh,
        row.bodyZh,
        row.titleEn ?? null,
        row.bodyEn ?? null,
        row.pinned ?? false,
        row.host ?? null,
        row.startsAt ?? new Date(Date.now() - DAY),
        row.endsAt ?? null,
        row.withdrawn ? 'withdrawn' : 'published',
      ],
    );
    ids[row.key] = Number(res.rows[0].id);
  }

  before(async () => {
    tmp = await createTempDatabase(dbUrl as string, 'announcement');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    await cleanFixtures();
    (ctx as { pool: pg.Pool }).pool = pool;
    accountId = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`announce-a-${Date.now()}`])).rows[0].id as string;
    otherAccountId = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`announce-b-${Date.now()}`])).rows[0].id as string;

    const now = Date.now();
    await insertFixture({ key: 'pinnedEn', category: 'event', titleZh: `${TITLE_PREFIX}置顶活动`, bodyZh: '中文正文', titleEn: 'Pinned event', bodyEn: 'English body', pinned: true });
    await insertFixture({ key: 'plain', titleZh: `${TITLE_PREFIX}普通系统`, bodyZh: '普通正文<script>x</script>' });
    await insertFixture({ key: 'future', titleZh: `${TITLE_PREFIX}未生效`, bodyZh: '未来', startsAt: new Date(now + DAY) });
    await insertFixture({ key: 'expired', titleZh: `${TITLE_PREFIX}往期`, bodyZh: '过去', startsAt: new Date(now - 3 * DAY), endsAt: new Date(now - DAY) });
    await insertFixture({ key: 'hostA', titleZh: `${TITLE_PREFIX}站点A`, bodyZh: 'A 站', host: HOST_A });
    await insertFixture({ key: 'withdrawn', titleZh: `${TITLE_PREFIX}将撤回`, bodyZh: '撤回', withdrawn: true });
  });

  after(async () => {
    await cleanFixtures();
    await pool.query(`DELETE FROM accounts WHERE id = ANY($1::uuid[])`, [[accountId, otherAccountId]]);
    await pool.end();
    await tmp?.drop();
  });

  test('列表：生效中、置顶在前、英文回落中文、过滤掉未生效 / 往期 / 撤回 / 他站', async () => {
    const scope = { accountId, host: HOST_B, lang: 'en' as const };
    const list = await listAnnouncements(pool, scope, { history: false, limit: 50 });
    const mine = list.filter((item) => item.title.startsWith(TITLE_PREFIX) || item.title.startsWith('Pinned'));
    assert.deepEqual(mine.map((item) => item.id), [ids.pinnedEn, ids.plain]);
    assert.equal(mine[0].title, 'Pinned event');
    assert.equal(mine[1].title, `${TITLE_PREFIX}普通系统`);
  });

  test('站点定向：只有对应 Host 能看到，全站公告两站都能看到', async () => {
    const onA = await listAnnouncements(pool, { accountId, host: HOST_A, lang: 'zh' }, { history: false, limit: 50 });
    assert.ok(onA.some((item) => item.id === ids.hostA));
    const onB = await listAnnouncements(pool, { accountId, host: HOST_B, lang: 'zh' }, { history: false, limit: 50 });
    assert.ok(!onB.some((item) => item.id === ids.hostA));
    assert.equal(await loadAnnouncementDetail(pool, { accountId, host: HOST_B, lang: 'zh' }, ids.hostA), null);
  });

  test('往期列表：只含已过结束时间的公告', async () => {
    const history = await listAnnouncements(pool, { accountId, host: HOST_B, lang: 'zh' }, { history: true, limit: 50 });
    const mine = history.filter((item) => item.title.startsWith(TITLE_PREFIX));
    assert.deepEqual(mine.map((item) => item.id), [ids.expired]);
    assert.equal(mine[0].expired, true);
  });

  test('未读数与标记已读：幂等，已读后红点减少，未生效与撤回的不能标记', async () => {
    const scope = { accountId, host: HOST_B, lang: 'zh' as const };
    const before = await countUnreadAnnouncements(pool, scope);
    assert.equal(await markAnnouncementRead(pool, scope, ids.pinnedEn), true);
    assert.equal(await markAnnouncementRead(pool, scope, ids.pinnedEn), true);
    assert.equal(await countUnreadAnnouncements(pool, scope), before - 1);
    assert.equal(await markAnnouncementRead(pool, scope, ids.future), false);
    assert.equal(await markAnnouncementRead(pool, scope, ids.withdrawn), false);
    // 另一个账号的已读互不影响
    const other = await countUnreadAnnouncements(pool, { accountId: otherAccountId, host: HOST_B, lang: 'zh' });
    assert.ok(other >= before);
  });

  test('详情：正文按语言取、英文回落、下发时再次过滤；往期可读；撤回与未生效不可见', async () => {
    const en = await loadAnnouncementDetail(pool, { accountId, host: HOST_B, lang: 'en' }, ids.pinnedEn);
    assert.equal(en?.body, 'English body');
    const plain = await loadAnnouncementDetail(pool, { accountId, host: HOST_B, lang: 'en' }, ids.plain);
    assert.equal(plain?.body, '普通正文x');
    assert.ok(plain && !plain.body.includes('<'));
    const expired = await loadAnnouncementDetail(pool, { accountId, host: HOST_B, lang: 'zh' }, ids.expired);
    assert.equal(expired?.expired, true);
    assert.equal(await loadAnnouncementDetail(pool, { accountId, host: HOST_B, lang: 'zh' }, ids.withdrawn), null);
    assert.equal(await loadAnnouncementDetail(pool, { accountId, host: HOST_B, lang: 'zh' }, ids.future), null);
  });

  test('协议层：列表 / 详情 / 已读的响应与错误码', async () => {
    const conn = connFor(accountId, HOST_B);
    const list = await call(Op.GET_ANNOUNCEMENTS, conn, { lang: 'en' });
    assert.equal(list.ok, true);
    assert.ok(typeof list.data?.unreadCount === 'number');
    const detail = await call(Op.GET_ANNOUNCEMENT, conn, { id: ids.withdrawn });
    assert.equal(detail.ok, false);
    assert.equal(detail.error?.code, 'ANNOUNCEMENT_NOT_FOUND');
    const bad = await call(Op.GET_ANNOUNCEMENT, conn, { id: 'x' });
    assert.equal(bad.error?.code, 'INVALID_PARAMS');
    const read = await call(Op.READ_ANNOUNCEMENT, conn, { id: ids.plain });
    assert.equal(read.ok, true);
    assert.equal(read.data?.id, ids.plain);
  });

  test('发布校验：站点定向不能全服播报；定时生效不能即时播报（事务回滚，不留下公告，也不推送）', async () => {
    const base = { category: 'system', titleZh: `${TITLE_PREFIX}校验`, bodyZh: '正文', titleEn: null, bodyEn: null, pinned: false, strongRemind: false, endsAt: null } as const;
    await assert.rejects(
      publishAnnouncement(pool, { ...base, host: HOST_A, startsAt: new Date(), chat: true }),
      /站点定向/,
    );
    await assert.rejects(
      publishAnnouncement(pool, { ...base, host: null, startsAt: new Date(Date.now() + DAY), chat: true }),
      /定时生效/,
    );
    const left = await pool.query(`SELECT count(*)::int AS n FROM announcements WHERE title_zh = $1`, [`${TITLE_PREFIX}校验`]);
    assert.equal((left.rows[0] as { n: number }).n, 0);
  });

  test('发布：已过结束时间的公告不推送（live 为 false、ended 为 true）；带 chat 时拒绝播报', async () => {
    const base = { category: 'system', titleZh: `${TITLE_PREFIX}已结束`, bodyZh: '正文', titleEn: null, bodyEn: null, pinned: false, strongRemind: false, host: null, chat: false } as const;
    const window = { startsAt: new Date(Date.now() - 2 * 3600_000), endsAt: new Date(Date.now() - 3600_000) };
    const res = await publishAnnouncement(pool, { ...base, ...window });
    assert.equal(res.live, false);
    assert.equal(res.ended, true);
    assert.equal(res.broadcast, null);
    await assert.rejects(publishAnnouncement(pool, { ...base, ...window, chat: true }), /已过结束时间/);
    await pool.query(`DELETE FROM announcements WHERE id = $1`, [res.id]);
  });
});
