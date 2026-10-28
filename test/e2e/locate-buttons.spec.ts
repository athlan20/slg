// AISLG-203：「定位」按钮（城池下拉 + 战报详情）。
// 覆盖验收 1–6：城池下拉每行定位、无坐标不显示、不切换当前城池；手机宽度可点不误触；
// 战报详情定位关闭弹窗并居中选中该格；剧本战场战报不显示；英文文案 Locate。
// 前置：playwright.config.ts 会拉起后端与前端；分城 / 无坐标城 / 战报直接落库（与真实落库字段一致）。

import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { databaseUrl, seedAccount } from '../account-seed';
import { E2E_PASSWORD, loginViaForm, uniqueUsername } from './helpers';

const requireFromBackend = createRequire(path.join(__dirname, '../../backend/package.json'));
const pg = requireFromBackend('pg') as typeof import('pg');

async function sql(text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const pool = new pg.Pool({ connectionString: databaseUrl() });
  try {
    const res = await pool.query(text, params);
    return res.rows as Record<string, unknown>[];
  } finally {
    await pool.end();
  }
}

interface CityFixture {
  name: string;
  cityId: string;
  x: number | null;
  y: number | null;
}

/** 主城坐标 */
async function mainCityCoords(username: string): Promise<{ x: number; y: number }> {
  const rows = await sql(`SELECT x, y FROM cities WHERE account_id = (SELECT id FROM accounts WHERE username = $1) ORDER BY created_at LIMIT 1`, [username]);
  return { x: Number(rows[0].x), y: Number(rows[0].y) };
}

/** 加一座有坐标的分城（字段与 npc-occupy 落库一致，占用一块无主荒野格） */
async function addBranchCity(username: string, name: string): Promise<CityFixture> {
  const tiles = await sql(`SELECT x, y FROM world_tiles WHERE kind = 'wilderness' AND owner_city_id IS NULL AND npc IS NULL ORDER BY random() LIMIT 1`);
  if (tiles.length === 0) throw new Error('库里没有可用的无主荒野格');
  const x = Number(tiles[0].x);
  const y = Number(tiles[0].y);
  const rows = await sql(
    `INSERT INTO cities (account_id, name, gold, wood, food, x, y, origin_level)
     SELECT id, $2::text, 0, 0, 0, $3::int, $4::int, 1 FROM accounts WHERE username = $1 RETURNING id`,
    [username, name, x, y],
  );
  const cityId = rows[0].id as string;
  await sql(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 1)`, [cityId]);
  await sql(`UPDATE world_tiles SET kind = 'city', level = 0, owner_city_id = $1, npc = NULL WHERE x = $2 AND y = $3`, [cityId, x, y]);
  return { name, cityId, x, y };
}

/** 加一座没有坐标的分城：只落 cities 行，不占地图格（x/y 为 null） */
async function addNoCoordCity(username: string, name: string): Promise<CityFixture> {
  const rows = await sql(
    `INSERT INTO cities (account_id, name, gold, wood, food, x, y, origin_level)
     SELECT id, $2::text, 0, 0, 0, NULL, NULL, 1 FROM accounts WHERE username = $1 RETURNING id`,
    [username, name],
  );
  const cityId = rows[0].id as string;
  await sql(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 1)`, [cityId]);
  return { name, cityId, x: null, y: null };
}

/** 战报详情载荷（结构同 battle_reports.detail；读出时由服务端补 units 等派生字段） */
function reportDetail(kind: string, x: number, y: number): Record<string, unknown> {
  const troops = { militia: 10, swordsman: 0, archer: 0, cavalry: 0, scout: 0, porter: 0 };
  const losses = { militia: 2, swordsman: 0, archer: 0, cavalry: 0, scout: 0, porter: 0 };
  const survivors = { militia: 8, swordsman: 0, archer: 0, cavalry: 0, scout: 0, porter: 0 };
  return {
    kind, x, y, role: 'attacker', won: true, rounds: 1, endReason: 'defender_wiped', wallDefensePercent: 0,
    attacker: { name: '测试攻方', troops, losses, survivors, damage: 120 },
    defender: { name: '测试守方', troops, losses, survivors, damage: 60 },
    roundLog: [{ round: 1, attackerDamage: 120, defenderDamage: 60, attackerKilled: 8, defenderKilled: 8 }],
  };
}

async function seedReport(username: string, kind: string, x: number, y: number): Promise<void> {
  await sql(
    `INSERT INTO battle_reports (account_id, x, y, kind, detail)
     SELECT id, $2, $3, $4, $5::jsonb FROM accounts WHERE username = $1`,
    [username, x, y, kind, JSON.stringify(reportDetail(kind, x, y))],
  );
}

/** 地图页已选中 (x,y) 且该格在视野中心附近（居中口径：格子中心与地图容器中心的偏差 ≤ 1 格） */
async function expectMapFocusedOn(page: Page, x: number, y: number): Promise<void> {
  await expect(page.locator('[role="导航-地图"]')).toHaveAttribute('aria-current', 'page');
  const cell = page.locator(`[role="世界地图视野-地块"][data-x="${x}"][data-y="${y}"]`);
  await expect(cell).toBeVisible();
  await expect(cell).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[role="选中详情-标题"]')).toContainText(`(${x},${y})`);
  const box = await page.locator('[role="世界地图视图-地图"]').boundingBox();
  const cellBox = await cell.boundingBox();
  if (!box || !cellBox) throw new Error('拿不到地图容器 / 格子的位置');
  const dx = Math.abs(cellBox.x + cellBox.width / 2 - (box.x + box.width / 2));
  const dy = Math.abs(cellBox.y + cellBox.height / 2 - (box.y + box.height / 2));
  expect(dx, `水平偏移 ${dx}px`).toBeLessThanOrEqual(70);
  expect(dy, `垂直偏移 ${dy}px`).toBeLessThanOrEqual(70);
}

test.describe('城池下拉-定位（AISLG-203）', () => {
  test('桌面：有坐标的城有定位、点定位不切换当前城池、点城名仍切换、无坐标不显示', async ({ page }) => {
    const username = uniqueUsername('e2e_locate_menu');
    await seedAccount(username, E2E_PASSWORD);
    const branch = await addBranchCity(username, `定位分城${Date.now() % 100000}`);
    const noCoord = await addNoCoordCity(username, `无坐标城${Date.now() % 100000}`);
    const main = await mainCityCoords(username);
    await loginViaForm(page, username);

    const menu = page.locator('[role="导航-城池下拉"]');
    const cityTitle = page.locator('[role="导航-城池名"]');
    const activeText = await cityTitle.textContent();

    await page.locator('[role="导航-城池切换"]').click();
    await expect(menu).toBeVisible();

    // 1) 每座有坐标的城都有定位；无坐标的城没有
    const branchRow = menu.locator('[role="城池下拉-行"]').filter({ hasText: branch.name });
    const mainRow = menu.locator('[role="城池下拉-行"]').first();
    const noCoordRow = menu.locator('[role="城池下拉-行"]').filter({ hasText: noCoord.name });
    await expect(branchRow.locator('[role="城池下拉-定位"]')).toBeVisible();
    await expect(mainRow.locator('[role="城池下拉-定位"]')).toBeVisible();
    await expect(noCoordRow.locator('[role="城池下拉-定位"]')).toHaveCount(0);

    // 2) 点定位：关下拉、切地图页、居中选中分城格、当前城池不变
    await branchRow.locator('[role="城池下拉-定位"]').click();
    await expect(menu).toBeHidden();
    await expectMapFocusedOn(page, branch.x as number, branch.y as number);
    expect(await cityTitle.textContent()).toBe(activeText);

    // 3) 点城名那一块仍是切换当前城池
    await page.locator('[role="导航-城池切换"]').click();
    await expect(menu).toBeVisible();
    await menu.locator('[role="城池下拉-行"]').filter({ hasText: branch.name }).locator('[role="城池下拉-城池"]').click();
    await expect(cityTitle).toContainText(branch.name);
    await expect(menu).toBeHidden();

    // 4) 主城定位同样可用（当前城池已是分城，定位主城不应改回主城）
    await page.locator('[role="导航-城池切换"]').click();
    const mainRow2 = page.locator('[role="导航-城池下拉"] [role="城池下拉-行"]').filter({ hasText: '主城' }).first();
    const beforeMainLocate = await cityTitle.textContent();
    await mainRow2.locator('[role="城池下拉-定位"]').click();
    await expectMapFocusedOn(page, main.x, main.y);
    expect(await cityTitle.textContent()).toBe(beforeMainLocate);
  });

  test('英文界面：定位按钮文案为 Locate', async ({ page }) => {
    const username = uniqueUsername('e2e_locate_en');
    await seedAccount(username, E2E_PASSWORD);
    await addBranchCity(username, `LocateBranch${Date.now() % 100000}`);
    await loginViaForm(page, username);
    // 登录辅助按中文界面断言，登完再切英文并刷新
    await page.evaluate(() => localStorage.setItem('slg-lang', 'en'));
    await page.reload();
    await expect(page.locator('[role="顶栏-本人在线状态"]')).toHaveAttribute('title', 'You: Online');

    await page.locator('[role="导航-城池切换"]').click();
    const menu = page.locator('[role="导航-城池下拉"]');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[role="城池下拉-定位"]').first()).toHaveText('Locate');
  });

  test('手机宽度（402×874）：下拉定位可点、高度 ≥ 40px、不误触切换当前城池', async ({ page }) => {
    await page.setViewportSize({ width: 402, height: 874 });
    const username = uniqueUsername('e2e_locate_mobile');
    await seedAccount(username, E2E_PASSWORD);
    const branch = await addBranchCity(username, `定位分城${Date.now() % 100000}`);
    await loginViaForm(page, username);

    const capsule = page.locator('[role="顶栏-城池胶囊"]');
    const menu = page.locator('[role="导航-城池下拉"]');
    await capsule.click();
    await expect(menu).toBeVisible();
    const locate = menu.locator('[role="城池下拉-行"]').filter({ hasText: branch.name }).locator('[role="城池下拉-定位"]');
    await expect(locate).toBeVisible();
    const box = await locate.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
    const before = await capsule.textContent();

    await locate.tap();
    await expect(menu).toBeHidden();
    await expectMapFocusedOn(page, branch.x as number, branch.y as number);
    expect(await capsule.textContent()).toBe(before);
  });
});

test.describe('战报详情-定位（AISLG-203）', () => {
  test('普通战报：坐标旁有定位，点后关弹窗、切地图页并居中选中；剧本战场战报没有定位', async ({ page }) => {
    const username = uniqueUsername('e2e_locate_report');
    await seedAccount(username, E2E_PASSWORD);
    await seedReport(username, 'battlefield', 15, 10); // 先落库，排在下面
    const target = { x: 123, y: 45 };
    await seedReport(username, 'wilderness', target.x, target.y);
    await loginViaForm(page, username);

    await page.locator('[role="导航-情报"]').click();
    const rows = page.locator('[role="左列-战报行"]');
    await expect(rows.first()).toBeVisible();

    // 1) 剧本战场战报：弹窗里没有定位
    await rows.filter({ hasText: '剧本战场' }).first().click();
    const modal = page.locator('[role="战报弹窗"]');
    await expect(modal).toBeVisible();
    await expect(modal.locator('[role="战报弹窗-定位"]')).toHaveCount(0);
    await expect(modal.locator('[role="战报弹窗-头部"]')).toContainText('(15,10)');
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();

    // 2) 野地战报：坐标旁有定位；点击后弹窗关闭、地图居中选中该格
    await rows.filter({ hasText: '野地' }).first().click();
    await expect(modal).toBeVisible();
    await expect(modal.locator('[role="战报弹窗-头部"]')).toContainText(`(${target.x},${target.y})`);
    const locate = modal.locator('[role="战报弹窗-定位"]');
    await expect(locate).toHaveText('定位');
    await locate.click();
    await expect(modal).toBeHidden();
    await expectMapFocusedOn(page, target.x, target.y);
  });
});