// 聊天里的武将卡片详情（AISLG-138）：内容是发送那一刻的快照，不随武将之后的变化更新。

import type { ChatCardView } from '../../api/protocol-chat';
import { useCopy } from '../../i18n/bundle';
import { Modal } from '../ui/Modal';

type HeroCardView = Extract<ChatCardView, { kind: 'hero' }>;

export function ChatHeroModal({ card, onClose }: { card: HeroCardView; onClose: () => void }) {
  const { CHAT_COPY } = useCopy();
  return (
    <Modal
      role="聊天武将弹窗"
      title={`${CHAT_COPY.card.heroDetailTitle} · ${card.name}`}
      size="sm"
      accent={card.famous ? 'gold' : 'accent'}
      onClose={onClose}
    >
      <div className="flex flex-col gap-1.5 text-[13px]">
        <p className="flex items-center gap-2">
          <b className="text-[15px] font-semibold">{card.name}</b>
          {card.famous ? (
            <span className="rounded border border-gold px-1 text-[11px] text-gold">{CHAT_COPY.card.heroTag}</span>
          ) : null}
          <span className="font-mono text-accent">{CHAT_COPY.card.heroLevel(card.level)}</span>
        </p>
        <p className="font-mono text-dim">{CHAT_COPY.card.heroStats(card.lead, card.force, card.wit)}</p>
        <p className="text-[11.5px] text-faint">{CHAT_COPY.card.heroDetailNote}</p>
      </div>
    </Modal>
  );
}
