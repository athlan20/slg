// 地图选中格的聊天操作（AISLG-138）：分享坐标（任何格）；分享自己的城池；与别人城池的主人私聊。

import type { TileDetailView } from '../../api/protocol';
import { useCopy } from '../../i18n/bundle';
import { tName } from '../../i18n/names';
import { useGame } from '../../state/GameContext';
import { ChatShareButton } from '../chat/ChatShareButton';
import { cityShareLabel, coordShareLabel } from '../chat/chatText';

export function TargetChatActions({ x, y, detail, accountId }: { x: number; y: number; detail: TileDetailView | null; accountId: string | null }) {
  const { CHAT_COPY } = useCopy();
  const { session } = useGame();
  const { chat } = session;
  const owner = detail?.owner ?? null;
  const ownCity = detail?.kind === 'city' && owner !== null && owner.accountId === accountId;
  const otherCity = detail?.kind === 'city' && owner !== null && owner.accountId !== accountId;
  return (
    <div role="选中详情-聊天操作" className="flex shrink-0 flex-wrap gap-1">
      <ChatShareButton
        role="选中详情-分享坐标"
        label={CHAT_COPY.share.coord}
        onClick={() => chat.shareDraft({ card: { kind: 'coord', x, y }, label: coordShareLabel(x, y) })}
      />
      {ownCity && owner ? (
        <ChatShareButton
          role="选中详情-分享城池"
          label={CHAT_COPY.share.city}
          onClick={() =>
            chat.shareDraft({
              card: { kind: 'city', cityId: owner.cityId },
              label: cityShareLabel(tName(owner.cityName), x, y),
            })
          }
        />
      ) : null}
      {otherCity && owner ? (
        <ChatShareButton
          role="选中详情-私聊"
          label={CHAT_COPY.share.dm}
          onClick={() => chat.openPrivate({ accountId: owner.accountId, username: owner.username })}
        />
      ) : null}
    </div>
  );
}
