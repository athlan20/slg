// 登录持久化端到端：预建账号登录 → 令牌落盘 → 刷新自动登录 → 切换账号 → 多会话并存。
// 覆盖 phase-1 的「账号与登录」与协议 v2 的会话令牌闭环（docs/agent-api.md）；
// v48 起密码通道不再自动注册，账号由 helpers 的 seedAccount 直插数据库。

import { expect, test } from '@playwright/test';
import { E2E_PASSWORD, gotoPage, loginViaForm, storedToken, switchAccountToLoginForm, uniqueUsername } from './helpers';

test('登录成功后令牌持久化，刷新页面免密自动登录', async ({ page }) => {
  const username = uniqueUsername('e2e');

  await page.goto('/');
  await expect(page.locator('[role="账号面板-登录表单"]')).toBeVisible();

  await loginViaForm(page, username);

  const token = await storedToken(page);
  expect(token).toBeTruthy();

  // 登录后账号面板不再显示：账号信息与切换入口都在侧栏账号菜单
  await expect(page.locator('[role="账号面板"]')).toHaveCount(0);

  // 刷新后不应再出现登录表单：自动登录直接进入已登录界面
  await page.reload();
  await expect(page.locator('[role="侧栏-账号"]')).toContainText(username, { timeout: 15_000 });
  await expect(page.locator('[role="账号面板-登录表单"]')).toHaveCount(0);
  await gotoPage(page, '情报');
  await expect(page.locator('[role="事件面板-列表"]')).toContainText('自动登录');
});

test('侧栏账号菜单切换账号：取消留在原地，确认后吊销令牌回到登录页', async ({ page }) => {
  const username = uniqueUsername('e2e-switch');

  await loginViaForm(page, username);
  expect(await storedToken(page)).toBeTruthy();

  // 取消：弹框关闭，仍处于已登录状态
  await page.locator('[role="侧栏-账号按钮"]').click();
  await page.locator('[role="账号菜单-切换账号"]').click();
  await expect(page.locator('[role="切换账号确认框"]')).toBeVisible();
  await page.locator('[role="切换账号-取消按钮"]').click();
  await expect(page.locator('[role="切换账号确认框"]')).toHaveCount(0);
  await expect(page.locator('[role="账号面板-登录表单"]')).toHaveCount(0);
  await expect(page.locator('[role="侧栏-账号"]')).toContainText(username);

  // 确认切换：退出登录（服务端吊销令牌）回到登录表单，本地令牌清除
  await switchAccountToLoginForm(page);
  expect(await storedToken(page)).toBeNull();

  await page.reload();
  await expect(page.locator('[role="账号面板-登录表单"]')).toBeVisible();
  await expect(page.locator('[role="侧栏-账号按钮"]')).toHaveCount(0);
});

test('同一账号多会话并存：第二个浏览器会话登录不顶替第一个', async ({ browser }) => {
  const username = uniqueUsername('e2e-multi');

  const first = await browser.newContext();
  const firstPage = await first.newPage();
  await loginViaForm(firstPage, username);

  const second = await browser.newContext();
  const secondPage = await second.newPage();
  await loginViaForm(secondPage, username);

  // 玩家网页（first）与第二个会话各持自己的令牌，互不顶替
  await expect(firstPage.locator('[role="侧栏-账号"]')).toContainText(username);
  await expect(firstPage.locator('[role="顶栏-本人在线状态"]')).toHaveAttribute('title', '本人：在线');

  await first.close();
  await second.close();
});

test('密码错误时给出人读错误并保留表单', async ({ page }) => {
  const username = uniqueUsername('e2e-wrongpass');

  // 预建账号并登录，再切换回登录页
  await loginViaForm(page, username);
  await switchAccountToLoginForm(page);

  // 用错误密码重新登录：提示错误，表单仍在
  const form = page.locator('[role="账号面板-登录表单"]');
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="password"]').fill('wrong-password');
  await page.locator('[role="账号面板-登录按钮"]').click();
  await expect(page.locator('[role="账号面板-登录错误"]')).toContainText('密码');
  await expect(page.locator('[role="账号面板-登录表单"]')).toBeVisible();
});
