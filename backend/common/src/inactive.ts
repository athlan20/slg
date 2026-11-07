// 长期不活跃账号的野地收回（v98，AISLG-238）的常量。单独成文件：rules.ts 已超过 500 行，不再往里加。

/**
 * 账号「不活跃」阈值（毫秒，**现实时间**，不乘 time_scale）：本人和 Agent 都 7 天没上线即视为弃坑，
 * Worker 每小时扫一轮，把名下野地全部收回（城不动、兵退回城、望楼毁掉）。
 * 跟盟主自动转让（ALLIANCE_LEADER_INACTIVE_MS，protocol-alliance.ts）是同一个 7 天阈值，
 * 两个用途各留一个常量：改阈值时两处一起看。
 */
export const INACTIVE_WILDERNESS_RECLAIM_MS = 7 * 24 * 3600 * 1000;
