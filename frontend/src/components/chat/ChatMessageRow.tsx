// 一条聊天消息（AISLG-138）：发送人（点开：私聊 / 屏蔽）、时间、私聊的对方、文字（表情在文字里）或卡片。

import { useState } from 'react';
import { formatReportTime } from '../../api/format';
import type { ChatMessageView } from '../../api/protocol-chat';
import { useGame } from '../../state/GameContext';
import { ChatCardBlock } from './ChatCardBlock';
import { ChatPlayerMenu } from './ChatPlayerMenu';
import { chatLength, isEmojiOnly } from './chatText';

export function ChatMessageRow({ message }: { message: ChatMessageView }) {
  const { session } = useGame();
  const [menuOpen, setMenuOpen] = useState(false);
  const mine = message.sender.accountId === session.account?.accountId;
  const senderBlocked = session.chat.blocked.some((item) => item.accountId === message.sender.accountId);
  // 只有 1–3 个表情、没有别的字：显示得大一些，接近以前单独发表情的样子
  const emojiOnly = message.text !== null && chatLength(message.text) <= 3 && isEmojiOnly(message.text);

  return (
    <div role="聊天-消息" className="flex min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 items-baseline gap-1.5 text-[11.5px]">
        {mine ? (
          <span className="min-w-0 truncate font-semibold text-accent">{message.sender.username}</span>
        ) : (
          <button
            type="button"
            role="聊天-消息-发送人"
            onClick={() => setMenuOpen((open) => !open)}
            className="min-w-0 cursor-pointer truncate font-semibold text-dim hover:text-accent"
          >
            {message.sender.username}
          </button>
        )}
        {message.recipient ? <span className="min-w-0 truncate text-faint">→ {message.recipient.username}</span> : null}
        <span className="ml-auto shrink-0 font-mono text-faint">{formatReportTime(message.createdAt)}</span>
      </div>
      {menuOpen && !mine ? (
        <ChatPlayerMenu peer={message.sender} blocked={senderBlocked} onClose={() => setMenuOpen(false)} />
      ) : null}
      {message.text ? (
        <p role="聊天-消息-文字" className={emojiOnly ? 'text-[26px] leading-tight' : 'break-words text-[13px] leading-snug'}>
          {message.text}
        </p>
      ) : null}
      {message.card ? <ChatCardBlock messageId={message.id} card={message.card} /> : null}
    </div>
  );
}
