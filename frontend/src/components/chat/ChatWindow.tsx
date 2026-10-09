// 聊天浮窗（AISLG-138，v51）：桌面端从左下角浮起、盖在工作区上（不挤压页面布局，约 360 × 480，矮屏自动缩小）；
// 手机端（< 1024）全屏。头部三个页签（世界 / 系统播报 / 私聊，私聊带未读数）与收起按钮；Esc 收起。

import { useEffect } from 'react';
import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';
import { isModalOpen } from '../ui/Modal';
import type { ChatTab } from '../../state/useChat';
import { ChatComposer } from './ChatComposer';
import { ChatConversations } from './ChatConversations';
import { ChatSystemPane, ChatThreadPane, ChatWorldPane } from './ChatPanes';

const TABS: readonly ChatTab[] = ['world', 'system', 'private'];
/** 页签的 role 取静态中文名（role 定位值不随界面语言变，见 AGENTS 前端规范） */
const TAB_ROLE: Record<ChatTab, string> = { world: '世界', system: '系统播报', private: '私聊' };

export function ChatWindow() {
  const { CHAT_COPY } = useCopy();
  const { session } = useGame();
  const { chat } = session;
  const { open, setOpen } = chat;
  // Esc 收起：挂在 window 上，焦点在哪里都生效（点了发送按钮、焦点丢到 body 之后也一样）；
  // 有弹窗开着时不收起，让弹窗先关
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isModalOpen()) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);
  if (!open) {
    return null;
  }
  const online = session.connection === 'online';
  const composerShown = chat.tab === 'world' || (chat.tab === 'private' && chat.peer !== null);

  return (
    <section
      role="聊天浮窗"
      className="fixed bottom-14 left-[192px] z-40 flex h-[min(480px,calc(100dvh-120px))] w-[360px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-panel border border-line bg-panel shadow-2xl max-xl:left-[76px] max-lg:inset-0 max-lg:h-auto max-lg:w-auto max-lg:max-w-none max-lg:rounded-none"
    >
      <header role="聊天浮窗-标题栏" className="flex shrink-0 items-center gap-2 border-b border-line-soft px-2.5 py-1.5">
        <nav role="聊天浮窗-页签" className="flex min-w-0 flex-wrap gap-1">
          {TABS.map((item) => (
            <button
              key={item}
              type="button"
              role={`聊天浮窗-页签-${TAB_ROLE[item]}`}
              aria-pressed={chat.tab === item}
              onClick={() => chat.setTab(item)}
              className={`relative cursor-pointer rounded border px-2 py-0.5 text-[12px] ${
                chat.tab === item ? 'border-accent bg-accent-soft text-accent' : 'border-line text-dim hover:text-fg'
              }`}
            >
              {CHAT_COPY.tabs[item]}
              {item === 'private' && chat.unreadTotal > 0 ? (
                <i
                  role="聊天浮窗-页签-未读"
                  className="ml-1 rounded-full bg-st-error px-1 text-[10px] not-italic text-bg"
                >
                  {chat.unreadTotal > 99 ? '99+' : chat.unreadTotal}
                </i>
              ) : null}
            </button>
          ))}
        </nav>
        <button
          type="button"
          role="聊天浮窗-收起按钮"
          aria-label={CHAT_COPY.launcher.collapse}
          onClick={() => chat.setOpen(false)}
          className="ml-auto shrink-0 cursor-pointer rounded border border-line px-2 py-0.5 text-[12px] text-dim hover:text-accent"
        >
          {CHAT_COPY.launcher.collapse} ▾
        </button>
      </header>
      <div role="聊天浮窗-内容" className="flex min-h-0 flex-1 flex-col gap-1.5 px-2.5 py-2">
        {!online ? <p role="聊天浮窗-离线提示" className="text-[11.5px] text-warn">{CHAT_COPY.offline}</p> : null}
        {chat.error ? (
          <p role="聊天浮窗-错误" className="line-clamp-2 shrink-0 text-[11.5px] text-warn">
            {chat.error}
          </p>
        ) : null}
        {chat.tab === 'world' ? <ChatWorldPane /> : null}
        {chat.tab === 'system' ? <ChatSystemPane /> : null}
        {chat.tab === 'private' ? (chat.peer ? <ChatThreadPane /> : <ChatConversations />) : null}
      </div>
      {composerShown ? (
        <div role="聊天浮窗-输入" className="shrink-0 px-2.5 pb-2">
          <ChatComposer defaultChannel={chat.tab === 'private' ? 'private' : 'world'} />
        </div>
      ) : null}
    </section>
  );
}
