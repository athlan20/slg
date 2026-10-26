// 手机顶栏城池胶囊（AISLG-191）：窄屏（402×874，触屏）下，顶栏「当前城池名 Lv ▾」能看到当前城、点开列出全部城池与分城名额，
// 选中分城后胶囊同步、页面切到该城；账号菜单里不再有「切换城池」段；Esc 与点外面都能关闭弹层。
// 分城直接落库（与 npc-occupy 占领的落库字段一致），不走占领战斗。
// 前置条件与其他 e2e 一致（playwright.config.ts 会拉起后端、前端）。

import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '@playwright/test';
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

/** 给账号加一座分城：挑一块无主荒野格，改成该分城的城池格（字段与 npc-occupy 落库一致） */
async function addBranchCity(username: string, name: string): Promise<void> {
  const tiles = await sql(`SELECT x, y FROM world_tiles WHERE kind = 'wilderness' AND owner_city_id IS NULL AND npc IS NULL ORDER BY random() LIMIT 1`);
  if (tiles.length === 0) {
    throw new Error('库里没有可用的无主荒野格');
  }
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
}

test.describe('手机顶栏城池胶囊（AISLG-191）', () => {
  test.use({ viewport: { width: 402, height: 874 }, hasTouch: true });

  test('多城账号：胶囊显示当前城，点开列出全部城池，选分城后胶囊与页面同步；Esc 与点外面关闭；账号菜单无切换城池段', async ({ page }) => {
    const username = uniqueUsername('e2e_capsule');
    const branchName = `分城${Date.now() % 100000}`;
    await seedAccount(username, E2E_PASSWORD);
    await addBranchCity(username, branchName);
    await loginViaForm(page, username);

    const capsule = page.locator('[role="顶栏-城池胶囊"]');
    const menu = page.locator('[role="导航-城池下拉"]');
    const items = menu.locator('[role="城池下拉-城池"]');

    // 胶囊显示当前城（主城），点开：两座城、主城打勾、分城名额
    await expect(capsule).toBeVisible();
    await expect(capsule).toBeEnabled();
    await capsule.click();
    await expect(menu).toBeVisible();
    await expect(items).toHaveCount(2);
    await expect(menu.locator('[role="城池下拉-分城名额"]')).toContainText('分城 1/');

    // 选分城：弹层关闭，胶囊文字变成分城名，页面数据跟着切换
    await items.filter({ hasText: branchName }).click();
    await expect(menu).toBeHidden();
    await expect(capsule).toContainText(branchName);
    await expect(capsule).toBeEnabled();

    // 账号菜单（「我」）里已没有「切换城池」段，其余项目还在
    await page.locator('[role="侧栏-账号按钮"]').click();
    await expect(page.locator('[role="账号菜单-账号设置"]')).toBeVisible();
    await expect(page.locator('[role="账号菜单-城池"]')).toHaveCount(0);
    await page.locator('[role="导航-页面标题"]').click();
    await expect(page.locator('[role="账号菜单-账号设置"]')).toBeHidden();

    // 再开胶囊：Esc 关闭
    await capsule.tap();
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    // 再开胶囊：触屏点外面（pointerdown）关闭
    await capsule.tap();
    await expect(menu).toBeVisible();
    await page.locator('[role="导航-页面标题"]').tap();
    await expect(menu).toBeHidden();
  });

  test('只有主城的账号：胶囊照常显示，弹层只有一座城与分城名额', async ({ page }) => {
    const username = uniqueUsername('e2e_capsule_solo');
    await loginViaForm(page, username);

    const capsule = page.locator('[role="顶栏-城池胶囊"]');
    await expect(capsule).toBeVisible();
    await capsule.click();
    const menu = page.locator('[role="导航-城池下拉"]');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[role="城池下拉-城池"]')).toHaveCount(1);
    await expect(menu.locator('[role="城池下拉-分城名额"]')).toContainText('分城 0/');
  });
});
