// 遣散士兵端到端（v84，AISLG-209）：登录 → 军队页切到「遣散」→ 按兵种填数量（长枪兵 40）→
// 站内确认弹窗（含返还预览）→ 确认后城内驻军下降、资源按征兵成本 50% 上升、事件流出现遣散记录。
// 新号没有兵，所以先在数据库里给预建账号的主城塞 100 个长枪兵（只动本用例新建的账号）。

import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { databaseUrl, seedAccount } from '../account-seed';
import { E2E_PASSWORD, gotoPage, loginViaForm, uniqueUsername } from './helpers';

const backendDir = path.resolve(__dirname, '../../backend');
const requireFromBackend = createRequire(path.join(backendDir, 'package.json'));
const pg = requireFromBackend('pg') as typeof import('pg');

/** 给该账号的主城写入城内驻军（测试夹具；正常游戏只能靠征兵） */
async function seedCityArmy(username: string, army: Record<string, number>): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl() });
  try {
    const city = (await pool.query(
      `SELECT c.id FROM cities c JOIN accounts a ON a.id = c.account_id WHERE a.username = $1 ORDER BY c.created_at LIMIT 1`,
      [username],
    )).rows[0] as { id: string } | undefined;
    if (!city) {
      throw new Error(`账号 ${username} 还没有主城`);
    }
    for (const [troop, count] of Object.entries(army)) {
      await pool.query(
        `INSERT INTO city_army (city_id, troop, count) VALUES ($1, $2, $3)
         ON CONFLICT (city_id, troop) DO UPDATE SET count = EXCLUDED.count, updated_at = now()`,
        [city.id, troop, count],
      );
    }
  } finally {
    await pool.end();
  }
}

test('遣散城内驻军：确认弹窗返还预览 → 驻军下降、资源上升、事件流记录', async ({ page }) => {
  const username = uniqueUsername('e2e-disband');
  await seedAccount(username, E2E_PASSWORD);
  await seedCityArmy(username, { pikeman: 100 });
  await loginViaForm(page, username);
  await gotoPage(page, '军队');

  // 征兵卡内切到「遣散」模式：兵种行展示城内数量
  await page.locator('[role="军队面板-模式-遣散"]').click();
  const row = page.locator('[role="遣散面板-兵种-枪"]');
  await expect(row).toContainText('长枪兵');
  await expect(row).toContainText('100');

  // 「全部」快捷按钮把数量填成城内数量
  await page.locator('[role="遣散面板-全部-枪"]').click();
  await expect(page.locator('[role="遣散面板-数量-枪"]')).toHaveValue('100');
  await page.locator('[role="遣散面板-数量-枪"]').fill('40');
  // 返还预览 = 单兵成本 × 40 × 50%：金 3000 / 木 1600 / 粮 2000 / 铁 1000 / 石 0
  const preview = page.locator('[role="遣散面板-返还预览"]');
  await expect(preview).toContainText('金 3,000');
  await expect(preview).toContainText('木 1,600');
  await expect(preview).toContainText('粮 2,000');
  await expect(preview).toContainText('铁 1,000');

  // 站内确认弹窗（不是浏览器原生 confirm）：写清兵种数量、返还与不可撤销
  await page.locator('[role="遣散面板-提交"]').click();
  const dialog = page.locator('[role="遣散确认框"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('长枪兵 ×40');
  await expect(dialog).toContainText('不可撤销');
  await expect(dialog).toContainText('不返还人口');
  await page.locator('[role="遣散确认框-确认按钮"]').click();

  // 确认后：驻军 100 → 60，资源按 50% 入账（金 2000 → 5000；官府产金只让数字更高）
  await expect(row).toContainText('60');
  await expect(page.locator('[role="顶栏-资源-金-存量"]')).toContainText(/5,0\d\d/);
  await expect(page.locator('[role="顶栏-资源-铁-存量"]')).toContainText(/3,0\d\d/);
  await expect(page.locator('[role="顶栏-资源-木-存量"]')).toContainText(/3,6\d\d/);

  // 事件流（情报页）出现遣散记录
  await gotoPage(page, '情报');
  await expect(page.locator('[role="事件面板-列表"]')).toContainText('遣散城内驻军');
  await expect(page.locator('[role="事件面板-列表"]')).toContainText('长枪兵');
});
