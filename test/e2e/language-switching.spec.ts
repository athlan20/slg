// 界面双语端到端（AISLG-137）：账号菜单手动切换语言——同一页面即时生效（不刷新）、
// 刷新后保持手动选择、可切回中文；同时守住「role 定位值不随语言变」的约定
// （中文 role 在英文界面必须仍然可命中，否则 e2e 的 role 选择器会在英文界面失效）。
// 默认语言跟随浏览器（locale 固定 zh-CN，见 playwright.config）不在本用例范围。

import { expect, test } from '@playwright/test';
import { loginViaForm, uniqueUsername } from './helpers';

test('账号菜单切换语言：即时生效、刷新后保持、可切回中文', async ({ page }) => {
  const username = uniqueUsername('lang');
  await loginViaForm(page, username);

  // 基准：中文界面（浏览器 locale 固定 zh-CN）
  await expect(page.locator('[role="导航-总览"]')).toContainText('总览');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

  // 主界面侧栏角落常驻开源仓库入口（桌面宽侧栏）
  await expect(page.locator('[role="侧栏-GitHub仓库"]')).toBeVisible();
  await expect(page.locator('[role="侧栏-GitHub仓库"]')).toHaveAttribute('href', 'https://github.com/athlan20/slg');

  // 账号菜单切到英文：不刷新，导航文案与 <html lang> 立即切换
  await page.locator('[role="侧栏-账号按钮"]').click();
  await page.locator('[role="账号菜单-语言-en"]').click();
  await expect(page.locator('[role="导航-总览"]')).toContainText('Overview');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('[role="账号菜单-语言-en"]')).toHaveAttribute('aria-pressed', 'true');

  // role 定位值保持中文（约定）：顶栏资源格的 role 仍按中文文案命中
  await expect(page.locator('[role="顶栏-资源-金"]')).toBeVisible();

  // 刷新后自动登录，界面仍按手动选择显示英文（localStorage slg-lang）
  await page.reload();
  await expect(page.locator('[role="侧栏-账号"]')).toContainText(username, { timeout: 15_000 });
  await expect(page.locator('[role="导航-总览"]')).toContainText('Overview');

  // 账号菜单切回中文立即生效
  await page.locator('[role="侧栏-账号按钮"]').click();
  await page.locator('[role="账号菜单-语言-zh"]').click();
  await expect(page.locator('[role="导航-总览"]')).toContainText('总览');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
});
