// 聊天浮窗的三个页签内容（AISLG-138）：世界频道（最新在下、可翻更早）、系统播报（只读，复用全服播报数据）、
// 私聊线程（顶部可返回会话列表）。

import { formatReportTime } from '../../api/format';
import { serverBroadcastText } from '../../api/mapping';
import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';
import { PagedList } from '../ui/PagedList';
import { ChatMessageList } from './ChatMessageList';
import { ChatMessageRow } from './ChatMessageRow';

export function ChatWorldPane() {
  const { CHAT_COPY } = useCopy();
  const { session } = useGame();
  const { chat } = session;
  return (
    <ChatMessageList
      role="聊天浮窗-世界消息"
      items={chat.world}
      keyOf={(item) => item.id}
      renderRow={(item) => <ChatMessageRow message={item} />}
      empty={<p className="py-6 text-center text-[12px] leading-relaxed text-faint">{CHAT_COPY.world.empty}</p>}
      hasMore={chat.worldHasMore}
      loading={chat.worldLoading}
      onLoadOlder={() => void chat.loadOlderWorld()}
    />
  );
}

export function ChatSystemPane() {
  const { CHAT_COPY } = useCopy();
  const { session } = useGame();
  return (
    <div role="聊天浮窗-系统播报" className="flex min-h-0 flex-1 flex-col gap-1">
      <p className="text-[11px] text-faint">{CHAT_COPY.system.readonly}</p>
      <PagedList
        role="聊天浮窗-系统播报-列表"
        items={session.broadcasts}
        keyOf={(item) => item.id}
        empty={<p className="py-6 text-center text-[12px] text-faint">{CHAT_COPY.system.empty}</p>}
        renderRow={(item) => (
          <p className="truncate border-b border-line-soft py-1 text-[12.5px] text-dim" title={serverBroadcastText(item)}>
            <span className="mr-1.5 font-mono text-[11px] text-faint">{formatReportTime(item.createdAt)}</span>
            {serverBroadcastText(item)}
          </p>
        )}
      />
    </div>
  );
}

export function ChatThreadPane() {
  const { CHAT_COPY } = useCopy();
  const { session } = useGame();
  const { chat } = session;
  const peer = chat.peer;
  if (!peer) {
    return null;
  }
  return (
    <div role="聊天浮窗-私聊线程" className="flex min-h-0 flex-1 flex-col gap-1">
      <div role="聊天浮窗-私聊线程-标题" className="flex min-w-0 items-center gap-2 text-[12.5px]">
        <button
          type="button"
          role="聊天浮窗-私聊线程-返回"
          aria-label={CHAT_COPY.thread.back}
          onClick={() => chat.leavePrivate()}
          className="shrink-0 cursor-pointer rounded border border-line px-1.5 py-0.5 text-dim hover:text-accent"
        >
          ‹
        </button>
        <span className="min-w-0 truncate font-semibold">{CHAT_COPY.thread.title(peer.username)}</span>
      </div>
      <ChatMessageList
        role="聊天浮窗-私聊消息"
        items={chat.thread}
        keyOf={(item) => item.id}
        renderRow={(item) => <ChatMessageRow message={item} />}
        empty={<p className="py-6 text-center text-[12px] leading-relaxed text-faint">{CHAT_COPY.thread.empty}</p>}
        hasMore={chat.threadHasMore}
        loading={chat.threadLoading}
        onLoadOlder={() => void chat.loadOlderThread()}
      />
    </div>
  );
}
