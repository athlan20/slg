// 断粮哗变的对外文档（PUSH_STARVATION_STATE，v34，AISLG-107）。规则数值引用 starvation.ts 的真实常量。

import { Op } from './protocol';
import type { PushOpDoc } from './protocol-doc';
import { CITY_ID, STARTED_AT } from './protocol-doc-shared';
import { MUTINY_INTERVAL_HOURS, MUTINY_LOSS_PERCENT, STARVE_WARNING_LEAD_HOURS } from './starvation';

const START_MS = Date.parse(STARTED_AT);

export const PUSH_STARVATION_STATE: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_STARVATION_STATE',
  title: '推送：断粮预警 / 断粮哗变（v34，AISLG-107）',
  summary: `城池粮食为 0 且净产量为负（粮毛产量 < 全军耗粮，在外部队按 ×2 计入）即「断粮」：此后每过 ${MUTINY_INTERVAL_HOURS} 小时（随全局时间缩放）该城**城内驻军每个兵种减少 ${MUTINY_LOSS_PERCENT}%**（向上取整、至少 1 个；没有逃兵系统，减少的直接损失），粮食恢复为正或净产量转正即停止。**在外部队（行军中 / 驻守野地）不强制召回**，它们的耗粮照常计入，所以出征多会加速断粮。预计断粮时间随 CityView.starveAt 下发（不会断粮为 null；已断粮 = 当前时刻），下一次哗变时刻见 CityView.mutinyNextAt；距断粮不足 ${STARVE_WARNING_LEAD_HOURS} 小时（缩放后）推送一次预警，每次哗变推送一条并写 mutiny 事件，推给该账号的全部在线连接（含 Agent）。分城各算各的（各城各自的粮食 / 驻军）。离线期间照常结算，GET_OFFLINE_REPORT 的 mutinyLost 统计哗变损兵。数值均为占位，上线后按数据调整；此规则取代 v14「断粮仅停止增长、部队不解散」的旧口径。`,
  dataFields: [
    { name: 'reason', type: "'warning' | 'mutiny'", desc: 'warning = 断粮预警；mutiny = 一次哗变已发生（城内驻军已减员）。' },
    { name: 'cityId / cityName', type: 'string', desc: '受影响的城池。' },
    { name: 'starveAt', type: 'string', desc: '仅 warning：预计断粮时刻（ISO 8601；已断粮即当前时刻）。' },
    { name: 'foodNetPerHour', type: 'number', desc: '仅 warning：粮净产量（粮毛产量 − 全军耗粮，每小时，已按时间缩放；负数表示净消耗）。' },
    { name: 'losses', type: 'object', desc: '仅 mutiny：各兵种本次减员 { 兵种: 数量 }（仅非零项）。' },
    { name: 'total', type: 'number', desc: '仅 mutiny：本次减员总数。' },
    { name: 'nextAt', type: 'string', desc: '仅 mutiny：下一次哗变时刻（粮食仍断着则再次触发）。' },
  ],
  examples: [
    { op: Op.PUSH_STARVATION_STATE, push: true, data: { reason: 'warning', cityId: CITY_ID, cityName: '主城', starveAt: new Date(START_MS + 1_800_000).toISOString(), foodNetPerHour: -420 } },
    { op: Op.PUSH_STARVATION_STATE, push: true, data: { reason: 'mutiny', cityId: CITY_ID, cityName: '主城', losses: { militia: 5, archer: 1 }, total: 6, nextAt: new Date(START_MS + 3_600_000).toISOString() } },
  ],
  agentNote: '收到 warning 应立刻止损：粮只能靠产量补（建造 / 升级农田、占领产粮野地），或降低耗粮——让在外部队回城（在外部队按 ×2 计耗粮）、减少驻军。mutiny 说明已经损兵，粮食恢复前每小时继续减。离线前务必检查 CityView.starveAt：离线一晚断粮会损失过半兵力（10%/小时，约 6.6 小时减半）。',
};
