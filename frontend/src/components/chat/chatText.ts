// 聊天文字拼装（AISLG-138）：消息预览、卡片摘要与地块描述。文案取当前语言，函数体内取用（不在模块顶层）。

import type { ChatCardView, ChatMessageView } from '../../api/protocol-chat';
import type { BattleReportView, TerrainKind, TileKind } from '../../api/protocol-world';
import { getCopy } from '../../i18n/bundle';
import { battleKindTitle } from '../BattleReportModal';

/** 地块类别的界面名（玩家城 / NPC 城 / 野地） */
export function tileKindText(kind: TileKind): string {
  const { CHAT_COPY } = getCopy();
  if (kind === 'city') {
    return CHAT_COPY.card.tileCity;
  }
  return kind === 'npc_city' ? CHAT_COPY.card.tileNpc : CHAT_COPY.card.tileWild;
}

export function terrainText(terrain: TerrainKind): string {
  return getCopy().TERRAIN_LABEL[terrain];
}

/** 卡片的一行摘要（列表预览与收起条用） */
export function cardSummary(card: ChatCardView): string {
  const { CHAT_COPY } = getCopy();
  if (card.kind === 'coord') {
    return `${CHAT_COPY.card.coordTitle} (${card.x}, ${card.y})`;
  }
  if (card.kind === 'hero') {
    return `${CHAT_COPY.card.heroTag} ${card.name}`;
  }
  if (card.kind === 'report') {
    return `${CHAT_COPY.card.reportTitle} ${card.won ? CHAT_COPY.card.reportWon : CHAT_COPY.card.reportLost}`;
  }
  return `${CHAT_COPY.card.cityTitle} ${card.name}`;
}

/** 消息的一行预览：表情、文字（卡片附一句话时接在摘要后面） */
export function messagePreview(message: ChatMessageView): string {
  if (message.type === 'emoji' && message.emoji) {
    return message.emoji;
  }
  if (message.card) {
    return message.text ? `${cardSummary(message.card)} ${message.text}` : cardSummary(message.card);
  }
  return message.text ?? '';
}

/** 分享入口放进草稿时的预览文字（与服务端快照无关，只给输入框显示用） */
export function coordShareLabel(x: number, y: number): string {
  return `${getCopy().CHAT_COPY.card.coordTitle} (${x}, ${y})`;
}

export function cityShareLabel(name: string, x: number, y: number): string {
  return `${getCopy().CHAT_COPY.card.cityTitle} ${name} (${x}, ${y})`;
}

export function heroShareLabel(name: string, level: number): string {
  const { CHAT_COPY } = getCopy();
  return `${CHAT_COPY.card.heroTag} ${name} ${CHAT_COPY.card.heroLevel(level)}`;
}

export function reportShareLabel(report: { kind: BattleReportView['kind']; won: boolean }): string {
  const { CHAT_COPY } = getCopy();
  return `${battleKindTitle(report.kind)} · ${report.won ? CHAT_COPY.card.reportWon : CHAT_COPY.card.reportLost}`;
}
