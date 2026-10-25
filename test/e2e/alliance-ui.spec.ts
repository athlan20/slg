// 联盟界面（AISLG-186 F2）：聊天「联盟」页签（历史 / 发送 / 推送 / 系统消息 / 无盟引导）、地图盟友着色与攻击禁用、
// 地图标记（打 / 推送 / 盟友不可删 / 满 20 个提示 / 标记页签分页与删除、定位）、联盟榜与名人堂页签，
// 再在四套皮肤 × 三种窗口宽度下对这些界面跑 scanLayout：页面不竖向滚动、没有元素出现竖向滚动条、没有内容被裁在区块底边外。
// 前置条件与 alliance-layout.spec.ts（F1）一致：依赖隔离联调栈（前端 28424、API 18080、临时库 slg_ui），只在 E2E_ALLIANCE=1 时运行。
// 运行：E2E_ALLIANCE=1 npx playwright test -c playwright.ally.config.ts

import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { databaseUrl, seedAccount } from '../account-seed';
import { E2E_PASSWORD, loginViaForm, uniqueUsername } from './helpers';

const requireFromBackend = createRequire(path.join(__dirname, '../../backend/package.json'));
const pg = requireFromBackend('pg') as typeof import('pg');

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:28424';
const SHOT_DIR = '/private/tmp/claude-501/-Users-mac-work-slg/dad2f398-e3ae-4a13-83c5-5a4a912fb603/scratchpad/ally-shots';

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1100, height: 800 },
  { width: 390, height: 844 },
];
const SKINS = ['night', 'crimson', 'gilded', 'paper'] as const;
/** 标记上限（与 protocol-alliance 的 ALLIANCE_MARK_MAX 一致） */
const MARK_MAX = 20;

interface Violation {
  kind: string;
  role: string;
  detail: string;
}

/** 与 alliance-layout.spec.ts / layout-fit.spec.ts 的 scanLayout 同口径（复制一份，避免 spec 之间互相引用） */
async function scanLayout(page: Page): Promise<Violation[]> {
  return page.evaluate(() => {
    const out: Array<{ kind: string; role: string; detail: string }> = [];
    const roleOf = (el: Element): string => {
      let cur: Element | null = el;
      while (cur) {
        const role = cur.getAttribute('role');
        if (role) {
          return role;
        }
        cur = cur.parentElement;
      }
      return el.tagName.toLowerCase();
    };
    const doc = document.documentElement;
    if (doc.scrollHeight > window.innerHeight + 1) {
      out.push({ kind: '页面竖向滚动', role: 'html', detail: `scrollHeight ${doc.scrollHeight} > innerHeight ${window.innerHeight}` });
    }
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        continue;
      }
      const overflows = el.scrollHeight > el.clientHeight + 1;
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && overflows) {
        out.push({ kind: '出现竖向滚动条', role: roleOf(el), detail: `scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}` });
        continue;
      }
      const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip';
      const lineClamp = (style as CSSStyleDeclaration & { webkitLineClamp?: string }).webkitLineClamp;
      const clamped = lineClamp !== undefined && lineClamp !== 'none' && lineClamp !== '';
      if (clipsY && overflows && !clamped && el.clientHeight > 0) {
        out.push({ kind: '内容被裁在区块底边外', role: roleOf(el), detail: `scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}` });
      }
    }
    return out;
  });
}

async function expectFit(page: Page, label: string): Promise<void> {
  // 分页列表测高后会收敛一两帧：等布局稳定再扫
  await page.waitForTimeout(500);
  const violations = await scanLayout(page);
  expect(violations, `${label}\n${JSON.stringify(violations, null, 1)}`).toEqual([]);
}

// ---- 数据库（直连，与后端同库） ----

async function sql(text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const pool = new pg.Pool({ connectionString: databaseUrl() });
  try {
    const res = await pool.query(text, params);
    return res.rows as Record<string, unknown>[];
  } finally {
    await pool.end();
  }
}

/** 建盟门槛：主城官府 5 级、金币 50 万（创建联盟扣 10 万） */
async function presetMainCity(username: string): Promise<void> {
  await sql(`UPDATE cities SET gold = 500000 WHERE account_id = (SELECT id FROM accounts WHERE username = $1)`, [username]);
  await sql(
    `INSERT INTO city_buildings (city_id, kind, level) SELECT id, 'government', 5 FROM cities WHERE account_id = (SELECT id FROM accounts WHERE username = $1) ON CONFLICT (city_id, kind) DO UPDATE SET level = 5`,
    [username],
  );
}

/** 往联盟里灌普通成员（账号先预建），用来凑够榜单的 5 人门槛、或撑出分页 */
async function padMembers(allianceId: string, prefix: string, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const name = `${prefix}${i}`;
    await seedAccount(name, E2E_PASSWORD);
    await sql(
      `INSERT INTO alliance_members (account_id, alliance_id, role) SELECT id, $2::uuid, 'member' FROM accounts WHERE username = $1 ON CONFLICT DO NOTHING`,
      [name, allianceId],
    );
  }
}

/** 某账号主城所在的地块坐标（world_tiles 的城池格） */
async function mainCityTile(username: string): Promise<{ x: number; y: number }> {
  const rows = await sql(
    `SELECT wt.x, wt.y FROM world_tiles wt JOIN cities c ON c.id = wt.owner_city_id JOIN accounts a ON a.id = c.account_id
     WHERE a.username = $1 AND wt.kind = 'city' ORDER BY c.created_at LIMIT 1`,
    [username],
  );
  if (rows.length === 0) {
    throw new Error(`找不到 ${username} 的主城地块`);
  }
  return { x: Number(rows[0].x), y: Number(rows[0].y) };
}

// ---- 页面步骤 ----

/** 只点可见的那一个（同一 role 在窄屏上可能同时存在隐藏的副本） */
function visibleRole(page: Page, role: string) {
  return page.locator(`[role="${role}"]:visible`);
}

/** 打开排行榜：宽屏走顶栏按钮；窄屏顶栏没有该按钮，走侧栏账号菜单里的「排行榜」 */
async function openLeaderboard(page: Page): Promise<void> {
  const top = page.locator('[role="顶栏-排行榜按钮"]:visible');
  if (await top.count()) {
    await top.click();
    return;
  }
  await page.locator('[role="侧栏-账号按钮"]:visible').click();
  await page.locator('[role="账号菜单-排行榜"]:visible').click();
}

async function openAlliance(page: Page): Promise<void> {
  await visibleRole(page, '导航-联盟').click();
  await expect(page.locator('[role="联盟弹窗"]')).toBeVisible();
}

async function closeAlliance(page: Page): Promise<void> {
  await page.locator('[role="联盟弹窗-关闭按钮"]').click();
  await expect(page.locator('[role="联盟弹窗"]')).toBeHidden();
}

/** 列表里找到某个联盟并点进去（F1 同款，翻客户端分页，不够再向服务端要更多） */
async function openDetailByName(page: Page, name: string): Promise<void> {
  const row = page.locator(`[role="联盟弹窗-列表条目"][title^="${name} ·"]`);
  for (let i = 0; i < 40; i += 1) {
    await row.first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined);
    if ((await row.count()) > 0) {
      await row.first().click();
      await expect(page.locator('[role="联盟弹窗-详情-名称"]')).toHaveText(name);
      return;
    }
    const next = page.locator('[role="联盟弹窗-联盟列表-下一页"]');
    if ((await next.count()) > 0 && (await next.isEnabled())) {
      await next.click();
      continue;
    }
    const more = page.locator('[role="联盟弹窗-联盟列表-更早"]');
    if ((await more.count()) === 0) {
      break;
    }
    await more.click();
    await page.waitForTimeout(400);
  }
  throw new Error(`列表里找不到联盟 ${name}`);
}

async function openChat(page: Page): Promise<void> {
  if ((await page.locator('[role="聊天浮窗"]').count()) === 0) {
    // 桌面端是底栏的收起条，窄屏是底部图标栏的「聊天」
    const chip = page.locator('[role="聊天-收起条"]:visible');
    if ((await chip.count()) > 0) {
      await chip.first().click();
    } else {
      await visibleRole(page, '导航-聊天').click();
    }
  }
  await expect(page.locator('[role="聊天浮窗"]')).toBeVisible();
}

async function closeChat(page: Page): Promise<void> {
  await page.locator('[role="聊天浮窗-收起按钮"]').click();
  await expect(page.locator('[role="聊天浮窗"]')).toBeHidden();
}

async function chatAllianceTab(page: Page): Promise<void> {
  await page.locator('[role="聊天浮窗-页签-联盟"]').click();
}

async function sendChat(page: Page, text: string): Promise<void> {
  await page.locator('[role="聊天-输入区-文字"]').fill(text);
  await page.locator('[role="聊天-输入区-发送按钮"]').click();
  await expect(page.locator('[role="聊天浮窗-联盟消息"]')).toContainText(text);
}

/** 地图页：坐标跳转到 (x, y)，点中该格（选中详情出现） */
async function gotoTile(page: Page, x: number, y: number): Promise<void> {
  await visibleRole(page, '导航-地图').click();
  // 窄屏下选中格子后页面强制显示详情页签、地图卡隐藏：先收起选中，地图的坐标框才可见
  const jumpX = page.locator('[role="世界地图视图-坐标输入-x"]');
  if (!(await jumpX.isVisible())) {
    await page.locator('[role="选中详情-关闭按钮"]').click();
  }
  await jumpX.fill(String(x));
  await page.locator('[role="世界地图视图-坐标输入-y"]').fill(String(y));
  await page.locator('[role="世界地图视图-跳转按钮"]').click();
  const tile = page.locator(`[role="世界地图视野-地块"][data-x="${x}"][data-y="${y}"]`);
  // 窄屏下目标格已是选中态时，跳转后页面立刻切到详情页签、地图卡隐藏：格子不可见但详情已就位，不必再点
  if (!(await tile.isVisible()) && (await page.locator('[role="选中详情-头部"]').isVisible())) {
    return;
  }
  await expect(tile).toBeVisible();
  await tile.click();
  await expect(page.locator('[role="选中详情-头部"]')).toBeVisible();
}

function tileAt(page: Page, x: number, y: number) {
  return page.locator(`[role="世界地图视野-地块"][data-x="${x}"][data-y="${y}"]`);
}

async function setSkin(pages: Page[], skin: string): Promise<void> {
  for (const page of pages) {
    // 皮肤只写 <html data-theme>（与 applyTheme 同口径）
    await page.evaluate((id) => document.documentElement.setAttribute('data-theme', id), skin);
  }
}

// ---- 测试 ----

test.describe('联盟界面 F2：聊天 / 地图 / 标记 / 排行（E2E_ALLIANCE=1）', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(process.env.E2E_ALLIANCE !== '1', '需要隔离联调栈：设置 E2E_ALLIANCE=1 后运行');

  const suffix = String(Date.now()).slice(-5);
  const allianceName = `F${suffix}`;
  const names = {
    leader: uniqueUsername('ally_f2_lead'),
    vice: uniqueUsername('ally_f2_a'),
    member: uniqueUsername('ally_f2_b'),
    free: uniqueUsername('ally_f2_free'),
  };
  const padPrefix = uniqueUsername('ally_f2_pad');
  let contexts: BrowserContext[] = [];
  let pages: Record<keyof typeof names, Page>;
  let cityX = 0;
  let cityY = 0;
  let allianceId = '';

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    if (process.env.E2E_ALLIANCE !== '1') {
      return;
    }
    mkdirSync(SHOT_DIR, { recursive: true });
    // 主城门槛要在登录前写库（登录后的城池数据是那时拉的）
    await seedAccount(names.leader, E2E_PASSWORD);
    await presetMainCity(names.leader);
    const created: Partial<Record<keyof typeof names, Page>> = {};
    contexts = [];
    for (const key of Object.keys(names) as Array<keyof typeof names>) {
      const ctx = await browser.newContext({ baseURL: BASE_URL, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
      contexts.push(ctx);
      const page = await ctx.newPage();
      await loginViaForm(page, names[key]);
      created[key] = page;
    }
    pages = created as Record<keyof typeof names, Page>;
  });

  test.afterAll(async () => {
    for (const ctx of contexts) {
      await ctx.close();
    }
  });

  test('前置：盟主建盟，A 受邀入盟，B 申请入盟（系统消息的来源）', async () => {
    test.setTimeout(300_000);
    const { leader, vice, member, free } = pages;

    await expect(leader.locator('[role="顶栏-资源"]')).toBeVisible();
    await openAlliance(leader);
    await leader.locator('[role="联盟弹窗-页签-创建"]').click();
    await leader.locator('[role="联盟弹窗-创建-名称"]').fill(allianceName);
    await leader.locator('[role="联盟弹窗-创建-提交"]').click();
    await expect(leader.locator('[role="联盟弹窗-名称"]')).toHaveText(allianceName);
    await closeAlliance(leader);
    allianceId = String((await sql(`SELECT id FROM alliances WHERE name = $1`, [allianceName]))[0].id);

    // A：盟主邀请，A 接受
    await openAlliance(leader);
    await leader.locator('[role="联盟弹窗-页签-招募"]').click();
    await leader.locator('[role="联盟弹窗-邀请-昵称"]').fill(names.vice);
    await leader.locator('[role="联盟弹窗-邀请-提交"]').click();
    await expect(leader.locator('[role="联盟弹窗-已发邀请条目"]', { hasText: names.vice })).toHaveCount(1);
    await closeAlliance(leader);
    await openAlliance(vice);
    await vice.locator('[role="联盟弹窗-邀请-接受"]').first().click();
    await expect(vice.locator('[role="联盟弹窗-名称"]')).toHaveText(allianceName);
    await closeAlliance(vice);

    // B：自己申请，盟主同意（产生「加入了联盟」的系统消息）
    await expect(member.locator('[role="顶栏-资源"]')).toBeVisible();
    await openAlliance(member);
    await openDetailByName(member, allianceName);
    await member.locator('[role="联盟弹窗-申请加入"]').click();
    await expect(member.locator('[role="联盟弹窗-撤回申请"]').first()).toBeVisible();
    await closeAlliance(member);
    await openAlliance(leader);
    await leader.locator('[role="联盟弹窗-页签-招募"]').click();
    const request = leader.locator('[role="联盟弹窗-申请条目"]', { hasText: names.member });
    await expect(request).toHaveCount(1);
    await request.locator('[role="联盟弹窗-申请-同意"]').click();
    await expect(request).toHaveCount(0);
    await closeAlliance(leader);

    // free 始终不入盟；先记下盟主主城的坐标，之后的地图用例都用它
    await expect(free.locator('[role="顶栏-资源"]')).toBeVisible();
    ({ x: cityX, y: cityY } = await mainCityTile(names.leader));
  });

  test('聊天联盟页签：历史、发送、推送、系统消息、无盟引导', async () => {
    test.setTimeout(300_000);
    const { leader, vice, member, free } = pages;

    // 盟主：系统消息（B 入盟）出现在联盟频道
    await openChat(leader);
    await chatAllianceTab(leader);
    await expect(leader.locator('[role="聊天-系统消息"]', { hasText: names.member })).toHaveCount(1);
    await expect(leader.locator('[role="聊天-系统消息"]', { hasText: '加入了联盟' }).first()).toBeVisible();
    // 系统消息没有发送人：不挂玩家菜单
    await expect(leader.locator('[role="聊天-系统消息"] [role="聊天-消息-发送人"]')).toHaveCount(0);
    await sendChat(leader, 'E2E 联盟频道 盟主甲');

    // A：历史里能看到盟主的消息；A 发一条，盟主实时收到（推送）
    await openChat(vice);
    await chatAllianceTab(vice);
    await expect(vice.locator('[role="聊天浮窗-联盟消息"]')).toContainText('E2E 联盟频道 盟主甲');
    await sendChat(vice, 'E2E 联盟频道 A乙');
    await expect(leader.locator('[role="聊天浮窗-联盟消息"]')).toContainText('E2E 联盟频道 A乙', { timeout: 15_000 });

    // free：没有联盟，页签给引导，按钮进入联盟面板
    await openChat(free);
    await chatAllianceTab(free);
    await expect(free.locator('[role="聊天浮窗-联盟-未加入"]')).toBeVisible();
    await free.locator('[role="聊天浮窗-联盟-去联盟面板"]').click();
    await expect(free.locator('[role="联盟弹窗"]')).toBeVisible();
    await closeAlliance(free);
    await closeChat(free);
    await closeChat(vice);
    await closeChat(leader);
  });

  test('地图：盟友地块着色、攻击按钮禁用并说明原因', async () => {
    test.setTimeout(300_000);
    const { vice, free } = pages;

    // A（盟友）看盟主的主城：有盟友色描边、盟友标签，攻击类操作禁用
    await gotoTile(vice, cityX, cityY);
    await expect(tileAt(vice, cityX, cityY)).toHaveClass(/ring-st-online/);
    await expect(vice.locator('[role="选中详情-盟友"]')).toBeVisible();
    await expect(vice.locator('[role="选中详情-操作-掠夺"]')).toBeDisabled();
    await expect(vice.locator('[role="选中详情-盟友提示"]')).toBeVisible();

    // free（非盟友）看同一座城：没有盟友标记，掠夺可点
    await gotoTile(free, cityX, cityY);
    await expect(free.locator('[role="选中详情-盟友"]')).toHaveCount(0);
    await expect(free.locator('[role="选中详情-操作-掠夺"]')).toBeEnabled();
  });

  test('地图标记：打标记、实时推送、盟友不可删、满 20 个提示', async () => {
    test.setTimeout(600_000);
    const { leader, vice, member } = pages;

    // 盟主在主城格上打一个「集结」标记
    await gotoTile(leader, cityX, cityY);
    await leader.locator('[role="选中详情-操作-打标记"]').click();
    await leader.locator('[role="选中详情-标记-类型-rally"]').click();
    await leader.locator('[role="选中详情-标记-附言"]').fill('集合点');
    await leader.locator('[role="选中详情-标记-提交"]').click();
    await expect(leader.locator('[role="选中详情-标记-完成"]')).toBeVisible();
    await expect(tileAt(leader, cityX, cityY).locator('[role="世界地图视野-联盟标记"]')).toHaveCount(1);

    // A 打开联盟面板的标记页签，停在这里；盟主再打一个「危险」标记，A 的列表应自己刷出来（推送）
    await gotoTile(vice, cityX, cityY);
    await openAlliance(vice);
    await vice.locator('[role="联盟弹窗-页签-标记"]').click();
    await expect(vice.locator('[role="联盟弹窗-标记条目"]')).toHaveCount(1);
    await gotoTile(leader, cityX + 1, cityY);
    await leader.locator('[role="选中详情-操作-打标记"]').click();
    await leader.locator('[role="选中详情-标记-类型-danger"]').click();
    await leader.locator('[role="选中详情-标记-附言"]').fill('危险区');
    await leader.locator('[role="选中详情-标记-提交"]').click();
    await expect(leader.locator('[role="选中详情-标记-完成"]')).toBeVisible();
    await expect(vice.locator('[role="联盟弹窗-标记条目"]')).toHaveCount(2, { timeout: 15_000 });
    await closeAlliance(vice);

    // A 看盟主的标记：有标记、不能删（不是自己打的，也不是盟主 / 副盟主）
    await gotoTile(vice, cityX, cityY);
    await expect(vice.locator('[role="选中详情-标记-有"]')).toContainText('集合点');
    await expect(vice.locator('[role="选中详情-标记-删除"]')).toHaveCount(0);

    // 压力：再灌 18 个（创建人为 B），本盟凑满 20 个；盟主再打第 21 个应被拒绝并提示
    const cells = Array.from({ length: 18 }, (_, i) => ({ x: cityX + 10 + i, y: cityY + 10 }));
    const bId = (await sql(`SELECT id FROM accounts WHERE username = $1`, [names.member]))[0].id;
    for (const cell of cells) {
      await sql(
        `INSERT INTO alliance_marks (alliance_id, x, y, kind, text, creator_id, expires_at)
         VALUES ($1, $2, $3, 'resource', 'E2E 压力', $4, now() + interval '1 day')`,
        [allianceId, cell.x, cell.y, bId],
      );
    }
    await gotoTile(leader, cityX - 2, cityY - 2);
    await leader.locator('[role="选中详情-操作-打标记"]').click();
    await leader.locator('[role="选中详情-标记-附言"]').fill('第二十一个');
    await leader.locator('[role="选中详情-标记-提交"]').click();
    await expect(leader.locator('[role="选中详情-标记-错误"]')).toContainText('已满');

    // member 版面：B 不是盟主，同一格不能删别人的（这里只验证 B 的列表里，盟主的标记没有删除按钮）
    await gotoTile(member, cityX, cityY);
    await expect(member.locator('[role="选中详情-标记-删除"]')).toHaveCount(0);
  });

  test('标记页签：分页、删除、定位', async () => {
    test.setTimeout(300_000);
    const { leader } = pages;

    await openAlliance(leader);
    await leader.locator('[role="联盟弹窗-页签-标记"]').click();
    await expect(leader.locator('[role="联盟弹窗-标记列表-分页器"]')).toContainText('/');
    await expect(leader.getByText(`${MARK_MAX} / ${MARK_MAX}`, { exact: true })).toBeVisible();
    await leader.locator('[role="联盟弹窗-标记列表-下一页"]').click();
    await expect(leader.locator('[role="联盟弹窗-标记条目"]').first()).toBeVisible();

    // 删除一个（盟主可删任何人的）：二次确认后总数减一
    await leader.locator('[role^="联盟弹窗-标记-删除-"]').first().click();
    await leader.locator('[role^="联盟弹窗-标记-删除-"][role$="-确认"]').first().click();
    await expect(leader.getByText(`${MARK_MAX - 1} / ${MARK_MAX}`, { exact: true })).toBeVisible();

    // 定位：收起联盟弹窗，地图跳到该格并选中
    await leader.locator('[role="联盟弹窗-标记-定位"]').first().click();
    await expect(leader.locator('[role="联盟弹窗"]')).toBeHidden();
    await expect(leader.locator('[role="选中详情-头部"]')).toBeVisible();
  });

  test('联盟榜与名人堂：联盟榜页签、我的联盟、点开公开信息，名人堂联盟页签', async () => {
    test.setTimeout(300_000);
    const { leader, free } = pages;

    // 凑够 5 人以上上榜；快照与名人堂存档直接写库（Worker 每 10 分钟才算一次，联调不等）
    await padMembers(allianceId, padPrefix, 3);
    const [{ n }] = (await sql(`SELECT count(*)::int AS n FROM alliance_members WHERE alliance_id = $1`, [allianceId])) as Array<{ n: number }>;
    expect(n).toBeGreaterThanOrEqual(5);
    const [{ id: leaderId }] = (await sql(`SELECT id FROM accounts WHERE username = $1`, [names.leader])) as Array<{ id: string }>;
    await sql(`DELETE FROM alliance_leaderboard_snapshots`);
    // computed_at 与 Worker 一样取毫秒精度：服务端按 max(computed_at) 的精确值回查整榜，微秒会对不上
    await sql(
      `INSERT INTO alliance_leaderboard_snapshots (rank, alliance_id, name, leader_id, leader_name, member_count, value, computed_at)
       VALUES (1, $1, $2, $3, $4, $5, 1234, date_trunc('milliseconds', now()))`,
      [allianceId, allianceName, leaderId, names.leader, n],
    );
    const [{ id: seasonId }] = (await sql(
      `INSERT INTO seasons (name, status, start_at, end_at, seed, time_scale, ended_at)
       VALUES ('E2E 历史赛季 ${suffix}', 'ended', now() - interval '30 days', now() - interval '1 day', 1, 1, now() - interval '1 day') RETURNING id`,
    )) as Array<{ id: number }>;
    await sql(
      `INSERT INTO season_archives (season_id, kind, rank, account_id, username, city_name, value, agent_model, alliance_id, alliance_name, member_count)
       VALUES ($1, 'alliance', 1, $2, $3, NULL, 1234, NULL, $4, $5, $6)`,
      [seasonId, leaderId, names.leader, allianceId, allianceName, n],
    );

    // free（无盟）：联盟榜列出该联盟，「我的联盟」提示没有联盟；点开看公告与成员，可申请
    await openLeaderboard(free);
    await expect(free.locator('[role="排行榜弹窗"]')).toBeVisible();
    await free.locator('[role="排行榜弹窗-切换-联盟榜"]').click();
    await expect(free.locator('[role="排行榜弹窗-我的联盟"]')).toContainText('你还没有加入联盟');
    const entry = free.locator('[role="排行榜弹窗-联盟条目"]', { hasText: allianceName });
    await expect(entry).toHaveCount(1);
    await entry.click();
    await expect(free.locator('[role="联盟弹窗-详情-名称"]')).toHaveText(allianceName);
    await expect(free.locator('[role="联盟弹窗-详情-成员"]')).toBeVisible();
    await expect(free.locator('[role="联盟弹窗-申请加入"]')).toBeVisible();
    await free.locator('[role="联盟弹窗-返回列表"]').click();
    await expect(free.locator('[role="排行榜弹窗-联盟列表"]')).toBeVisible();
    await free.locator('[role="排行榜弹窗-关闭按钮"]').click();

    // 盟主（已有联盟）：我的联盟置顶显示联盟名；点开别的联盟时不出申请按钮（这里点自己的联盟即可）
    await visibleRole(leader, '顶栏-排行榜按钮').click();
    await leader.locator('[role="排行榜弹窗-切换-联盟榜"]').click();
    await expect(leader.locator('[role="排行榜弹窗-我的联盟"]')).toContainText(allianceName);
    await leader.locator('[role="排行榜弹窗-联盟条目"]', { hasText: allianceName }).click();
    await expect(leader.locator('[role="联盟弹窗-详情-成员"]')).toBeVisible();
    await expect(leader.locator('[role="联盟弹窗-申请加入"]')).toHaveCount(0);
    await leader.locator('[role="联盟弹窗-返回列表"]').click();
    await leader.locator('[role="排行榜弹窗-关闭按钮"]').click();

    // 名人堂：联盟页签，条目带联盟名
    await openLeaderboard(free);
    await free.locator('[role="排行榜弹窗-视图切换-名人堂"]').click();
    await free.locator('[role="排行榜-名人堂-榜种页签-联盟"]').click();
    await expect(free.locator('[role="排行榜-名人堂-条目"]', { hasText: allianceName })).toHaveCount(1);
    await free.locator('[role="排行榜弹窗-视图切换-实时榜"]').click();
    await free.locator('[role="排行榜弹窗-关闭按钮"]').click();
  });

  // 每种宽度一个用例（各自超时）：四皮肤 × 各界面串在一个用例里要 20 多分钟，容易整体超时
  for (const size of SIZES) {
  test(`四套皮肤 × ${size.width}×${size.height}：各界面零布局违规`, async () => {
    test.setTimeout(900_000);
    const { leader, vice, free } = pages;
    const all = [leader, vice, free];

    {
      for (const page of all) {
        await page.setViewportSize(size);
      }
      for (const skin of SKINS) {
        const tag = `${skin} ${size.width}×${size.height}`;
        await setSkin(all, skin);

        // 盟主：聊天联盟页签（有历史与系统消息）
        await openChat(leader);
        await chatAllianceTab(leader);
        await expectFit(leader, `${tag} 聊天-联盟页签`);
        if (skin === 'night' && size.width === 1440) {
          await leader.screenshot({ path: path.join(SHOT_DIR, `ally-chat-alliance-${skin}-${size.width}x${size.height}.png`) });
        }
        await closeChat(leader);

        // A：盟友地块（攻击禁用的说明在详情里）
        await gotoTile(vice, cityX, cityY);
        await expectFit(vice, `${tag} 地图-盟友地块`);
        if (skin === 'crimson' && size.width === 1100) {
          await vice.screenshot({ path: path.join(SHOT_DIR, `ally-map-ally-tile-${skin}-${size.width}x${size.height}.png`) });
        }

        // 盟主：标记表单（选中有联盟标记的格子之外的空格）与标记页签
        await gotoTile(leader, cityX - 2, cityY - 2);
        await leader.locator('[role="选中详情-操作-打标记"]').click();
        await expectFit(leader, `${tag} 地图-打标记表单`);
        if (skin === 'gilded' && size.width === 1440) {
          await leader.screenshot({ path: path.join(SHOT_DIR, `ally-map-mark-form-${skin}-${size.width}x${size.height}.png`) });
        }
        await openAlliance(leader);
        await leader.locator('[role="联盟弹窗-页签-标记"]').click();
        await expectFit(leader, `${tag} 联盟-标记页签`);
        if (skin === 'paper' && size.width === 390) {
          await leader.screenshot({ path: path.join(SHOT_DIR, `ally-marks-tab-${skin}-${size.width}x${size.height}.png`) });
        }
        await closeAlliance(leader);

        // 非盟员：联盟榜页签 → 点开联盟详情 → 返回；名人堂联盟页签
        await openLeaderboard(free);
        await free.locator('[role="排行榜弹窗-切换-联盟榜"]').click();
        await expectFit(free, `${tag} 联盟榜-列表`);
        if (skin === 'night' && size.width === 1440) {
          await free.screenshot({ path: path.join(SHOT_DIR, `ally-leaderboard-${skin}-${size.width}x${size.height}.png`) });
        }
        await free.locator('[role="排行榜弹窗-联盟条目"]', { hasText: allianceName }).click();
        await expectFit(free, `${tag} 联盟榜-公开信息`);
        await free.locator('[role="联盟弹窗-返回列表"]').click();
        await free.locator('[role="排行榜弹窗-视图切换-名人堂"]').click();
        await free.locator('[role="排行榜-名人堂-榜种页签-联盟"]').click();
        await expectFit(free, `${tag} 名人堂-联盟`);
        if (skin === 'crimson' && size.width === 1100) {
          await free.screenshot({ path: path.join(SHOT_DIR, `ally-hall-${skin}-${size.width}x${size.height}.png`) });
        }
        await free.locator('[role="排行榜弹窗-视图切换-实时榜"]').click();
        await free.locator('[role="排行榜弹窗-关闭按钮"]').click();
      }
    }
  });
  }
});
