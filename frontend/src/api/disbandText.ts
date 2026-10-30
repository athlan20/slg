// 遣散相关的人读拼装（v84，AISLG-209）：兵种清单与返还资源清单。
// 表单预览、确认弹窗与本地事件文案共用，保证三处文字一致；数字来源见 api/protocol 的
// disbandRefundPreview（与服务端 disbandRefund 同一公式）。

import { TROOP_KINDS, type Resources, type TroopKind } from './protocol';
import { getCopy } from '../i18n/bundle';

/** 返还资源的展示顺序（需求口径：金 / 木 / 粮 / 铁 / 石），零值也列出，便于核对公式 */
const REFUND_ORDER: ReadonlyArray<keyof Resources> = ['gold', 'wood', 'food', 'iron', 'stone'];

/** 「金 3,000 / 木 1,600 / 粮 2,000 / 铁 1,000 / 石 0」 */
export function disbandRefundText(refunded: Partial<Resources> | null | undefined): string {
  const { RESOURCE_LABEL } = getCopy();
  return REFUND_ORDER.map((key) => `${RESOURCE_LABEL[key]} ${(refunded?.[key] ?? 0).toLocaleString('en-US')}`).join(' / ');
}

/** 「长枪兵 ×40 / 民夫 ×20」 */
export function disbandTroopsText(disbanded: Partial<Record<TroopKind, number>> | null | undefined): string {
  const { TROOP_LABEL } = getCopy();
  const parts: string[] = [];
  for (const kind of TROOP_KINDS) {
    const count = Math.floor(disbanded?.[kind] ?? 0);
    if (count > 0) {
      parts.push(`${TROOP_LABEL[kind].name} ×${count}`);
    }
  }
  return parts.join(' / ');
}

/** 只保留数量大于 0 的兵种（请求与事件都用这个形状） */
export function nonZeroTroops(troops: Partial<Record<TroopKind, number>>): Partial<Record<TroopKind, number>> {
  const out: Partial<Record<TroopKind, number>> = {};
  for (const kind of TROOP_KINDS) {
    const count = Math.floor(troops[kind] ?? 0);
    if (count > 0) {
      out[kind] = count;
    }
  }
  return out;
}
