// 聊天浮窗的页签内容（AISLG-138）：世界频道（最新在下、可翻更早）、联盟频道（AISLG-183，没有联盟时是引导）、
// 活动（v112，AISLG-260：只读，只显示活动 / 玩法节点播报）、系统播报（只读，只显示战况与其余大事）、
// 私聊线程（顶部可返回会话列表）。两份播报的拆分在会话层（state/session-extras.ts）完成。

import { formatReportTime } from '../../api/format';
import { serverBroadcastText } from '../../api/mapping';
import type { ServerBroadcastView } from '../../api/protocol-server';
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

export function ChatAlliancePane() {
  const { CHAT_COPY } = useCopy();
  const { session } = useGame();
  const { chat, alliance } = session;
  if (!chat.inAlliance) {
    // 没有联盟：页签不隐藏（让玩家知道有这个频道），给一句说明和去联盟面板的入口
    return (
      <div role="聊天浮窗-联盟-未加入" className="flex flex-1 flex-col items-center justify-center gap-2 px-2 text-center">
        <p className="text-[12.5px] leading-relaxed text-faint">{CHAT_COPY.alliance.noAlliance}</p>
        <button
          type="button"
          role="聊天浮窗-联盟-去联盟面板"
          onClick={() => alliance.openPanel()}
          className="btn px-2.5 py-0.5 text-[12px]"
        >
          {CHAT_COPY.alliance.openPanel}
        </button>
      </div>
    );
  }
  return (
    <ChatMessageList
      role="聊天浮窗-联盟消息"
      items={chat.alliance}
      keyOf={(item) => item.id}
      renderRow={(item) => <ChatMessageRow message={item} />}
      empty={<p className="py-6 text-center text-[12px] leading-relaxed text-faint">{CHAT_COPY.alliance.empty}</p>}
      hasMore={chat.allianceHasMore}
      loading={chat.allianceLoading}
      onLoadOlder={() => void chat.loadOlderAlliance()}
    />
  );
}

/** 只读的播报页签（活动 / 系统播报共用同一套列表样式）：时间 + 一句话 */
function ChatBroadcastPane(props: {
  role: string;
  broadcasts: ServerBroadcastView[];
  hint: string;
  empty: string;
}) {
  return (
    <div role={props.role} className="flex min-h-0 flex-1 flex-col gap-1">
      <p className="text-[11px] text-faint">{props.hint}</p>
      <PagedList
        role={`${props.role}-列表`}
        items={props.broadcasts}
        keyOf={(item) => item.id}
        empty={<p className="py-6 text-center text-[12px] text-faint">{props.empty}</p>}
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

/** 活动页签（v112）：剧本战场 / 洛阳 / 黄巾 / 五方势力 / 赛季等活动与玩法节点，只读 */
export function ChatEventPane() {
  const { CHAT_COPY } = useCopy();
  const { session } = useGame();
  return (
    <ChatBroadcastPane
      role="聊天浮窗-活动"
      broadcasts={session.eventBroadcasts}
      hint={CHAT_COPY.event.readonly}
      empty={CHAT_COPY.event.empty}
    />
  );
}

/** 系统播报页签：城被掠空、连胜、占领分城、名将获得、爵位晋升、公告等（活动类在活动页签） */
export function ChatSystemPane() {
  const { CHAT_COPY } = useCopy();
  const { session } = useGame();
  return (
    <ChatBroadcastPane
      role="聊天浮窗-系统播报"
      broadcasts={session.broadcasts}
      hint={CHAT_COPY.system.readonly}
      empty={CHAT_COPY.system.empty}
    />
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
