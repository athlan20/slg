// 手机端图层开关（AISLG-231）：宽度 < 640px 时卡片标题栏右侧给一个「图层」按钮，点开是全部图层复选框的面板
//（AISLG-239 起 6 个：多一个「势力范围」）；
// >= 640px 保持横排复选框。面板每行 ≥44px、点面板外 / Esc / 点地图格子都关闭（点格子仍选中），
// 勾选立刻生效且面板不自动关闭，DOM 里同一图层复选框的 role 只出现一次，英文界面文案英文、role 仍中文。
// 前置：playwright.config.ts 会拉起后端与前端；行军图层用直插 marches 验证（1 小时后到达，不会被 Worker 结算掉）。
// 未覆盖：产出数量在 15 格以上视野时只显示图标（由 YieldLayer 的纯函数保证）；手机真机触摸手势。

import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { E2E_PASSWORD, gotoPage, loginViaForm, uniqueUsername } from './helpers';
import { databaseUrl, seedAccount } from '../account-seed';

const requireFromBackend = createRequire(path.join(__dirname, '../../backend/package.json'));
const pg = requireFromBackend('pg') as typeof import('pg');

const MAP_ROLE = '地图页-地图卡';
const buttonRole = `${MAP_ROLE}-图层按钮`;
const panelRole = `${MAP_ROLE}-图层面板`;
const menuRole = `${MAP_ROLE}-图层菜单`;
const inlineRole = `${MAP_ROLE}-图层`;
/** 图层的中文 role 后缀（role 不随界面语言变）；顺序与 mapLayerOptions 一致，AISLG-239 起加了「势力范围」 */
const LAYER_NAMES = ['流寇·商队', '黄巾', '领地', '行军', '产出', '势力范围'] as const;
const checkboxRole = (name: string) => `${MAP_ROLE}-图层-${name}`;
const rowRole = (name: string) => `${MAP_ROLE}-图层行-${name}`;

async function sql(text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const pool = new pg.Pool({ connectionString: databaseUrl() });
  try {
    const res = await pool.query(text, params);
    return res.rows as Record<string, unknown>[];
  } finally {
    await pool.end();
  }
}

/** 在玩家主城旁边插一支在外行军，用来验证「行军」图层的开关效果 */
async function seedMarch(username: string): Promise<void> {
  const city = await sql(`SELECT id, x, y FROM cities WHERE account_id = (SELECT id FROM accounts WHERE username = $1) ORDER BY created_at LIMIT 1`, [username]);
  if (city.length === 0) {
    throw new Error('账号没有主城');
  }
  await sql(
    `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, started_at, arrive_at)
     VALUES ((SELECT id FROM accounts WHERE username = $1), $2, $3, $4, $5::jsonb, 'transport', 'marching', 'player', now(), now() + interval '1 hour')`,
    [username, city[0].id, Number(city[0].x) + 1, Number(city[0].y), JSON.stringify({ supply_wagon: 2 })],
  );
}

test.describe('手机端图层按钮（AISLG-231）', () => {
  test('390 宽：按钮开面板，6 项齐全、每行 ≥44px，勾选行军立刻生效且面板不关闭', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const username = uniqueUsername('e2e_lyr_menu');
    await seedAccount(username, E2E_PASSWORD);
    await seedMarch(username);
    await loginViaForm(page, username);
    await gotoPage(page, '地图');

    // 窄屏只有按钮，没有横排复选框容器
    await expect(page.locator(`[role="${buttonRole}"]`)).toBeVisible();
    await expect(page.locator(`[role="${inlineRole}"]`)).toHaveCount(0);
    await expect(page.locator(`[role="${panelRole}"]`)).toHaveCount(0);

    // 面板盖在地图上方：不改变地图可视格数
    const cellCount = await page.locator('[role="世界地图视野-地块"]').count();
    await page.locator(`[role="${buttonRole}"]`).click();
    const panel = page.locator(`[role="${panelRole}"]`);
    await expect(panel).toBeVisible();
    expect(await page.locator('[role="世界地图视野-地块"]').count(), '打开面板后地图格数变了').toBe(cellCount);

    // 面板宽 ≤ 240px 且不超出屏幕
    const panelBox = await panel.boundingBox();
    expect(panelBox, '取不到面板位置').not.toBeNull();
    expect(Math.round(panelBox!.width), '面板宽超过 240px').toBeLessThanOrEqual(240);
    expect(panelBox!.x, '面板超出屏幕左边界').toBeGreaterThanOrEqual(0);
    expect(panelBox!.x + panelBox!.width, '面板超出屏幕右边界').toBeLessThanOrEqual(390);

    // 6 项齐全，同一个复选框的 role 只出现一次（不靠 CSS 藏第二份）
    for (const name of LAYER_NAMES) {
      await expect(page.locator(`[role="${checkboxRole(name)}"]`)).toHaveCount(1);
      await expect(page.locator(`[role="${rowRole(name)}"]`)).toBeVisible();
    }

    // 每行点击区域高度 ≥ 44px
    for (const name of LAYER_NAMES) {
      const box = await page.locator(`[role="${rowRole(name)}"]`).boundingBox();
      expect(box, `${name} 行取不到位置`).not.toBeNull();
      expect(Math.round(box!.height), `${name} 行高不足 44px`).toBeGreaterThanOrEqual(44);
    }

    // 行军默认开：线 / 图标都在；勾掉后消失，再勾回来恢复（面板始终不关闭）
    const marchRoute = page.locator('[role="世界地图-行军路线"]');
    await expect(marchRoute).toHaveCount(1);
    await page.locator(`[role="${rowRole('行军')}"]`).click();
    await expect(page.locator(`[role="${checkboxRole('行军')}"]`)).not.toBeChecked();
    await expect(marchRoute).toHaveCount(0);
    await expect(page.locator(`[role="${panelRole}"]`)).toBeVisible();
    await page.locator(`[role="${rowRole('行军')}"]`).click();
    await expect(page.locator(`[role="${checkboxRole('行军')}"]`)).toBeChecked();
    await expect(marchRoute).toHaveCount(1);

    // 产出默认关：勾上后地图格上出现产出标记
    const yieldMark = page.locator('[role="世界地图-产出"]');
    await expect(yieldMark).toHaveCount(0);
    await page.locator(`[role="${rowRole('产出')}"]`).click();
    await expect(page.locator(`[role="${checkboxRole('产出')}"]`)).toBeChecked();
    await expect(yieldMark.first()).toBeVisible();
    // 手机上视野格数少，数字（+N）与图标一起显示
    await expect(page.locator('[role="世界地图-产出"]').filter({ hasText: '+' }).first()).toBeVisible();
    await expect(page.locator(`[role="${panelRole}"]`)).toBeVisible();
  });

  test('390 宽：点面板外 / Esc / 点地图格子都关闭面板，点格子仍选中该格', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const username = uniqueUsername('e2e_lyr_close');
    await seedAccount(username, E2E_PASSWORD);
    await loginViaForm(page, username);
    await gotoPage(page, '地图');

    const panel = page.locator(`[role="${panelRole}"]`);
    const button = page.locator(`[role="${buttonRole}"]`);
    const detail = page.locator('[role="地图页-选中详情"]');

    // 点面板以外（标题栏左侧）
    await button.click();
    await expect(panel).toBeVisible();
    await page.locator(`[role="${MAP_ROLE}-头部"] h2`).click();
    await expect(panel).toHaveCount(0);

    // Esc
    await button.click();
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    // 点地图格子：面板关闭，同时该格被选中（选中后右侧 / 详情区出现选中详情）
    await button.click();
    await expect(panel).toBeVisible();
    const cell = page.locator('[role="世界地图视野-地块"]').first();
    await expect(cell).toBeVisible();
    await cell.click();
    await expect(panel).toHaveCount(0);
    // 选中：格子 aria-pressed 置位，详情区出现（说明点击没被面板吞掉）
    await expect(cell).toHaveAttribute('aria-pressed', 'true');
    await expect(detail).toBeVisible();
  });

  test('639 显示按钮、640 显示横排复选框，两种宽度共用同一份图层状态', async ({ page }) => {
    await page.setViewportSize({ width: 639, height: 900 });
    const username = uniqueUsername('e2e_lyr_width');
    await seedAccount(username, E2E_PASSWORD);
    await loginViaForm(page, username);
    await gotoPage(page, '地图');

    // 639：按钮形态
    await expect(page.locator(`[role="${buttonRole}"]`)).toBeVisible();
    await expect(page.locator(`[role="${inlineRole}"]`)).toHaveCount(0);
    await page.locator(`[role="${buttonRole}"]`).click();
    await page.locator(`[role="${rowRole('领地')}"]`).click();
    await expect(page.locator(`[role="${checkboxRole('领地')}"]`)).not.toBeChecked();

    // 640：横排复选框形态，状态与窄屏一致（同一份 NavContext.layers）
    await page.setViewportSize({ width: 640, height: 900 });
    await expect(page.locator(`[role="${inlineRole}"]`)).toBeVisible();
    await expect(page.locator(`[role="${buttonRole}"]`)).toHaveCount(0);
    await expect(page.locator(`[role="${menuRole}"]`)).toHaveCount(0);
    for (const name of LAYER_NAMES) {
      await expect(page.locator(`[role="${checkboxRole(name)}"]`)).toHaveCount(1);
    }
    await expect(page.locator(`[role="${checkboxRole('领地')}"]`)).not.toBeChecked();
    await expect(page.locator(`[role="${checkboxRole('行军')}"]`)).toBeChecked();
    await expect(page.locator(`[role="${checkboxRole('产出')}"]`)).not.toBeChecked();

    // 切回 639 仍是按钮形态，勾选状态不丢
    await page.setViewportSize({ width: 639, height: 900 });
    await expect(page.locator(`[role="${buttonRole}"]`)).toBeVisible();
    await page.locator(`[role="${buttonRole}"]`).click();
    await expect(page.locator(`[role="${checkboxRole('领地')}"]`)).not.toBeChecked();
  });

  test('1280 宽：横排复选框与改动前一致，没有图层按钮', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const username = uniqueUsername('e2e_lyr_wide');
    await seedAccount(username, E2E_PASSWORD);
    await loginViaForm(page, username);
    await gotoPage(page, '地图');

    await expect(page.locator(`[role="${inlineRole}"]`)).toBeVisible();
    await expect(page.locator(`[role="${buttonRole}"]`)).toHaveCount(0);
    for (const name of LAYER_NAMES) {
      await expect(page.locator(`[role="${checkboxRole(name)}"]`)).toHaveCount(1);
    }
    // 默认值不变：行军开、产出关
    await expect(page.locator(`[role="${checkboxRole('行军')}"]`)).toBeChecked();
    await expect(page.locator(`[role="${checkboxRole('产出')}"]`)).not.toBeChecked();
  });

  test('英文界面：按钮与面板文案是英文，role 仍是中文', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const username = uniqueUsername('e2e_lyr_en');
    await seedAccount(username, E2E_PASSWORD);
    await loginViaForm(page, username);

    await page.locator('[role="侧栏-账号按钮"]').click();
    await page.locator('[role="账号菜单-语言-en"]').click();
    await gotoPage(page, '地图');

    const button = page.locator(`[role="${buttonRole}"]`);
    await expect(button).toHaveText('Layers');
    await button.click();
    await expect(page.locator(`[role="${panelRole}"]`)).toBeVisible();
    await expect(page.locator(`[role="${rowRole('行军')}"]`)).toContainText('Marches');
    await expect(page.locator(`[role="${rowRole('产出')}"]`)).toContainText('Yield');
    // 五方势力的图层（AISLG-239）：英文文案是 Factions
    await expect(page.locator(`[role="${rowRole('势力范围')}"]`)).toContainText('Factions');
    await expect(page.locator(`[role="${checkboxRole('行军')}"]`)).toHaveCount(1);
  });
});
