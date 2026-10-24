// 有联盟时「成员」页签（AISLG-186 F1）：公告（盟主 / 副盟主可编辑）与成员列表（PagedList 分页）。
// 每行只显示名字、职位、官府、领地、在线状态；点行末「操作」选中该成员，操作条放在列表上方（shrink-0）。
// 不把操作直接展开在行内：行变高时 PagedList 不会重新测高，会裁掉内容；列表容器自身高度变化才会触发重新分页。
// 权限口径（服务端为准，界面只按同一规则隐藏）：盟主可任免副盟主、转让、踢任何人；副盟主只能踢普通成员；成员没有操作。
// AllianceFooter 是弹窗底部固定的「退出 / 解散」，不随列表变化。

import { useState } from 'react';
import type { AllianceMemberView, AllianceRole, GetAllianceResponseData } from '../../api/protocol';
import { ALLIANCE_MAX_VICES, ALLIANCE_NOTICE_MAX_CHARS } from '../../api/protocol';
import { useCopy } from '../../i18n/bundle';
import type { AllianceSession } from '../../state/allianceSession';
import { isAllianceManager } from '../../state/allianceSession';
import { PagedList } from '../ui/PagedList';
import { ActivityText, glyphCount, INPUT_CLASS, InlineConfirm, RoleTag } from './allianceParts';

interface AllianceMemberPanelProps {
  alliance: AllianceSession;
  state: GetAllianceResponseData;
  myId: string | null;
}

/** 职位排序：盟主在前，副盟主其次，同职位按入盟先后 */
const ROLE_ORDER: Record<AllianceRole, number> = { leader: 0, vice: 1, member: 2 };

export function AllianceMemberPanel({ alliance, state, myId }: AllianceMemberPanelProps) {
  const { ALLIANCE_COPY: COPY } = useCopy();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const view = state.alliance;
  if (!view) {
    return null;
  }
  const myRole = state.myRole;
  const manager = isAllianceManager(myRole);
  const viceCount = view.members.filter((member) => member.role === 'vice').length;
  const members = [...view.members].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.joinedAt.localeCompare(b.joinedAt));
  const selected = members.find((member) => member.accountId === selectedId) ?? null;
  const selectedActions = selected ? memberActions(selected, myId, myRole) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <NoticeBlock alliance={alliance} notice={view.notice} editable={manager} />
      {selected && selectedActions ? (
        <MemberActionBar
          alliance={alliance}
          member={selected}
          actions={selectedActions}
          viceFull={viceCount >= ALLIANCE_MAX_VICES}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
      <section className="flex min-h-0 flex-1 flex-col">
        <h4 className="pb-1 text-[12px] text-faint">{COPY.detail.members}</h4>
        <PagedList
          role="联盟弹窗-成员列表"
          items={members}
          keyOf={(member) => member.accountId}
          gap={2}
          gapClass="gap-0.5"
          renderRow={(member) => (
            <MemberRow
              member={member}
              me={member.accountId === myId}
              hasActions={memberActions(member, myId, myRole).any}
              selected={member.accountId === selectedId}
              onToggle={() => setSelectedId((cur) => (cur === member.accountId ? null : member.accountId))}
            />
          )}
        />
      </section>
    </div>
  );
}

/** 我能对这个成员做什么：盟主对除自己外的所有人；副盟主只对普通成员踢人；成员没有 */
function memberActions(member: AllianceMemberView, myId: string | null, myRole: AllianceRole | null) {
  const me = member.accountId === myId;
  const isLeader = myRole === 'leader';
  const isVice = myRole === 'vice';
  const canKick = !me && (isLeader || (isVice && member.role === 'member'));
  const canTransfer = !me && isLeader;
  const canSetVice = !me && isLeader && member.role !== 'leader';
  return { canKick, canTransfer, canSetVice, any: canKick || canTransfer || canSetVice };
}

function NoticeBlock({ alliance, notice, editable }: { alliance: AllianceSession; notice: string; editable: boolean }) {
  const { ALLIANCE_COPY: COPY } = useCopy();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notice);
  const trimmed = draft.trim();
  const length = glyphCount(trimmed);
  const tooLong = length > ALLIANCE_NOTICE_MAX_CHARS;

  if (!editing) {
    return (
      <section role="联盟弹窗-公告" className="flex shrink-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <h4 className="text-[12px] text-faint">{COPY.notice.label}</h4>
          {editable ? (
            <button
              type="button"
              role="联盟弹窗-公告-编辑"
              onClick={() => {
                setDraft(notice);
                setEditing(true);
              }}
              className="btn ml-auto px-2 py-0 text-[10px]"
            >
              {COPY.notice.edit}
            </button>
          ) : null}
        </div>
        <p
          role="联盟弹窗-公告-正文"
          title={notice}
          className="line-clamp-3 break-words rounded border border-line-soft bg-panel-2 px-2 py-1.5 text-[12.5px] text-dim"
        >
          {notice || COPY.notice.empty}
        </p>
      </section>
    );
  }

  const save = async () => {
    if (await alliance.setNotice(trimmed)) {
      setEditing(false);
    }
  };

  // 单行输入：多行文本框在内容超出时会出现自己的竖向滚动条，违反全局不滚动规则
  return (
    <section role="联盟弹窗-公告-编辑区" className="flex shrink-0 flex-col gap-1.5">
      <h4 className="text-[12px] text-faint">{COPY.notice.label}</h4>
      <input
        role="联盟弹窗-公告-输入"
        value={draft}
        maxLength={ALLIANCE_NOTICE_MAX_CHARS * 2}
        disabled={alliance.busy}
        onChange={(event) => setDraft(event.target.value)}
        className={`${INPUT_CLASS} min-w-0`}
      />
      <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
        <span className={`font-mono ${tooLong ? 'text-st-error' : 'text-faint'}`}>{COPY.notice.counter(length, ALLIANCE_NOTICE_MAX_CHARS)}</span>
        {tooLong ? <span className="min-w-0 truncate text-st-error">{COPY.notice.tooLong}</span> : null}
        <span className="ml-auto flex gap-1.5">
          <button type="button" role="联盟弹窗-公告-取消" onClick={() => setEditing(false)} className="btn px-2 py-0.5 text-dim">
            {COPY.notice.cancel}
          </button>
          <button type="button" role="联盟弹窗-公告-保存" disabled={tooLong || alliance.busy} onClick={() => void save()} className="btn px-2 py-0.5">
            {COPY.notice.save}
          </button>
        </span>
      </div>
    </section>
  );
}

interface MemberRowProps {
  member: AllianceMemberView;
  me: boolean;
  hasActions: boolean;
  selected: boolean;
  onToggle: () => void;
}

function MemberRow({ member, me, hasActions, selected, onToggle }: MemberRowProps) {
  const { ALLIANCE_COPY: COPY } = useCopy();
  const name = member.username;
  return (
    <div role="联盟弹窗-成员行" className="flex min-w-0 items-center gap-2 border-b border-line-soft py-1.5 text-[12.5px]">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <b className="min-w-0 truncate" title={name}>
            {name}
          </b>
          {me ? <span className="shrink-0 text-[11px] text-accent">{COPY.members.you}</span> : null}
          <RoleTag role={member.role} />
        </div>
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-faint">
          <span className="shrink-0 font-mono">{COPY.members.gov(member.governmentLevel)}</span>
          <span className="shrink-0 font-mono">{COPY.members.territory(member.territoryCount)}</span>
          <span className="min-w-0 truncate">
            <ActivityText online={member.online} lastActiveAt={member.lastActiveAt} />
          </span>
        </div>
      </div>
      {hasActions ? (
        <button
          type="button"
          role={`联盟弹窗-成员操作-${name}`}
          aria-pressed={selected}
          onClick={onToggle}
          className={`btn shrink-0 px-2 py-0.5 ${selected ? 'border-accent bg-accent-soft' : ''}`}
        >
          {COPY.members.expand}
        </button>
      ) : null}
    </div>
  );
}

/** 选中成员的操作条（列表上方）：每个操作都是两步确认 */
function MemberActionBar({
  alliance,
  member,
  actions,
  viceFull,
  onClose,
}: {
  alliance: AllianceSession;
  member: AllianceMemberView;
  actions: ReturnType<typeof memberActions>;
  viceFull: boolean;
  onClose: () => void;
}) {
  const { ALLIANCE_COPY: COPY } = useCopy();
  const name = member.username;
  return (
    <section role="联盟弹窗-成员操作条" className="flex shrink-0 flex-col gap-1.5 rounded border border-line-soft bg-panel-2 px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-2 text-[12px]">
        <b className="min-w-0 flex-1 truncate" title={name}>
          {name}
        </b>
        <button type="button" role="联盟弹窗-成员操作-收起" onClick={onClose} className="btn shrink-0 px-2 py-0 text-dim">
          {COPY.members.collapse}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {actions.canSetVice && member.role === 'vice' ? (
          <InlineConfirm
            role={`联盟弹窗-撤销副盟主-${name}`}
            label={COPY.members.unsetVice}
            confirmLabel={COPY.confirm.yes}
            hint={COPY.confirm.unsetVice(name)}
            disabled={alliance.busy}
            onConfirm={() => alliance.setRole(member.accountId, 'member')}
          />
        ) : null}
        {actions.canSetVice && member.role === 'member' ? (
          <InlineConfirm
            role={`联盟弹窗-任命副盟主-${name}`}
            label={viceFull ? COPY.members.viceFull : COPY.members.setVice}
            confirmLabel={COPY.confirm.yes}
            hint={COPY.confirm.setVice(name)}
            disabled={alliance.busy || viceFull}
            onConfirm={() => alliance.setRole(member.accountId, 'vice')}
          />
        ) : null}
        {actions.canTransfer ? (
          <InlineConfirm
            role={`联盟弹窗-转让-${name}`}
            label={COPY.members.transfer}
            confirmLabel={COPY.confirm.yes}
            hint={COPY.confirm.transfer(name)}
            disabled={alliance.busy}
            onConfirm={() => alliance.setRole(member.accountId, 'leader')}
          />
        ) : null}
        {actions.canKick ? (
          <InlineConfirm
            role={`联盟弹窗-踢出-${name}`}
            label={COPY.members.kick}
            confirmLabel={COPY.confirm.yes}
            hint={COPY.confirm.kick(name)}
            danger
            disabled={alliance.busy}
            onConfirm={() => alliance.kick(member.accountId)}
          />
        ) : null}
      </div>
    </section>
  );
}

/** 弹窗底部固定区：所有人可退出；盟主可解散 */
export function AllianceFooter({ alliance, state }: { alliance: AllianceSession; state: GetAllianceResponseData }) {
  const { ALLIANCE_COPY: COPY } = useCopy();
  const view = state.alliance;
  if (!view) {
    return null;
  }
  const isLeader = state.myRole === 'leader';
  const others = view.members.length - 1;
  // 盟主在盟里还有别人时不能直接退出（服务端 ALLIANCE_LEADER_MUST_TRANSFER），先给出原因
  const leaveBlocked = isLeader && others > 0;

  return (
    <footer role="联盟弹窗-底部" className="flex shrink-0 flex-col gap-1.5 border-t border-line-soft pt-2">
      {isLeader ? <p className="line-clamp-2 text-[11px] text-faint" title={COPY.footer.disbandHint}>{COPY.footer.disbandHint}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <InlineConfirm
          role="联盟弹窗-退出"
          label={COPY.footer.leave}
          confirmLabel={COPY.confirm.yes}
          hint={COPY.confirm.leave}
          danger
          disabled={leaveBlocked || alliance.busy}
          title={leaveBlocked ? COPY.footer.leaveHintLeader : undefined}
          onConfirm={() => alliance.leave()}
        />
        {leaveBlocked ? <span className="min-w-0 truncate text-[11.5px] text-st-error" title={COPY.footer.leaveHintLeader}>{COPY.footer.leaveHintLeader}</span> : null}
        {isLeader && others === 0 ? <span className="min-w-0 truncate text-[11.5px] text-faint" title={COPY.footer.leaveAlone}>{COPY.footer.leaveAlone}</span> : null}
        {isLeader ? (
          <span className="ml-auto shrink-0">
            <InlineConfirm
              role="联盟弹窗-解散"
              label={COPY.footer.disband}
              confirmLabel={COPY.confirm.yes}
              hint={COPY.confirm.disband}
              danger
              disabled={alliance.busy}
              onConfirm={() => alliance.disband()}
            />
          </span>
        ) : null}
      </div>
    </footer>
  );
}
