// 聊天输入区（AISLG-138）：文字（最多 100 字，表情也算 1 个字）、表情（插到光标处，可以连续点）、插入（武将 / 战报 / 城池 / 坐标）
// 与卡片草稿。草稿来自分享入口或插入面板，附一句话后一起发出。表情就是文字的一部分，发出去的是纯文本。

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CHAT_TEXT_MAX_CHARS, type ChatChannel } from '../../api/protocol-chat';
import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';
import { ChatEmojiPanel } from './ChatEmojiPanel';
import { ChatInsertPanel } from './ChatInsertPanel';
import { chatLength } from './chatText';

/** 输入区：默认发到 defaultChannel（随页签），可在世界与当前私聊对象之间切换（分享后「选好发到哪个频道」） */
export function ChatComposer({ defaultChannel }: { defaultChannel: ChatChannel }) {
  const { CHAT_COPY } = useCopy();
  const { session } = useGame();
  const { chat } = session;
  const peer = chat.peer;
  const [channel, setChannel] = useState<ChatChannel>(defaultChannel);
  // 换页签或换私聊对象时回到默认频道（手动切换只在当前上下文里有效）
  useEffect(() => setChannel(defaultChannel), [defaultChannel, peer?.accountId]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<'emoji' | 'insert' | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** 插入表情后要恢复的光标位置：等新文字渲染进输入框后再设置 */
  const caretRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caretRef.current !== null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(caretRef.current, caretRef.current);
      caretRef.current = null;
    }
  }, [text]);
  const trimmed = text.trim();
  const length = chatLength(trimmed);
  const online = session.connection === 'online';
  const canSend = online && !busy && (trimmed.length > 0 || chat.draft !== null);

  const submit = async () => {
    if (!canSend) {
      return;
    }
    if (length > CHAT_TEXT_MAX_CHARS) {
      setError(CHAT_COPY.composer.limit(CHAT_TEXT_MAX_CHARS));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await chat.send({ channel, text: trimmed || undefined, card: chat.draft?.card });
    setBusy(false);
    if (result.ok) {
      setText('');
      chat.setDraft(null);
    } else {
      setError(result.message);
    }
  };

  /** 表情插到输入框光标处（输入框没有光标记录时插到末尾）；插入后光标落在表情后面，面板保持打开，可以连续点 */
  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    // 与字数计数、服务端一样按去掉首尾空白后计算
    if (chatLength(next.trim()) > CHAT_TEXT_MAX_CHARS) {
      setError(CHAT_COPY.composer.limit(CHAT_TEXT_MAX_CHARS));
      return;
    }
    setError(null);
    caretRef.current = start + emoji.length;
    setText(next);
  };

  return (
    <div role="聊天-输入区" className="relative flex shrink-0 flex-col gap-1 border-t border-line-soft pt-1.5">
      <div role="聊天-输入区-频道切换" className="flex min-w-0 items-center gap-1 text-[11px]">
        <button
          type="button"
          role="聊天-输入区-频道-世界"
          aria-pressed={channel === 'world'}
          onClick={() => setChannel('world')}
          className={`shrink-0 cursor-pointer rounded border px-1.5 py-0 ${channel === 'world' ? 'border-accent text-accent' : 'border-line text-dim hover:text-fg'}`}
        >
          {CHAT_COPY.composer.channelWorld}
        </button>
        {peer ? (
          <button
            type="button"
            role="聊天-输入区-频道-私聊"
            aria-pressed={channel === 'private'}
            onClick={() => setChannel('private')}
            className={`min-w-0 cursor-pointer truncate rounded border px-1.5 py-0 ${channel === 'private' ? 'border-accent text-accent' : 'border-line text-dim hover:text-fg'}`}
          >
            {CHAT_COPY.composer.channelPrivate(peer.username)}
          </button>
        ) : null}
      </div>
      {chat.draft ? (
        <div role="聊天-输入区-卡片草稿" className="flex min-w-0 items-center gap-1.5 text-[12px]">
          <span className="shrink-0 text-faint">{CHAT_COPY.composer.draftLabel}</span>
          <span className="min-w-0 truncate text-accent">{chat.draft.label}</span>
          <button
            type="button"
            role="聊天-输入区-移除卡片"
            aria-label={CHAT_COPY.composer.draftRemove}
            onClick={() => chat.setDraft(null)}
            className="shrink-0 cursor-pointer px-1 text-faint hover:text-warn"
          >
            ✕
          </button>
        </div>
      ) : null}
      <div className="flex min-w-0 items-center gap-1.5">
        <input
          ref={inputRef}
          type="text"
          role="聊天-输入区-文字"
          value={text}
          disabled={!online}
          placeholder={CHAT_COPY.composer.placeholder(CHAT_TEXT_MAX_CHARS)}
          onChange={(event) => {
            setError(null);
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              void submit();
            }
          }}
          className="min-w-0 flex-1 rounded border border-line bg-panel-2 px-2 py-1 text-[13px] outline-none focus:border-accent disabled:opacity-50"
        />
        <span role="聊天-输入区-字数" className={`shrink-0 font-mono text-[11px] max-md:hidden ${length > CHAT_TEXT_MAX_CHARS ? 'text-warn' : 'text-faint'}`}>
          {CHAT_COPY.composer.counter(length, CHAT_TEXT_MAX_CHARS)}
        </span>
        <button
          type="button"
          role="聊天-输入区-表情按钮"
          aria-label={CHAT_COPY.composer.emoji}
          disabled={!online}
          aria-pressed={panel === 'emoji'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setPanel(panel === 'emoji' ? null : 'emoji')}
          className="shrink-0 cursor-pointer rounded border border-line px-1.5 py-0.5 text-[13px] hover:border-accent-dim disabled:opacity-50"
        >
          😀
        </button>
        <button
          type="button"
          role="聊天-输入区-插入按钮"
          disabled={!online}
          aria-pressed={panel === 'insert'}
          onClick={() => setPanel(panel === 'insert' ? null : 'insert')}
          className="shrink-0 cursor-pointer rounded border border-line px-1.5 py-0.5 text-[12px] text-dim hover:border-accent-dim hover:text-accent disabled:opacity-50"
        >
          {CHAT_COPY.composer.insert}
        </button>
        <button
          type="button"
          role="聊天-输入区-发送按钮"
          disabled={!canSend}
          onClick={() => void submit()}
          className="shrink-0 cursor-pointer rounded border border-accent bg-accent-soft px-2.5 py-0.5 text-[12px] text-accent disabled:cursor-default disabled:border-line disabled:bg-transparent disabled:text-faint"
        >
          {busy ? CHAT_COPY.composer.sending : CHAT_COPY.composer.send}
        </button>
      </div>
      {panel === 'emoji' ? <ChatEmojiPanel onPick={insertEmoji} /> : null}
      {panel === 'insert' ? (
        <ChatInsertPanel
          onPick={(draft) => {
            chat.setDraft(draft);
            setPanel(null);
          }}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {error ? (
        <p role="聊天-输入区-错误" className="line-clamp-2 text-[11.5px] text-warn">
          {error}
        </p>
      ) : null}
    </div>
  );
}
