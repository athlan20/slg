// 礼金的对外文档（v89，AISLG-221）：GET_STATE 的账号级字段。接入 protocol-doc-ops.ts 的 REQUEST_GET_STATE.dataFields。
import { SEASON_GIFT } from './gift';

export const GIFT_STATE_FIELDS = [
  {
    name: 'gift',
    type: 'number',
    desc: `（v89，AISLG-221）账号礼金当前余额（账号级，不分城）。每个赛季开始固定发 ${SEASON_GIFT}（登录时惰性发放，同赛季不重复发），换季清零；不能转让、赠送、兑换成金币或任何资源。只用于服务端标明的便利功能，扣除时事件流写 gift_spent（detail = { reason, amount, balance }）。`,
  },
  {
    name: 'giftSeasonGrant',
    type: 'number',
    desc: `（v89）每个赛季每个账号发放的礼金额度（当前为 ${SEASON_GIFT}）。界面与 Agent 用它显示“礼金 gift / giftSeasonGrant”，不要写死数值。`,
  },
];
