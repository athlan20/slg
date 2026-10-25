// 联盟界面（AISLG-186 F1）：走一遍真实流程（建盟 → 申请 → 审批 → 邀请 → 公告 → 任副盟主 → 30 人分页），
// 再在四套皮肤 × 三种窗口宽度下，对「无联盟面板 / 无盟弹窗里的联盟详情 / 成员视角 / 盟主面板（含行内操作）/ 副盟主招募」
// 逐一跑 scanLayout：页面不竖向滚动、没有元素出现竖向滚动条、没有内容被裁在区块底边外。
// 依赖隔离联调栈（前端 28424、API 18080、临时库 slg_ui），所以只在 E2E_ALLIANCE=1 时运行，否则整组 skip。
// 运行：E2E_ALLIANCE=1 npx playwright test -c playwright.ally.config.ts

import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { databaseUrl, seedAccount } from '../account-seed';
import { E2E_PASSWORD, loginViaForm, uniqueUsername } from './helpers';

const requireFromBackend = createRequire(path.join(__dirname, '../../backend/package.json'));
const pg = requireFromBackend('pg') as typeof import('pg');

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:28424';
const SHOT_DIR = '/private/tmp/claude-501/-Users-mac-work-slg/dad2f398-e3ae-4a13-83c5-5a4a912fb603/scratchpad/ally-shots';

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1100, height: 800 },
  { width: 390, height: 844 },
];
const SKINS = ['night', 'crimson', 'gilded', 'paper'] as const;

interface Violation {
  kind: string;
  role: string;
  detail: string;
}

/** 与 layout-fit.spec.ts 的 scanLayout 同口径（复制一份，避免两个 spec 互相引用） */
async function scanLayout(page: Page): Promise<Violation[]> {
  return page.evaluate(() => {
    const out: Array<{ kind: string; role: string; detail: string }> = [];
    const roleOf = (el: Element): string => {
      let cur: Element | null = el;
      while (cur) {
        const role = cur.getAttribute('role');
        if (role) {
          return role;
        }
        cur = cur.parentElement;
      }
      return el.tagName.toLowerCase();
    };
    const doc = document.documentElement;
    if (doc.scrollHeight > window.innerHeight + 1) {
      out.push({ kind: '页面竖向滚动', role: 'html', detail: `scrollHeight ${doc.scrollHeight} > innerHeight ${window.innerHeight}` });
    }
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        continue;
      }
      const overflows = el.scrollHeight > el.clientHeight + 1;
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && overflows) {
        out.push({ kind: '出现竖向滚动条', role: roleOf(el), detail: `scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}` });
        continue;
      }
      const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip';
      const lineClamp = (style as CSSStyleDeclaration & { webkitLineClamp?: string }).webkitLineClamp;
      const clamped = lineClamp !== undefined && lineClamp !== 'none' && lineClamp !== '';
      if (clipsY && overflows && !clamped && el.clientHeight > 0) {
        out.push({ kind: '内容被裁在区块底边外', role: roleOf(el), detail: `scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}` });
      }
    }
    return out;
  });
}

async function expectFit(page: Page, label: string): Promise<void> {
  // 分页列表测高后会收敛一两帧：等布局稳定再扫
  await page.waitForTimeout(500);
  const violations = await scanLayout(page);
  expect(violations, `${label}\n${JSON.stringify(violations, null, 1)}`).toEqual([]);
}

// ---- 数据库：预设主城、灌成员（直连，与后端同库） ----

async function sql(text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const pool = new pg.Pool({ connectionString: databaseUrl() });
  try {
    const res = await pool.query(text, params);
    return res.rows as Record<string, unknown>[];
  } finally {
    await pool.end();
  }
}

/** 建盟门槛：主城官府 5 级、金币 50 万（创建联盟扣 10 万） */
async function presetMainCity(username: string): Promise<void> {
  await sql(`UPDATE cities SET gold = 500000 WHERE account_id = (SELECT id FROM accounts WHERE username = $1)`, [username]);
  await sql(
    `INSERT INTO city_buildings (city_id, kind, level) SELECT id, 'government', 5 FROM cities WHERE account_id = (SELECT id FROM accounts WHERE username = $1) ON CONFLICT (city_id, kind) DO UPDATE SET level = 5`,
    [username],
  );
}

/** 往联盟里灌普通成员（账号先预建）：用来把成员撑到上限 30 人，验证分页 */
async function padMembers(allianceId: string, prefix: string, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const name = `${prefix}${i}`;
    await seedAccount(name, E2E_PASSWORD);
    await sql(
      `INSERT INTO alliance_members (account_id, alliance_id, role) SELECT id, $2::uuid, 'member' FROM accounts WHERE username = $1 ON CONFLICT DO NOTHING`,
      [name, allianceId],
    );
  }
}

// ---- 页面步骤 ----

async function openAlliance(page: Page): Promise<void> {
  await page.locator('[role="导航-联盟"]').click();
  await expect(page.locator('[role="联盟弹窗"]')).toBeVisible();
}

async function closeAlliance(page: Page): Promise<void> {
  await page.locator('[role="联盟弹窗-关闭按钮"]').click();
  await expect(page.locator('[role="联盟弹窗"]')).toBeHidden();
}

/** 列表里找到某个联盟并点进去：翻客户端分页，不够再向服务端要更多 */
async function openDetailByName(page: Page, name: string): Promise<void> {
  const row = page.locator(`[role="联盟弹窗-列表条目"][title^="${name} ·"]`);
  for (let i = 0; i < 40; i += 1) {
    // 列表是异步拉的：先等一小段，避免在首屏还没回来时就判定“没有”
    await row.first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined);
    if ((await row.count()) > 0) {
      await row.first().click();
      await expect(page.locator('[role="联盟弹窗-详情-名称"]')).toHaveText(name);
      return;
    }
    const next = page.locator('[role="联盟弹窗-联盟列表-下一页"]');
    if ((await next.count()) > 0 && (await next.isEnabled())) {
      await next.click();
      continue;
    }
    const more = page.locator('[role="联盟弹窗-联盟列表-更早"]');
    if ((await more.count()) === 0) {
      break;
    }
    await more.click();
    await page.waitForTimeout(400);
  }
  throw new Error(`列表里找不到联盟 ${name}`);
}

function memberRow(page: Page, username: string) {
  return page.locator(`[role="联盟弹窗-成员行"]`, { has: page.locator(`b[title="${username}"]`) });
}

// ---- 测试 ----

test.describe('联盟界面布局与流程（E2E_ALLIANCE=1）', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(process.env.E2E_ALLIANCE !== '1', '需要隔离联调栈：设置 E2E_ALLIANCE=1 后运行');

  const suffix = String(Date.now()).slice(-5);
  const allianceName = `E${suffix}`;
  const notice = `e2e 公告 ${suffix}`;
  const names = {
    leader: uniqueUsername('ally_lead'),
    vice: uniqueUsername('ally_vice'),
    member: uniqueUsername('ally_mem'),
    free: uniqueUsername('ally_free'),
  };
  const padPrefix = uniqueUsername('ally_pad');
  let contexts: BrowserContext[] = [];
  let pages: Record<keyof typeof names, Page>;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    if (process.env.E2E_ALLIANCE !== '1') {
      return;
    }
    mkdirSync(SHOT_DIR, { recursive: true });
    // 四个账号各占一个独立浏览器上下文（localStorage 互不影响），整组测试复用同一批登录态
    // 主城门槛要在登录前写库：登录后的城池数据是那时拉的，之后才改库界面不会自动看到
    await seedAccount(names.leader, E2E_PASSWORD);
    await presetMainCity(names.leader);
    const created: Partial<Record<keyof typeof names, Page>> = {};
    contexts = [];
    for (const key of Object.keys(names) as Array<keyof typeof names>) {
      const ctx = await browser.newContext({ baseURL: BASE_URL, locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
      contexts.push(ctx);
      const page = await ctx.newPage();
      await loginViaForm(page, names[key]);
      created[key] = page;
    }
    pages = created as Record<keyof typeof names, Page>;
  });

  test.afterAll(async () => {
    for (const ctx of contexts) {
      await ctx.close();
    }
  });

  test('流程：建盟、申请、审批、邀请、公告、任副盟主、30 人分页', async () => {
    test.setTimeout(300_000);
    const { leader, vice, member, free } = pages;

    // 1. 盟主建盟（无联盟面板 → 创建页签）
    await expect(leader.locator('[role="顶栏-资源"]')).toBeVisible();
    await openAlliance(leader);
    await leader.locator('[role="联盟弹窗-页签-创建"]').click();
    await leader.locator('[role="联盟弹窗-创建-名称"]').fill(allianceName);
    await leader.locator('[role="联盟弹窗-创建-提交"]').click();
    await expect(leader.locator('[role="联盟弹窗-名称"]')).toHaveText(allianceName);
    await closeAlliance(leader);

    // 2. 副盟主（这里用 vice 账号先申请，之后再由盟主任命）申请入盟
    await expect(vice.locator('[role="顶栏-资源"]')).toBeVisible();
    await openAlliance(vice);
    await openDetailByName(vice, allianceName);
    await vice.locator('[role="联盟弹窗-申请加入"]').click();
    await expect(vice.locator('[role="联盟弹窗-撤回申请"]').first()).toBeVisible();
    await closeAlliance(vice);

    // 3. 盟主在招募页签同意申请
    await openAlliance(leader);
    await leader.locator('[role="联盟弹窗-页签-招募"]').click();
    const request = leader.locator('[role="联盟弹窗-申请条目"]', { hasText: names.vice });
    await expect(request).toHaveCount(1);
    await request.locator('[role="联盟弹窗-申请-同意"]').click();
    await expect(request).toHaveCount(0);

    // 4. 盟主邀请第三个账号（member），member 在收到的邀请里接受；free 始终不入盟（无盟视角）
    await leader.locator('[role="联盟弹窗-邀请-昵称"]').fill(names.member);
    await leader.locator('[role="联盟弹窗-邀请-提交"]').click();
    await expect(leader.locator('[role="联盟弹窗-已发邀请条目"]', { hasText: names.member })).toHaveCount(1);
    await closeAlliance(leader);

    await openAlliance(member);
    await expect(member.locator('[role="联盟弹窗-邀请条目"]').first()).toBeVisible();
    await member.locator('[role="联盟弹窗-邀请-接受"]').first().click();
    await expect(member.locator('[role="联盟弹窗-名称"]')).toHaveText(allianceName);
    await closeAlliance(member);

    // 5. 副盟主确认已入盟（成员视角）
    await openAlliance(vice);
    await expect(memberRow(vice, names.vice)).toHaveCount(1);
    await closeAlliance(vice);

    // 6. 盟主改公告
    await openAlliance(leader);
    await leader.locator('[role="联盟弹窗-公告-编辑"]').click();
    await leader.locator('[role="联盟弹窗-公告-输入"]').fill(notice);
    await leader.locator('[role="联盟弹窗-公告-保存"]').click();
    await expect(leader.locator('[role="联盟弹窗-公告-正文"]')).toHaveText(notice);

    // 7. 盟主任命副盟主（行内操作：展开 → 任命 → 确认）
    await leader.locator(`[role="联盟弹窗-成员操作-${names.vice}"]`).click();
    await leader.locator(`[role="联盟弹窗-任命副盟主-${names.vice}"]`).click();
    await leader.locator(`[role="联盟弹窗-任命副盟主-${names.vice}-确认"]`).click();
    await expect(memberRow(leader, names.vice)).toContainText('副盟主');
    await closeAlliance(leader);

    // 8. 压力：灌到 30 人上限，成员列表应分页（多页、可翻页）
    const [{ id: allianceId }] = await sql(`SELECT id FROM alliances WHERE name = $1`, [allianceName]);
    await padMembers(allianceId as string, padPrefix, 30 - 3);
    await openAlliance(leader);
    const pager = leader.locator('[role="联盟弹窗-成员列表-分页器"]');
    await expect(pager).toContainText('/');
    await leader.locator('[role="联盟弹窗-成员列表-下一页"]').click();
    await expect(leader.locator('[role="联盟弹窗-成员行"]').first()).toBeVisible();
    await closeAlliance(leader);
  });

  test('四套皮肤 × 三种宽度：各面板零布局违规', async () => {
    test.setTimeout(900_000);
    const { leader, vice, member, free } = pages;

    for (const size of SIZES) {
      for (const page of [leader, vice, member, free]) {
        await page.setViewportSize(size);
      }
      for (const skin of SKINS) {
        const tag = `${skin} ${size.width}×${size.height}`;
        for (const page of [leader, vice, member, free]) {
          // 皮肤只写 <html data-theme>（与 applyTheme 同口径）
          await page.evaluate((id) => document.documentElement.setAttribute('data-theme', id), skin);
        }

        // 无联盟：列表页签、创建页签、列表点进的详情（弹窗里打开联盟详情）
        await openAlliance(free);
        await expectFit(free, `${tag} 无联盟-列表`);
        await openDetailByName(free, allianceName);
        await expectFit(free, `${tag} 无联盟-详情`);
        await free.locator('[role="联盟弹窗-返回列表"]').click();
        await free.locator('[role="联盟弹窗-页签-创建"]').click();
        await expectFit(free, `${tag} 无联盟-创建`);
        await closeAlliance(free);

        // 成员视角（普通成员）
        await openAlliance(member);
        await expectFit(member, `${tag} 成员视角-成员`);
        await closeAlliance(member);

        // 盟主：成员页签，展开一行的行内操作；招募页签
        await openAlliance(leader);
        await expectFit(leader, `${tag} 盟主-成员`);
        await leader.locator(`[role="联盟弹窗-成员操作-${names.vice}"]`).click();
        await expectFit(leader, `${tag} 盟主-成员-展开行内操作`);
        await leader.locator('[role="联盟弹窗-页签-招募"]').click();
        await expectFit(leader, `${tag} 盟主-招募`);
        await closeAlliance(leader);

        // 副盟主：招募页签（副盟主可见，成员与招募）
        await openAlliance(vice);
        await vice.locator('[role="联盟弹窗-页签-招募"]').click();
        await expectFit(vice, `${tag} 副盟主-招募`);
        await closeAlliance(vice);

        // 截图：每个宽度挑一张代表性的（皮肤 × 宽度写进文件名）
        if (skin === 'night' && size.width === 1440) {
          await openAlliance(leader);
          await leader.locator(`[role="联盟弹窗-成员操作-${names.vice}"]`).click();
          await leader.waitForTimeout(400);
          await leader.screenshot({ path: path.join(SHOT_DIR, `ally-${skin}-${size.width}x${size.height}-leader-members.png`) });
          await closeAlliance(leader);
        }
        if (skin === 'crimson' && size.width === 1100) {
          await openAlliance(free);
          await free.waitForTimeout(400);
          await free.screenshot({ path: path.join(SHOT_DIR, `ally-${skin}-${size.width}x${size.height}-free-list.png`) });
          await closeAlliance(free);
        }
        if (skin === 'gilded' && size.width === 1440) {
          await openAlliance(vice);
          await vice.locator('[role="联盟弹窗-页签-招募"]').click();
          await vice.waitForTimeout(400);
          await vice.screenshot({ path: path.join(SHOT_DIR, `ally-${skin}-${size.width}x${size.height}-vice-recruit.png`) });
          await closeAlliance(vice);
        }
        if (skin === 'paper' && size.width === 390) {
          await openAlliance(leader);
          await leader.locator(`[role="联盟弹窗-成员操作-${names.vice}"]`).click();
          await leader.waitForTimeout(400);
          await leader.screenshot({ path: path.join(SHOT_DIR, `ally-${skin}-${size.width}x${size.height}-leader-members-expanded.png`) });
          await closeAlliance(leader);
        }
      }
    }
  });

  test('收尾：踢人、退出、解散（冷却提示）', async () => {
    test.setTimeout(300_000);
    const { leader, vice, member, free } = pages;

    // 盟主踢普通成员 member（二次确认）
    await openAlliance(leader);
    await leader.locator(`[role="联盟弹窗-成员操作-${names.member}"]`).click();
    await leader.locator(`[role="联盟弹窗-踢出-${names.member}"]`).click();
    await leader.locator(`[role="联盟弹窗-踢出-${names.member}-确认"]`).click();
    await expect(memberRow(leader, names.member)).toHaveCount(0);
    await closeAlliance(leader);

    // 被踢者进入冷却：无盟面板顶部显示冷却条
    await openAlliance(member);
    await expect(member.locator('[role="联盟弹窗-冷却"]')).toBeVisible();
    await closeAlliance(member);

    // 副盟主退出（确认）
    await openAlliance(vice);
    await vice.locator('[role="联盟弹窗-退出"]').click();
    await vice.locator('[role="联盟弹窗-退出-确认"]').click();
    await expect(vice.locator('[role="联盟弹窗-页签-列表"]')).toBeVisible();
    await closeAlliance(vice);

    // 盟主解散（确认）
    await openAlliance(leader);
    await leader.locator('[role="联盟弹窗-解散"]').click();
    await leader.locator('[role="联盟弹窗-解散-确认"]').click();
    await expect(leader.locator('[role="联盟弹窗-页签-创建"]')).toBeVisible();
    await closeAlliance(leader);
  });
});
