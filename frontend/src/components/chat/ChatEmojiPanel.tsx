// 聊天表情面板（AISLG-138）：内置一组常用 emoji，点一下即作为表情消息发出（表情不与文字同发）。

import { CHAT_EMOJIS } from '../../api/protocol-chat';

export function ChatEmojiPanel({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div role="聊天-表情面板" className="grid grid-cols-8 gap-1 rounded border border-line bg-panel-2 p-1.5">
      {CHAT_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          role="聊天-表情面板-表情"
          onClick={() => onPick(emoji)}
          className="grid h-7 cursor-pointer place-items-center rounded text-[17px] hover:bg-panel"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
