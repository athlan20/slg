// 礼金（AISLG-221，v89）：账号级货币，新游戏没有充值，便利功能（第一个是 AISLG-222 道具商店的迁城令）用它限量。
// 规则：每个赛季开始固定发 SEASON_GIFT（发放用“置为”而不是“加上”，同赛季重复触发不会多发）；换季清零；
// 不能转让、赠送、进交易所、兑换成金币或任何资源；除每季发放外没有其他来源，所以余额恒在 0 ~ SEASON_GIFT。
// 本文件只放常量与纯规则；存取（发放、清零、扣除）在 gift-db.ts，发放的三个入口分别在 auth.ts、season-db.ts、gift-schema.ts。

/** 每个赛季每个账号的礼金额度（用户拍板，2026-11-04；额度连同用途一起复核，不自动提高） */
export const SEASON_GIFT = 1000;

/** 扣除失败的错误码（余额不足时返回，余额与其他数据都不变） */
export const INSUFFICIENT_GIFT = 'INSUFFICIENT_GIFT' as const;
