// 收起条（AISLG-138）：底栏最左一小段（侧栏右侧，不挡侧栏底部的账号按钮）。显示聊天图标、未读数与世界频道最新一条
// （截断）；1024–1279 宽时只留图标与未读数。点击展开 / 收起浮窗。

import { messagePreview } from './chatText';
import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';

export function ChatChip() {
  const { CHAT_COPY } = useCopy();
  const { session } = useGame();
  const { chat } = session;
  const online = session.connection === 'online';
  const latest = chat.latestWorld;
  return (
    <button
      type="button"
      role="聊天-收起条"
      disabled={!online}
      aria-expanded={chat.open}
      title={chat.open ? CHAT_COPY.launcher.collapse : CHAT_COPY.launcher.open}
      onClick={() => chat.setOpen(!chat.open)}
      className="flex min-w-0 max-w-[420px] shrink-0 cursor-pointer items-center gap-2 rounded border border-line bg-panel-2 px-2 py-0.5 text-left text-[11.5px] hover:border-accent-dim disabled:cursor-default disabled:opacity-60 max-xl:max-w-[150px]"
    >
      <span role="聊天-收起条-图标" className="grid h-[20px] w-[20px] shrink-0 place-items-center rounded border border-line text-[11px] font-semibold text-accent">
        {CHAT_COPY.launcher.label.slice(0, 1)}
      </span>
      {chat.unreadTotal > 0 ? (
        <i
          role="聊天-收起条-未读"
          title={CHAT_COPY.launcher.unread(chat.unreadTotal)}
          className="min-w-[16px] shrink-0 rounded-full bg-st-error px-1 text-center text-[10px] not-italic text-bg"
        >
          {chat.unreadTotal > 99 ? '99+' : chat.unreadTotal}
        </i>
      ) : null}
      <span role="聊天-收起条-最新" className="min-w-0 truncate text-dim max-xl:hidden">
        {latest ? `${latest.sender.username}：${messagePreview(latest)}` : CHAT_COPY.launcher.emptyWorld}
      </span>
    </button>
  );
}
