// 聊天里点玩家名字弹出的小菜单（AISLG-138）：私聊 / 屏蔽或取消屏蔽。
// 用固定定位的小弹窗而不是行内展开：消息列表按高度分页、溢出即裁切，行内菜单会被裁掉（点不到）。

import { useState } from 'react';
import type { ChatPlayerView } from '../../api/protocol-chat';
import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';
import { Modal } from '../ui/Modal';

export function ChatPlayerMenu({ peer, blocked, onClose }: { peer: ChatPlayerView; blocked: boolean; onClose: () => void }) {
  const { CHAT_COPY } = useCopy();
  const { session } = useGame();
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal role="聊天-玩家菜单" title={peer.username} size="sm" accent="none" onClose={onClose}>
      <div className="flex flex-col gap-2 text-[13px]">
        <button
          type="button"
          role="聊天-玩家菜单-私聊"
          onClick={() => {
            session.chat.openPrivate(peer);
            onClose();
          }}
          className="w-full cursor-pointer rounded border border-line px-3 py-1.5 text-left text-dim hover:border-accent hover:text-accent"
        >
          {CHAT_COPY.player.chat}
        </button>
        <button
          type="button"
          role="聊天-玩家菜单-屏蔽"
          onClick={async () => {
            const message = await session.chat.setBlocked(peer.accountId, !blocked);
            if (message) {
              setError(message);
              return;
            }
            onClose();
          }}
          className="w-full cursor-pointer rounded border border-line px-3 py-1.5 text-left text-dim hover:border-warn hover:text-warn"
        >
          {blocked ? CHAT_COPY.player.unblock : CHAT_COPY.player.block}
        </button>
        {error ? (
          <p role="聊天-玩家菜单-错误" className="text-[12px] text-warn">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
