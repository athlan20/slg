// 联盟系统消息的一行（AISLG-183，F2）：没有发送人，居中小号灰字；文案由前端按 system 的种类拼接（后端不写死中文）。
// 标记种类名取 ALLIANCE_COPY.marks.kindLabel，与地图标记的图例、标记页签共用一套说法。

import type { ChatMessageView, ChatSystemView } from '../../api/protocol-chat';
import { useCopy } from '../../i18n/bundle';
import { formatReportTime } from '../../api/format';

export function ChatSystemRow({ message }: { message: ChatMessageView }) {
  const { CHAT_COPY, ALLIANCE_COPY } = useCopy();
  const text = systemText(message.system, CHAT_COPY.systemLine, ALLIANCE_COPY.marks.kindLabel);
  if (text === null) {
    return null;
  }
  return (
    <p role="聊天-系统消息" title={formatReportTime(message.createdAt)} className="break-words text-center text-[11px] leading-snug text-faint">
      {text}
    </p>
  );
}

type SystemLines = ReturnType<typeof useCopy>['CHAT_COPY']['systemLine'];
type MarkKindLabels = Record<string, string>;

/** 系统消息的展示句；未知种类返回 null（不渲染，避免出现空行） */
export function systemText(system: ChatSystemView | null, lines: SystemLines, kindLabel: MarkKindLabels): string | null {
  if (!system) {
    return null;
  }
  switch (system.kind) {
    case 'alliance_joined':
      return system.founder ? lines.founded(system.player.username) : lines.joined(system.player.username);
    case 'alliance_left':
      return lines.left(system.player.username);
    case 'alliance_kicked':
      return lines.kicked(system.player.username, system.by.username);
    case 'alliance_leader_changed':
      return system.reason === 'inactive'
        ? lines.leaderInactive(system.from.username, system.to.username)
        : lines.leaderTransfer(system.from.username, system.to.username);
    case 'alliance_mark_created':
      return lines.markCreated(system.player.username, kindLabel[system.markKind] ?? system.markKind, system.x, system.y);
    case 'alliance_diplomacy_friendly':
      return lines.diplomacyFriendly(system.player.username, system.otherAllianceName);
    case 'alliance_diplomacy_hostile':
      return lines.diplomacyHostile(system.player.username, system.otherAllianceName);
    case 'alliance_diplomacy_neutral':
      return lines.diplomacyNeutral(system.player.username, system.otherAllianceName);
    default:
      return null;
  }
}
