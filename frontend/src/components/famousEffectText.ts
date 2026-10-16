// 名城独有效果的一行说明（v62，AISLG-166）：按种类套文案；野地产出的资源名取自 RESOURCE_LABEL。
// 文案包（中 / 英）同形，调用方传入对应语言的 famous.effect 即可。

import type { FamousEffectView } from '../api/protocol';
import type { CITY_COPY } from '../copy-cities';

export type FamousEffectCopy = typeof CITY_COPY.famous.effect;

export function famousEffectText(effect: FamousEffectView, copy: FamousEffectCopy, resourceLabel: Record<string, string>): string {
  switch (effect.kind) {
    case 'wall':
      return copy.wall(effect.percent);
    case 'tower':
      return copy.tower(effect.percent);
    case 'march':
      return copy.march(effect.percent);
    case 'warehouse':
      return copy.warehouse(effect.percent);
    case 'territory':
      return copy.territory(effect.percent, (effect.resources ?? []).map((key) => resourceLabel[key] ?? key).join(copy.joiner));
  }
}
