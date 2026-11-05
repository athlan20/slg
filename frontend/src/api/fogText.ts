// 战争迷雾事件与播报的文案拼装（AISLG-227，v93）：遗迹领取结果、名城 / 名将处所首探、传说遗迹播报。
// 文案按界面语言取用（getCopy），与 mapping-world.ts 的其他拼装函数同一约定。
import type { EventView } from './protocol';
import { getCopy } from '../i18n/bundle';
import { tName } from '../i18n/names';

/** 遗迹 / 首探事件的文案；不属于这些类型时返回 null */
export function fogEventText(view: EventView): string | null {
  const { EXTRA_STATE, EXTRA_MAP } = getCopy();
  const F = EXTRA_MAP.fog;
  const detail = view.detail as Record<string, unknown>;
  const pos = `(${String(detail.x ?? '?')}, ${String(detail.y ?? '?')})`;
  switch (view.type) {
    case 'relic_claimed': {
      if (detail.outcome === 'claimed') {
        return EXTRA_STATE.event.relicClaimed(F.relicKind[String(detail.kind)] ?? String(detail.kind), pos);
      }
      if (detail.outcome === 'limit') {
        return EXTRA_STATE.event.relicLimit(pos);
      }
      return EXTRA_STATE.event.relicTaken(pos);
    }
    case 'famous_first_explored':
      return EXTRA_STATE.event.famousFirst(String(detail.name ?? ''));
    case 'hero_site_first_explored':
      return EXTRA_STATE.event.heroSiteFirst(
        F.siteName[String(detail.name)] ?? String(detail.name ?? ''),
        tName(String(detail.hero ?? '')),
        detail.unlocked === true,
      );
    default:
      return null;
  }
}

/** 全服播报文案（必达、不带坐标）；不属于这些类型时返回 null */
export function fogBroadcastText(view: { type: string; detail: Record<string, unknown> }): string | null {
  const { EXTRA_STATE, EXTRA_MAP } = getCopy();
  const F = EXTRA_MAP.fog;
  const actor = String(view.detail.username ?? EXTRA_STATE.mapping.unknownPlayer);
  switch (view.type) {
    case 'famous_first_explored':
      return EXTRA_STATE.broadcast.famousFirst(actor, String(view.detail.name ?? ''));
    case 'hero_site_first_explored':
      return EXTRA_STATE.broadcast.heroSiteFirst(actor, F.siteName[String(view.detail.name)] ?? String(view.detail.name ?? ''), tName(String(view.detail.hero ?? '')));
    case 'legendary_relic_claimed':
      return EXTRA_STATE.broadcast.legendaryRelic(actor, F.relicKind[String(view.detail.kind)] ?? String(view.detail.kind ?? ''));
    default:
      return null;
  }
}
