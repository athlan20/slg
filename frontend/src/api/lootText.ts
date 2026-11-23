// 战利品相关的事件文字（v118，AISLG-270）：因仓库满作废的资源与野地掠夺的收益倍数。
// 独立成文件（mapping-world.ts 已超过单文件行数提醒线），只做拼装；
// 文案取 PLUNDER_DAILY_COPY（按界面语言），数值全部来自服务端 detail。

import type { Resources } from './protocol';
import { getCopy } from '../i18n/bundle';

/** 资源清单（只列非零项，如「粮 200 / 木 50」；与 cargoText 同口径但避免反向依赖 mapping-world） */
function amounts(resources: Partial<Resources> | undefined): string {
  const { RESOURCE_LABEL } = getCopy();
  if (!resources) {
    return '';
  }
  const parts: string[] = [];
  for (const key of Object.keys(RESOURCE_LABEL) as Array<keyof Resources>) {
    const value = resources[key];
    if (typeof value === 'number' && value > 0) {
      parts.push(`${RESOURCE_LABEL[key]} ${value}`);
    }
  }
  return parts.join(' / ');
}

/** 因仓库满作废的资源后缀（detail.wasted）；没有作废时返回空串 */
export function lootWastedTail(detail: Record<string, unknown>): string {
  const text = amounts(detail.wasted as Partial<Resources> | undefined);
  return text === '' ? '' : getCopy().PLUNDER_DAILY_COPY.wastedTail(text);
}

/** 野地掠夺收益打折的后缀（detail.lootPercent < 100 才有；其余战斗为 100 / 缺省） */
export function lootPercentTail(detail: Record<string, unknown>): string {
  const percent = Number(detail.lootPercent ?? 100);
  return Number.isFinite(percent) && percent < 100 ? getCopy().PLUNDER_DAILY_COPY.percentTail(percent) : '';
}