// 微信扫码登录 / 绑定微信 / Agent 令牌的浏览器端到端（docs/wechat-qr-login.md「测试」）：
// 真实页面 + 真实 API 进程（harness 另起一个，微信接口换成假服务），测试代码扮演手机上的小游戏连接。
// 页面经 localStorage `slg.wsUrl` 连到 harness 的 API（仅非生产站点生效）。

import { expect, test, type Page } from '@playwright/test';
import { Op, startHarness, type Client, type Harness } from '../wechat/harness';
import { loginViaForm, uniqueUsername } from './helpers';

const API_PORT = 18091;
const RUN_ID = Date.now().toString(36);
let codeSeq = 0;
/** 同名 = 同一个微信用户；带运行标记，避免串到库里上一轮留下的绑定 */
const wxCode = (who: string): string => `wxuser-${who}${RUN_ID}-${++codeSeq}`;

let harness: Harness;

test.beforeAll(async () => {
  harness = await startHarness({ apiPort: API_PORT, ticketTtlSeconds: 120 });
});

test.afterAll(() => harness?.stop());

async function pointPageAtHarness(page: Page): Promise<void> {
  await page.addInitScript((url) => window.localStorage.setItem('slg.wsUrl', url), harness.wsUrl);
}

/** 等页面生成出新的二维码（假微信记下 scene），返回 ticket */
async function nextTicket(page: Page, before: number): Promise<string> {
  await expect(page.locator('[role="微信二维码-图片"]')).toBeVisible();
  await expect.poll(() => harness.scenes.length).toBeGreaterThan(before);
  return harness.scenes[harness.scenes.length - 1];
}

/** 手机端扫码并停在确认页（返回仍连着的小游戏连接） */
async function phoneScan(ticket: string, who: string): Promise<Client> {
  const phone = await harness.connect();
  const scanned = await phone.call(Op.WX_SCAN, { ticket, code: wxCode(who) });
  expect(scanned.ok, JSON.stringify(scanned)).toBe(true);
  return phone;
}

async function openSettings(page: Page): Promise<void> {
  await page.locator('[role="侧栏-账号按钮"]').click();
  await page.locator('[role="账号菜单-账号设置"]').click();
  await expect(page.locator('[role="账号设置弹窗"]')).toBeVisible();
}

test('微信扫码登录：显示二维码 → 手机扫码确认 → 页面自动登录；再次扫同一微信登录同一账号', async ({ page }) => {
  await pointPageAtHarness(page);
  await page.goto('/');
  await page.locator('[role="账号面板-分页-微信扫码"]').click();
  await expect(page.locator('[role="账号面板-微信扫码"]')).toBeVisible();

  const ticket = await nextTicket(page, 0);
  await expect(page.locator('[role="微信二维码-状态"]')).toContainText('微信扫一扫');
  await expect(page.locator('[role="微信二维码-倒计时"]')).toBeVisible();

  const phone = await phoneScan(ticket, 'pw1');
  await expect(page.locator('[role="微信二维码-状态"]')).toContainText('已扫码');
  expect((await phone.call(Op.WX_CONFIRM, { ticket })).ok).toBe(true);

  await expect(page.locator('[role="顶栏-本人在线状态"]')).toHaveAttribute('title', '本人：在线');
  const name = (await page.locator('[role="侧栏-账号"]').innerText()).trim();
  expect(name).toMatch(/^wx_[0-9a-z]{6}$/);

  // 同一个微信再扫：登录的是同一个账号
  await page.locator('[role="侧栏-账号按钮"]').click();
  await page.locator('[role="账号菜单-切换账号"]').click();
  await page.locator('[role="切换账号-确认按钮"]').click();
  await page.locator('[role="账号面板-分页-微信扫码"]').click();
  const before = harness.scenes.length;
  const second = await nextTicket(page, before);
  const phone2 = await harness.connect();
  const scanned = await phone2.call(Op.WX_SCAN, { ticket: second, code: wxCode('pw1') });
  expect((scanned.data as { accountName: string }).accountName).toBe(name);
  await phone2.call(Op.WX_CONFIRM, { ticket: second });
  await expect(page.locator('[role="侧栏-账号"]')).toHaveText(name);
});

test('手机取消 → 页面自动换一张新码；换到「用户名密码」分页时登录表单仍可用', async ({ page }) => {
  await pointPageAtHarness(page);
  await page.goto('/');
  await page.locator('[role="账号面板-分页-微信扫码"]').click();
  const ticket = await nextTicket(page, harness.scenes.length);
  const count = harness.scenes.length;
  const phone = await phoneScan(ticket, 'pw2');
  await phone.call(Op.WX_CANCEL, { ticket });
  await expect.poll(() => harness.scenes.length).toBe(count + 1);
  await expect(page.locator('[role="微信二维码-图片"]')).toBeVisible();

  await page.locator('[role="账号面板-分页-用户名密码"]').click();
  await expect(page.locator('[role="账号面板-登录表单"]')).toBeVisible();
  await expect(page.locator('[role="账号面板-微信扫码"]')).toHaveCount(0);
});

test('账号设置：Agent 令牌签发（明文只显示一次）→ Agent 登录 → 吊销后 Agent 被断开', async ({ page }) => {
  await pointPageAtHarness(page);
  const username = uniqueUsername('wxtok');
  await loginViaForm(page, username);
  await openSettings(page);

  await expect(page.locator('[role="账号设置-绑定微信-状态"]')).toContainText('尚未绑定');
  await expect(page.locator('[role="账号设置-Agent令牌-列表"]')).toContainText('还没有签发过令牌');

  await page.locator('[role="账号设置-Agent令牌-名称输入"]').fill('指挥官');
  await page.locator('[role="账号设置-Agent令牌-生成按钮"]').click();
  const dialog = page.locator('[role="Agent令牌弹窗"]');
  await expect(dialog).toBeVisible();
  const token = await dialog.locator('[role="Agent令牌弹窗-令牌"]').inputValue();
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await dialog.locator('[role="Agent令牌弹窗-复制按钮"]').click();
  await expect(dialog.locator('[role="Agent令牌弹窗-复制结果"]')).toBeVisible();
  await dialog.locator('[role="Agent令牌弹窗-完成按钮"]').click();
  await expect(dialog).toHaveCount(0);

  const item = page.locator('[role="账号设置-Agent令牌-条目"]');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('指挥官');
  await expect(item).toContainText('尚未使用');
  expect(await page.locator('[role="账号设置弹窗"]').innerText()).not.toContain(token);

  // Agent 用令牌登录（同一账号）
  const agent = await harness.connect();
  const login = await agent.call(Op.LOGIN, { token, asAgent: true });
  expect(login.ok, JSON.stringify(login)).toBe(true);
  expect(login.data?.username).toBe(username);

  await item.locator('[role="账号设置-Agent令牌-吊销按钮"]').click();
  await expect(item).toHaveCount(0);
  await expect(page.locator('[role="账号设置-Agent令牌-列表"]')).toContainText('还没有签发过令牌');
  expect(await agent.waitClose()).toBe(4003);
  const retry = await harness.connect();
  expect((await retry.call(Op.LOGIN, { token, asAgent: true })).error?.code).toBe('SESSION_INVALID');
});

test('账号设置：老账号绑定微信（弹出 bind 码 → 手机确认 → 状态变已绑定）', async ({ page }) => {
  await pointPageAtHarness(page);
  const username = uniqueUsername('wxbind');
  await loginViaForm(page, username);
  await openSettings(page);

  const block = page.locator('[role="账号设置-绑定微信"]');
  await expect(block.locator('[role="账号设置-绑定微信-状态"]')).toContainText('尚未绑定');
  const before = harness.scenes.length;
  await block.locator('[role="账号设置-绑定微信-开始按钮"]').click();
  const ticket = await nextTicket(page, before);

  const phone = await harness.connect();
  const scanned = await phone.call(Op.WX_SCAN, { ticket, code: wxCode('pw3') });
  expect((scanned.data as { purpose: string; accountName: string }).purpose).toBe('bind');
  expect((scanned.data as { accountName: string }).accountName).toBe(username);
  await expect(block.locator('[role="微信二维码-状态"]')).toContainText('已扫码');
  expect((await phone.call(Op.WX_CONFIRM, { ticket })).ok).toBe(true);

  await expect(block.locator('[role="账号设置-绑定微信-状态"]')).toContainText('已绑定微信');
  await expect(block.locator('[role="账号设置-绑定微信-开始按钮"]')).toHaveCount(0);

  // 刷新页面后绑定状态仍在（来自服务端 GET_AGENT_INFO）
  await page.reload();
  await expect(page.locator('[role="侧栏-账号"]')).toContainText(username);
  await openSettings(page);
  await expect(page.locator('[role="账号设置-绑定微信-状态"]')).toContainText('已绑定微信');
});
