// 宽屏临界布局验收（AISLG-265）：标准布局的下限从 1280 降到 1240。
// 1260 是「1280 的屏幕扣掉浏览器滚动条和侧边栏」后的真实宽度，必须和 1280 以上享受同一套完整布局：
//   1. 侧栏 176px（不是 60px 图标栏），赛季胶囊用长写法，顶栏资源格的离满仓百分比在；
//   2. 军队 / 情报 / Agent 三页都是三栏，第三块（领地 / 行军 / 日报）都在；
//   3. 养成页是三栏两行的网格，不是分段条；
//   4. 地图页右栏 360px；底栏全服播报在；
//   5. 顶栏没有横向溢出（六格资源 + 赛季 + 剧本战场 + 警报 + 集市 / 榜仍是一行）。
// 1240 是标准布局的下边界（同样按上面几条查一遍）；1239 仍是紧凑布局（回归保护）：
// 60px 图标栏、三栏页变两栏、养成页分段条、地图右栏 320px、底栏播报隐藏。
// 只断言几何关系与可见性，不截图比对，避免不同机器的字体渲染差异。

import { expect, test, type Page } from '@playwright/test';
import { loginViaForm, uniqueUsername } from './helpers';

/** 标准布局（≥ 1240）：1260×720 是典型笔记本，1240×720 是边界 */
const STANDARD = [
  { width: 1260, height: 720 },
  { width: 1240, height: 720 },
];
/** 标准布局下的侧栏宽度（shell.css 的 grid-template-columns 第一列） */
const SIDEBAR_WIDE = 176;
/** 紧凑布局（1024–1239）的图标栏宽度 */
const SIDEBAR_COMPACT = 60;
/** 地图页右栏：标准布局 360，紧凑布局 320 */
const MAP_PANEL_WIDE = 360;
const MAP_PANEL_COMPACT = 320;

async function gotoHash(page: Page, key: string): Promise<void> {
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, key);
}

/** 量一个元素的盒子宽度（取整，避免亚像素差异） */
async function widthOf(page: Page, role: string): Promise<number> {
  const box = await page.locator(`[role="${role}"]`).boundingBox();
  expect(box, `[role="${role}"] 应可见`).not.toBeNull();
  return Math.round(box?.width ?? 0);
}

/** 数页面网格的列数：`.work` 是 display:grid 时返回轨道数，改成 flex（分段条）时返回 0 */
async function gridColumns(page: Page, role: string): Promise<number> {
  const template = await page.locator(`[role="${role}"]`).evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  return template === 'none' ? 0 : template.split(' ').filter(Boolean).length;
}

/** 顶栏资源格里可见的「离满仓百分比」（max-xl 隐藏）有几个 */
async function visiblePercents(page: Page): Promise<number> {
  return page.locator('[role="顶栏-资源"] span').evaluateAll(
    (els) => els.filter((el) => /%$/.test((el.textContent ?? '').trim()) && el.getBoundingClientRect().width > 0).length,
  );
}

/** 三个三栏页的第三块（紧凑布局时由 hide-md 隐藏） */
const THIRD_BLOCKS: Array<[hash: string, role: string, gridRole: string, name: string]> = [
  ['army', '左列-领地列表', '军队页', '领地'],
  ['intel', '情报页-行军', '情报页', '行军'],
  ['agent', 'Agent页-离线日报', 'Agent页', '日报'],
];

for (const size of STANDARD) {
  test(`${size.width}×${size.height}：标准布局（侧栏 176、三栏页三块都在、养成页不分段、地图右栏 360）`, async ({ page }) => {
    await page.setViewportSize(size);
    await loginViaForm(page, uniqueUsername('e2e-wide'));
    await expect(page.locator('[role="顶栏-资源"]')).toBeVisible();
    const at = `${size.width}×${size.height}`;

    // 侧栏是完整侧栏（文字都在），不是 60px 图标栏
    expect(await widthOf(page, '导航-侧栏'), `${at} 侧栏宽应为 ${SIDEBAR_WIDE}px`).toBe(SIDEBAR_WIDE);
    await expect(page.locator('[role="导航-养成"] span.nav-label-full'), `${at} 侧栏应显示导航文字`).toBeVisible();
    // 赛季胶囊长写法 + 资源格的离满仓百分比（都是 max-xl 才隐藏的东西）
    await expect(page.locator('[role="导航-赛季倒计时"] span').first(), `${at} 赛季胶囊应为长写法`).toBeVisible();
    expect(await visiblePercents(page), `${at} 六格资源应显示离满仓百分比`).toBeGreaterThanOrEqual(5);
    // 顶栏一行放得下，没有横向溢出，也没换行（高度仍是 52 / 矮屏 46）
    const topbar = page.locator('[role="导航-顶栏"]');
    const bleed = await topbar.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(bleed, `${at} 顶栏不应横向溢出`).toBeLessThanOrEqual(1);
    const topHeight = Math.round((await topbar.boundingBox())?.height ?? 0);
    expect([46, 52], `${at} 顶栏应保持单行高度（46 / 52）`).toContain(topHeight);

    // 军队 / 情报 / Agent：三栏，第三块都在
    for (const [hash, thirdRole, gridRole, name] of THIRD_BLOCKS) {
      await gotoHash(page, hash);
      await expect(page.locator(`[role="${thirdRole}"]`), `${at} ${name}块应可见`).toBeVisible();
      expect(await gridColumns(page, gridRole), `${at} ${gridRole}应是三栏`).toBe(3);
    }

    // 养成页：三栏两行，不是分段条
    await gotoHash(page, 'growth');
    await expect(page.locator('[role="养成页-分段条"]'), `${at} 养成页不应出现分段条`).toBeHidden();
    expect(await gridColumns(page, '养成页'), `${at} 养成页应是三栏网格`).toBe(3);
    for (const role of ['养成页-竞技场', '任务面板', '科技面板']) {
      await expect(page.locator(`[role="${role}"]`), `${at} ${role} 应可见`).toBeVisible();
    }

    // 地图页：右栏 360px（紧凑布局才是 320）
    await gotoHash(page, 'map');
    await expect(page.locator('[role="世界地图视野-地块"]').first()).toBeVisible();
    expect(await widthOf(page, '地图页-军情'), `${at} 地图右栏应为 ${MAP_PANEL_WIDE}px`).toBe(MAP_PANEL_WIDE);

    // 底栏：全服播报在（max-xl 隐藏）
    await expect(page.locator('[role="导航-全服播报"]'), `${at} 底栏全服播报应可见`).toBeVisible();
  });
}

test('1239×720：仍是紧凑布局（60px 图标栏、三栏页两栏、养成页分段条、地图右栏 320）', async ({ page }) => {
  await page.setViewportSize({ width: 1239, height: 720 });
  await loginViaForm(page, uniqueUsername('e2e-wide-compact'));
  await expect(page.locator('[role="顶栏-资源"]')).toBeVisible();
  const at = '1239×720';

  expect(await widthOf(page, '导航-侧栏'), `${at} 侧栏宽应为 ${SIDEBAR_COMPACT}px`).toBe(SIDEBAR_COMPACT);
  await expect(page.locator('[role="导航-赛季倒计时"] span').last(), `${at} 赛季胶囊应为短写法`).toBeVisible();
  expect(await visiblePercents(page), `${at} 资源格的离满仓百分比应隐藏`).toBe(0);

  for (const [hash, thirdRole, gridRole, name] of THIRD_BLOCKS) {
    await gotoHash(page, hash);
    await expect(page.locator(`[role="${thirdRole}"]`), `${at} ${name}块应隐藏`).toBeHidden();
    expect(await gridColumns(page, gridRole), `${at} ${gridRole}应是两栏`).toBe(2);
  }

  await gotoHash(page, 'growth');
  await expect(page.locator('[role="养成页-分段条"]'), `${at} 养成页应是分段条`).toBeVisible();
  expect(await gridColumns(page, '养成页'), `${at} 养成页不应是网格`).toBe(0);

  await gotoHash(page, 'map');
  await expect(page.locator('[role="世界地图视野-地块"]').first()).toBeVisible();
  expect(await widthOf(page, '地图页-军情'), `${at} 地图右栏应为 ${MAP_PANEL_COMPACT}px`).toBe(MAP_PANEL_COMPACT);

  await expect(page.locator('[role="导航-全服播报"]'), `${at} 底栏全服播报应隐藏`).toBeHidden();
});