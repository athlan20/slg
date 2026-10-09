// 聊天卡片（AISLG-138）：坐标 / 城池点开在地图上查看；武将点开看发送那一刻的快照；战报点开看分享时的快照。
// 卡片内容全部来自服务端快照，这里只负责展示与点击动作。

import { useState } from 'react';
import { formatReportTime } from '../../api/format';
import type { ChatCardView } from '../../api/protocol-chat';
import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';
import { useBattleReportModal } from '../../state/battleReportModal';
import { battleKindTitle } from '../BattleReportModal';
import { ChatHeroModal } from './ChatHeroModal';
import { terrainText, tileKindText } from './chatText';
import { useMapJump } from './useMapJump';

export const CHAT_CARD_CLASS =
  'flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded border border-line bg-panel-2 px-2 py-1 text-left text-[12px] hover:border-accent-dim disabled:cursor-default';

export function ChatCardBlock({ messageId, card }: { messageId: number; card: ChatCardView }) {
  const { CHAT_COPY } = useCopy();
  const { session } = useGame();
  const jump = useMapJump();
  const reportModal = useBattleReportModal();
  const [heroOpen, setHeroOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (card.kind === 'coord') {
    return (
      <button type="button" role="聊天卡片-坐标" onClick={() => jump(card.x, card.y)} className={CHAT_CARD_CLASS}>
        <b className="font-semibold text-accent">{CHAT_COPY.card.coordTitle}</b>
        <span className="font-mono">
          ({card.x}, {card.y})
        </span>
        <span className="text-dim">{CHAT_COPY.card.coordTile(terrainText(card.terrain), tileKindText(card.tileKind), card.level)}</span>
        <em className="ml-auto not-italic text-faint">{CHAT_COPY.card.jump}</em>
      </button>
    );
  }

  if (card.kind === 'city') {
    return (
      <button type="button" role="聊天卡片-城池" onClick={() => jump(card.x, card.y)} className={CHAT_CARD_CLASS}>
        <b className="font-semibold text-accent">{CHAT_COPY.card.cityTitle}</b>
        <span className="min-w-0 truncate font-semibold">{card.name}</span>
        <span className="text-dim">{CHAT_COPY.card.cityOwner(card.ownerName)}</span>
        <span className="text-dim">{CHAT_COPY.card.cityLevel(card.level)}</span>
        <span className="font-mono text-faint">
          ({card.x}, {card.y})
        </span>
        <em className="ml-auto not-italic text-faint">{CHAT_COPY.card.jump}</em>
      </button>
    );
  }

  if (card.kind === 'hero') {
    return (
      <>
        <button type="button" role="聊天卡片-武将" onClick={() => setHeroOpen(true)} className={CHAT_CARD_CLASS}>
          <b className="font-semibold">{card.name}</b>
          {card.famous ? (
            <span className="rounded border border-gold px-1 text-[10.5px] text-gold">{CHAT_COPY.card.heroTag}</span>
          ) : null}
          <span className="font-mono text-accent">{CHAT_COPY.card.heroLevel(card.level)}</span>
          <span className="font-mono text-dim">{CHAT_COPY.card.heroStats(card.lead, card.force, card.wit)}</span>
        </button>
        {heroOpen ? <ChatHeroModal card={card} onClose={() => setHeroOpen(false)} /> : null}
      </>
    );
  }

  const openReport = async () => {
    setBusy(true);
    setError(null);
    const report = await session.chat.openReport(messageId);
    setBusy(false);
    if (!report) {
      setError(CHAT_COPY.card.reportLoadFailed);
      return;
    }
    // 别人分享的战报：只读展示，不再给「分享」入口
    reportModal.openBattleReport({ ...report, comment: null }, { shareable: false });
  };
  return (
    <button type="button" role="聊天卡片-战报" disabled={busy} onClick={() => void openReport()} className={CHAT_CARD_CLASS}>
      <b className="font-semibold text-accent">{CHAT_COPY.card.reportTitle}</b>
      <span>{battleKindTitle(card.battleKind)}</span>
      <span className="min-w-0 truncate">
        {card.attackerName} {CHAT_COPY.card.reportVersus} {card.defenderName}
      </span>
      <span className={card.won ? 'text-gold' : 'text-warn'}>{card.won ? CHAT_COPY.card.reportWon : CHAT_COPY.card.reportLost}</span>
      <span className="font-mono text-faint">{formatReportTime(card.reportedAt)}</span>
      <em className="ml-auto not-italic text-faint">{error ?? CHAT_COPY.card.reportOpen}</em>
    </button>
  );
}
