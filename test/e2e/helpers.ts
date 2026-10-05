// e2e 共用步骤：直连数据库预建测试账号（test/account-seed.ts，后端同一套建号逻辑），
// 再经登录表单完成玩家登录。
// 选择器全部走前端约定的 role 命名（见 AGENTS.md 前端规范），界面调整时同步此处。
// 导航重构后（docs/frontend-nav-layout.md）：账号入口在侧栏底部的账号菜单，建造在城池页，事件流在情报页。

import { expect, type Page } from '@playwright/test';
import { seedAccount } from '../account-seed';

export function uniqueUsername(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

export const E2E_PASSWORD = 'e2e-pass-123';

/** 先预建账号（v48 起密码通道不再自动注册），再走真实登录表单完成登录，并等待连接就绪 */
export async function loginViaForm(page: Page, username: string): Promise<void> {
  await seedAccount(username, E2E_PASSWORD);
  await page.goto('/');
  const form = page.locator('[role="账号面板-登录表单"]');
  await expect(form).toBeVisible();
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="password"]').fill(E2E_PASSWORD);
  await page.locator('[role="账号面板-登录按钮"]').click();
  // 顶栏只用状态灯表示在线（绿），文案在 title 上
  await expect(page.locator('[role="顶栏-本人在线状态"]')).toHaveAttribute('title', '本人：在线');
  await expect(page.locator('[role="侧栏-账号"]')).toContainText(username);
}

/** 切到某个页面（导航栏按钮，等价于 #hash）：page = overview / map / city / army / growth / intel / agent */
export async function gotoPage(page: Page, name: '总览' | '地图' | '城池' | '军队' | '养成' | '情报' | 'Agent'): Promise<void> {
  await page.locator(`[role="导航-${name}"]`).click();
  await expect(page.locator(`[role="导航-${name}"]`)).toHaveAttribute('aria-current', 'page');
}

/** 侧栏账号菜单切换账号：确认弹框 → 确认切换 → 回到登录表单（服务端已吊销令牌） */
export async function switchAccountToLoginForm(page: Page): Promise<void> {
  await page.locator('[role="侧栏-账号按钮"]').click();
  await page.locator('[role="账号菜单-切换账号"]').click();
  await expect(page.locator('[role="切换账号确认框"]')).toBeVisible();
  await page.locator('[role="切换账号-确认按钮"]').click();
  await expect(page.locator('[role="账号面板-登录表单"]')).toBeVisible();
}

/** 读取浏览器保存的会话令牌 */
export function storedToken(page: Page): Promise<string | null> {
  return page.evaluate(() => window.localStorage.getItem('slg.sessionToken'));
}
