// 手机端布局验收（AISLG-214 / GitHub #32）：iPhone 17 Pro Max 两个方向的底部导航与城池页。
//   竖屏 440×956：底部导航 12 个入口（11 个页签 + 账号）同一行、等高、文字都不折行，
//                "将星塔"在手机上只用短标签"将星"；点"烽火台"能选中出详情，导航栏不被遮挡。
//   横屏 956×440：底部导航只显示图标、高度压到 44px；城池页 15 座建筑格都能（滚动）看到，
//                任何一格都不与导航栏重叠（格子 bottom ≤ 导航栏 top）。
//   两个尺寸下 8 个页面都不把内容溢出到导航栏上方。
//   桌面 1440×900 / 平板 1200×800 与现状一致（左侧图标栏 + 92px 大格子 + "将星塔"全称）。
//   英文界面同样通过（"Star Tower"在手机上显示"Tower"）。
// 只断言几何关系，不截图比对，避免不同机器的字体渲染差异。

import { expect, test, type Page } from '@playwright/test';
import { loginViaForm, uniqueUsername } from './helpers';

const PORTRAIT = { width: 440, height: 956 };
const LANDSCAPE = { width: 956, height: 440 };

/** 底部导航的 12 个入口：11 个页签（含公告 / 联盟 / 聊天）+ 账号 */
const ENTRY_ROLES = [
  '导航-总览',
  '导航-地图',
  '导航-城池',
  '导航-军队',
  '导航-养成',
  '导航-将星塔',
  '导航-情报',
  '导航-Agent',
  '导航-公告',
  '导航-联盟',
  '导航-聊天',
  '侧栏-账号按钮',
];

const PAGE_KEYS = ['overview', 'map', 'city', 'army', 'growth', 'starTower', 'intel', 'agent'] as const;

const CELLS = '[role="城内视图-建筑格"] [role^="城内视图-建筑-"]';

async function gotoHash(page: Page, key: string): Promise<void> {
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, key);
  await page.waitForTimeout(400);
}

async function navBar(page: Page): Promise<{ y: number; height: number }> {
  const box = await page.locator('[role="导航-侧栏"]').boundingBox();
  expect(box, '找不到导航栏').not.toBeNull();
  return { y: box!.y, height: box!.height };
}

/** 竖屏：12 个入口同一行、同一高度，每个入口的文字只占一行 */
async function expectNavRow(page: Page): Promise<void> {
  const boxes: Array<{ role: string; y: number; height: number }> = [];
  for (const role of ENTRY_ROLES) {
    const locator = page.locator(`[role="${role}"]`);
    await expect(locator, `${role} 不存在`).toBeVisible();
    const box = await locator.boundingBox();
    expect(box, `${role} 取不到位置`).not.toBeNull();
    boxes.push({ role, y: box!.y, height: box!.height });
  }
  const top = Math.min(...boxes.map((item) => item.y));
  const height = Math.max(...boxes.map((item) => item.height));
  for (const item of boxes) {
    expect(Math.abs(item.y - top), `${item.role} 与其它入口不在同一行`).toBeLessThanOrEqual(1);
    expect(Math.abs(item.height - height), `${item.role} 与其它入口不等高`).toBeLessThanOrEqual(1);
  }
  // 文字单行：中文折成两行时 span 会出现两个以上的行框
  for (const role of ENTRY_ROLES) {
    const lines = await page
      .locator(`[role="${role}"] span.nav-label`)
      .evaluate((el) => el.getClientRects().length);
    expect(lines, `${role} 的文字折行了`).toBe(1);
  }
}

/** 横屏：导航只留图标，高度 44px */
async function expectIconOnlyNav(page: Page): Promise<void> {
  const bar = await navBar(page);
  expect(Math.round(bar.height), '横屏导航栏高度应为 44px').toBe(44);
  for (const role of ENTRY_ROLES) {
    await expect(page.locator(`[role="${role}"] span.nav-label`), `${role} 的文字在横屏应隐藏`).toBeHidden();
  }
  await expect(page.locator('[role="导航-地图"] b')).toBeVisible();
}

/** 城池页 15 座建筑格逐一滚到可见位置，且都不压到底部导航栏上 */
async function expectCellsClearOfNav(page: Page): Promise<void> {
  const bar = await navBar(page);
  await expect(page.locator('[role="城内视图-建筑格"]')).toBeVisible();
  const cells = page.locator(CELLS);
  expect(await cells.count(), '城池页建筑格数量').toBe(15);
  for (let i = 0; i < 15; i += 1) {
    const cell = cells.nth(i);
    await cell.scrollIntoViewIfNeeded();
    const box = await cell.boundingBox();
    const role = await cell.getAttribute('role');
    expect(box, `${role} 取不到位置`).not.toBeNull();
    expect(box!.y + box!.height, `${role} 与底部导航重叠`).toBeLessThanOrEqual(bar.y + 1);
    expect(box!.y, `${role} 被顶出工作区上边`).toBeGreaterThanOrEqual(0);
  }
}

/** 工作区：自身在导航栏上方，且内容不溢出（区块内部滚动允许，溢出一层不允许） */
async function expectWorkClearOfNav(page: Page, label: string): Promise<void> {
  await page.waitForTimeout(400);
  const bar = await navBar(page);
  const work = page.locator('[role="导航-工作区"]');
  const box = await work.boundingBox();
  expect(box, '找不到工作区').not.toBeNull();
  expect(box!.y + box!.height, `${label}：工作区压到导航栏上`).toBeLessThanOrEqual(bar.y + 1);
  const overflow = await page
    .locator('[role="导航-工作区"] > *')
    .first()
    .evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(overflow, `${label}：工作区内容溢出 ${overflow}px`).toBeLessThanOrEqual(1);
}

test('竖屏 440×956：底部导航 12 个入口同一行、等高、文字单行', async ({ page }) => {
  await page.setViewportSize(PORTRAIT);
  await loginViaForm(page, uniqueUsername('e2e-mobile'));

  const bar = await navBar(page);
  expect(Math.round(bar.height), '竖屏导航栏高度').toBe(56);

  // 12 个入口平分一行：同一 top、同一高度，文字都不折行
  await expectNavRow(page);
  // 手机短标签只改显示文字，桌面端仍是"将星塔"（role 与 title 保持全称）
  await expect(page.locator('[role="导航-将星塔"] span.nav-label')).toHaveText('将星');
  await expect(page.locator('[role="导航-将星塔"]')).toHaveAttribute('title', '将星塔');
});

test('横屏 956×440：导航只显示图标，城池页建筑格不与导航栏重叠', async ({ page }) => {
  await page.setViewportSize(LANDSCAPE);
  await loginViaForm(page, uniqueUsername('e2e-mobile-land'));

  await expectIconOnlyNav(page);

  await gotoHash(page, 'city');
  await expectCellsClearOfNav(page);
  // 横屏用竖屏同款的紧凑格（66px），不是桌面 92px 大格子
  const cellHeight = await page.locator(CELLS).first().evaluate((el) => el.getBoundingClientRect().height);
  expect(Math.round(cellHeight), '横屏建筑格高度应为 66px').toBe(66);
});

test('竖屏 440×956：城池页点"烽火台"能选中出详情，导航栏不被遮挡', async ({ page }) => {
  await page.setViewportSize(PORTRAIT);
  await loginViaForm(page, uniqueUsername('e2e-mobile-beacon'));

  await gotoHash(page, 'city');
  await expectCellsClearOfNav(page);

  await page.locator('[role="城内视图-建筑-烽"]').click();
  await expect(page.locator('[role="城池页-建筑详情"]')).toBeVisible();
  await expect(page.locator('[role="城池页-建筑详情-标题"]')).toContainText('烽火台');
  await expectWorkClearOfNav(page, '竖屏城池页选中烽火台');
});

test('两个尺寸下 8 个页面都不把内容溢出到导航栏上方', async ({ page }) => {
  await page.setViewportSize(PORTRAIT);
  await loginViaForm(page, uniqueUsername('e2e-mobile-pages'));
  await expect(page.locator('[role="顶栏-资源"]')).toBeVisible();

  for (const size of [PORTRAIT, LANDSCAPE]) {
    await page.setViewportSize(size);
    for (const key of PAGE_KEYS) {
      await gotoHash(page, key);
      await expectWorkClearOfNav(page, `${size.width}×${size.height} #${key}`);
    }
  }
});

test('桌面 1440×900 与平板 1200×800：样式与现状一致', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginViaForm(page, uniqueUsername('e2e-mobile-desktop'));

  for (const size of [
    { width: 1440, height: 900 },
    { width: 1200, height: 800 },
  ]) {
    await page.setViewportSize(size);
    await gotoHash(page, 'city');
    // 侧栏在左侧（不是底部横条）
    const sidebar = await page.locator('[role="导航-侧栏"]').boundingBox();
    expect(sidebar!.y, `${size.width}×${size.height} 侧栏应在左侧`).toBeLessThan(20);
    expect(sidebar!.width, `${size.width}×${size.height} 侧栏应为窄图标栏`).toBeLessThan(200);
    // 1024–1279 是 60px 图标栏（不显示文字）；≥ 1280 用全称"将星塔"，不换成手机短标签
    const starLabel = page.locator('[role="导航-将星塔"] span.nav-label');
    const starLabelFull = page.locator('[role="导航-将星塔"] span.nav-label-full');
    await expect(starLabel, `${size.width}×${size.height} 手机短标签不应出现`).toBeHidden();
    if (size.width >= 1280) {
      await expect(starLabelFull).toHaveText('将星塔');
    } else {
      await expect(starLabelFull).toBeHidden();
    }
    const cellHeight = await page.locator(CELLS).first().evaluate((el) => el.getBoundingClientRect().height);
    expect(Math.round(cellHeight), `${size.width}×${size.height} 建筑格应保持 92px`).toBe(92);
  }
});

test('英文界面：手机竖屏用 "Tower" 短标签，入口同样单行、等高', async ({ page }) => {
  await page.setViewportSize(PORTRAIT);
  await loginViaForm(page, uniqueUsername('e2e-mobile-en'));

  await page.locator('[role="侧栏-账号按钮"]').click();
  await page.locator('[role="账号菜单-语言-en"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.keyboard.press('Escape');

  await expect(page.locator('[role="导航-将星塔"] span.nav-label')).toHaveText('Tower');
  // role 定位值保持中文（约定）：按中文 role 仍能命中 12 个入口
  await expectNavRow(page);

  // 英文城池页在横屏也不重叠
  await page.setViewportSize(LANDSCAPE);
  await gotoHash(page, 'city');
  await expectCellsClearOfNav(page);
});
