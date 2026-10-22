// 赛季系统的界面（v65，AISLG-134，docs/season-system.md 第 7 节）：
//   1. 顶栏赛季胶囊常驻：宽屏写法「S1 · 剩 N 天」，1280 以下写法「S1·N天」，手机同样可见；
//   2. 排行榜弹窗的名人堂页签：没有任何已结束赛季时显示空态「第 1 季结束后，这里会留下各榜前列」。
// 空态用例假定测试库里还没有已结束的赛季（新建的库只有第 1 季进行中）；库里已有存档时会看到榜单而非空态。

import { expect, test } from '@playwright/test';
import { loginViaForm, uniqueUsername } from './helpers';

test('顶栏赛季胶囊常驻显示剩余天数（宽屏长写法）', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await loginViaForm(page, uniqueUsername('e2e-season'));
  const pill = page.locator('[role="导航-赛季倒计时"]');
  await expect(pill).toBeVisible();
  // 剩余 ≤ 3 天时长写法带时分秒（如「S1 · 剩 2 天 03:12:45」），这里只断言前缀
  await expect(pill).toContainText(/S\d+ · 剩 /);
});

for (const size of [
  { width: 1100, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`${size.width}×${size.height}：赛季胶囊仍可见，使用短写法`, async ({ page }) => {
    await page.setViewportSize(size);
    await loginViaForm(page, uniqueUsername('e2e-season'));
    const pill = page.locator('[role="导航-赛季倒计时"]');
    await expect(pill).toBeVisible();
    // 第二个子元素是短写法（1280 以下显示），第一个长写法在此尺寸下隐藏
    await expect(pill.locator('span').nth(1)).toBeVisible();
    await expect(pill.locator('span').nth(1)).toHaveText(/S\d+·(\d+天|\d{2}:\d{2}:\d{2}|\d+天\d{2}:\d{2}:\d{2})/);
  });
}

test('排行榜名人堂：没有已结束赛季时显示空态', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await loginViaForm(page, uniqueUsername('e2e-hall'));
  await page.locator('[role="顶栏-排行榜按钮"]').click();
  await expect(page.locator('[role="排行榜弹窗"]')).toBeVisible();
  await page.locator('[role="排行榜弹窗-视图切换-名人堂"]').click();
  await expect(page.locator('[role="排行榜-名人堂"]')).toBeVisible();
  await expect(page.locator('[role="排行榜-名人堂-空态"]')).toContainText('第 1 季结束后，这里会留下各榜前列');
  // 榜种页签与赛季下拉在空态时禁用（不出现表格）
  await expect(page.locator('[role="排行榜-名人堂-榜种页签"] button')).toHaveCount(6);
  await expect(page.locator('[role="排行榜-名人堂-列表"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="排行榜弹窗"]')).toHaveCount(0);
});
