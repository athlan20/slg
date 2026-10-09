// 私聊会话列表（AISLG-138）：按最后一条消息倒序，每个对方显示最后一句与未读角标；底部可展开屏蔽名单。

import { useState } from 'react';
import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';
import { PagedList } from '../ui/PagedList';
import { messagePreview } from './chatText';

const ROW_CLASS = 'flex w-full min-w-0 cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-[12.5px] hover:bg-panel-2';

export function ChatConversations() {
  const { CHAT_COPY } = useCopy();
  const { session } = useGame();
  const { chat } = session;
  const [showBlocked, setShowBlocked] = useState(false);

  return (
    <div role="聊天-私聊会话" className="flex min-h-0 flex-1 flex-col gap-1">
      <PagedList
        role="聊天-私聊会话-列表"
        items={chat.conversations}
        keyOf={(item) => item.peer.accountId}
        empty={<p className="py-6 text-center text-[12px] leading-relaxed text-faint">{CHAT_COPY.conversations.empty}</p>}
        renderRow={(item) => (
          <button type="button" role="聊天-私聊会话-项" className={ROW_CLASS} onClick={() => chat.openPrivate(item.peer)}>
            <span className="max-w-[7rem] shrink-0 truncate font-semibold">{item.peer.username}</span>
            <span className="min-w-0 flex-1 truncate text-dim">{messagePreview(item.last)}</span>
            {item.unread > 0 ? (
              <i
                role="聊天-私聊会话-未读"
                title={CHAT_COPY.conversations.unread(item.unread)}
                className="min-w-[18px] shrink-0 rounded-full bg-st-error px-1 text-center text-[10.5px] not-italic text-bg"
              >
                {item.unread > 99 ? '99+' : item.unread}
              </i>
            ) : null}
          </button>
        )}
      />
      <div role="聊天-私聊会话-屏蔽区" className="flex shrink-0 flex-col gap-1 border-t border-line-soft pt-1">
        <button
          type="button"
          role="聊天-私聊会话-屏蔽名单按钮"
          aria-expanded={showBlocked}
          onClick={() => setShowBlocked((value) => !value)}
          className="flex cursor-pointer items-center gap-1 text-left text-[11.5px] text-faint hover:text-dim"
        >
          {showBlocked ? '▾' : '▸'} {CHAT_COPY.conversations.blockedTitle} ({chat.blocked.length})
        </button>
        {showBlocked ? (
          chat.blocked.length === 0 ? (
            <p className="text-[11.5px] text-faint">{CHAT_COPY.conversations.blockedEmpty}</p>
          ) : (
            <PagedList
              role="聊天-私聊会话-屏蔽列表"
              items={chat.blocked}
              keyOf={(item) => item.accountId}
              renderRow={(item) => (
                <div role="聊天-私聊会话-屏蔽项" className="flex min-w-0 items-center gap-2 px-2 py-0.5 text-[12px]">
                  <span className="min-w-0 flex-1 truncate">{item.username}</span>
                  <button
                    type="button"
                    role="聊天-私聊会话-取消屏蔽"
                    onClick={() => void chat.setBlocked(item.accountId, false)}
                    className="shrink-0 cursor-pointer rounded border border-line px-1.5 text-[11px] text-dim hover:border-accent hover:text-accent"
                  >
                    {CHAT_COPY.conversations.unblock}
                  </button>
                </div>
              )}
            />
          )
        ) : null}
      </div>
    </div>
  );
}
