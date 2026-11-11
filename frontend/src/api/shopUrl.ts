// 淘宝购买入口的链接（AISLG-255）：构建期环境变量 PUBLIC_TAOBAO_URL + 白名单校验。
// 链接不写死在仓库里（项目开源，商品地址与是否上架由运营决定）：本机在 develop/frontend/.env.local、
// 线上在各构建环境各配一份 PUBLIC_TAOBAO_URL=https://item.taobao.com/item.htm?id=xxx；
// 没配置、或配置的值不是合规的淘宝 / 天猫 https 链接，充值面板里就不显示这张卡片（想临时下架淘宝入口
// 只要去掉这个变量重新构建）。
//
// isSafeShopUrl 是纯函数（不读环境变量、不碰 DOM），逻辑如下：
// 通过（https + 主机名等于 taobao.com / tmall.com 或以 .taobao.com / .tmall.com 结尾）：
//   https://item.taobao.com/item.htm?id=1234567890&skuId=9876543210
//   https://taobao.com/x
//   https://www.tmall.com/item/1
//   https://detail.tmall.com/a/b
//   https://TAOBAO.com/x（主机名大小写不敏感）
// 拒绝：
//   http://item.taobao.com/item.htm?id=1（不是 https）
//   https://taobao.com.evil.com/x（域名不是 taobao.com 的子域）
//   https://evil-taobao.com/x（只是名字里带 taobao）
//   https://evil.com/?u=https://item.taobao.com（主机名是 evil.com）
//   https://user:pw@taobao.com/x（带用户信息的地址不渲染）
//   javascript:alert(1) / '' / null / undefined / 'not-a-url'（解析失败）
// 仓库前端目前没有测试框架，这几个例子就是这支函数的用例清单。

/** 允许的店铺域名（含子域名）：淘宝与天猫 */
const SHOP_HOSTS = ['taobao.com', 'tmall.com'] as const;

/** 构建期配置的淘宝商品链接（未配置 = 空串 = 不显示入口） */
export const TAOBAO_SHOP_URL = (import.meta.env.PUBLIC_TAOBAO_URL ?? '').trim();

export function isSafeShopUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') {
    return false;
  }
  // 带用户信息（user:pass@）的地址不渲染：链接来自构建环境，但也不给它钓鱼的机会
  if (parsed.username !== '' || parsed.password !== '') {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return SHOP_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}