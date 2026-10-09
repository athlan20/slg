// 聊天表情面板（AISLG-138）：内置一组常用 emoji。点一下插到输入框光标处，可以连续点；表情就是文字的一部分，不单独发。
// 面板按下时不抢焦点（阻止 mousedown 的默认行为），输入框的光标位置不会丢。

import { CHAT_EMOJIS } from './chatEmojis';

export function ChatEmojiPanel({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div
      role="聊天-表情面板"
      onMouseDown={(event) => event.preventDefault()}
      className="grid grid-cols-8 gap-1 rounded border border-line bg-panel-2 p-1.5"
    >
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
