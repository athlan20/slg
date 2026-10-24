// 有联盟时「招募」页签（AISLG-186 F1，仅盟主 / 副盟主可见）：邀请玩家（输入昵称，顶部固定）、待审批的入盟申请、
// 已发出的邀请（两个列表各用 PagedList 分页，平分剩余高度，不滚动）。名额口径：成员数 + 待处理邀请数 ≤ 上限（待处理邀请也占名额）。

import { useState, type FormEvent } from 'react';
import type { GetAllianceResponseData } from '../../api/protocol';
import { ALLIANCE_MAX_MEMBERS } from '../../api/protocol';
import { formatReportTime } from '../../api/format';
import { useCopy } from '../../i18n/bundle';
import type { AllianceSession } from '../../state/allianceSession';
import { PagedList } from '../ui/PagedList';
import { INPUT_CLASS } from './allianceParts';

interface AllianceRecruitPanelProps {
  alliance: AllianceSession;
  state: GetAllianceResponseData;
}

export function AllianceRecruitPanel({ alliance, state }: AllianceRecruitPanelProps) {
  const { ALLIANCE_COPY: COPY } = useCopy();
  const [username, setUsername] = useState('');
  const view = state.alliance;
  if (!view) {
    return null;
  }
  const invitesCount = state.sentInvites.length;
  const trimmed = username.trim();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (trimmed === '' || alliance.busy) {
      return;
    }
    if (await alliance.invite(trimmed)) {
      setUsername('');
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <form role="联盟弹窗-邀请表单" className="flex shrink-0 flex-col gap-1.5" onSubmit={(event) => void submit(event)}>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-dim">{COPY.recruit.inviteLabel}</span>
          <span className="flex min-w-0 items-center gap-2">
            <input
              role="联盟弹窗-邀请-昵称"
              className={`${INPUT_CLASS} min-w-0 flex-1`}
              value={username}
              placeholder={COPY.recruit.invitePlaceholder}
              disabled={alliance.busy}
              autoComplete="off"
              onChange={(event) => setUsername(event.target.value)}
            />
            <button type="submit" role="联盟弹窗-邀请-提交" disabled={trimmed === '' || alliance.busy} className="btn shrink-0 px-3 py-1">
              {COPY.recruit.invite}
            </button>
          </span>
        </label>
        <p className="truncate font-mono text-[11px] text-faint" title={COPY.recruit.slots(view.memberCount, invitesCount, ALLIANCE_MAX_MEMBERS)}>
          {COPY.recruit.slots(view.memberCount, invitesCount, ALLIANCE_MAX_MEMBERS)}
        </p>
      </form>

      <section className="flex min-h-0 flex-1 flex-col">
        <h4 className="pb-1 text-[12px] text-faint">{COPY.recruit.requestsTitle}</h4>
        <PagedList
          role="联盟弹窗-申请列表"
          items={state.requests}
          keyOf={(request) => request.accountId}
          gap={2}
          gapClass="gap-0.5"
          empty={<p className="py-3 text-center text-[12.5px] text-faint">{COPY.recruit.requestsEmpty}</p>}
          renderRow={(request) => (
            <div role="联盟弹窗-申请条目" className="flex min-w-0 items-center gap-2 border-b border-line-soft py-1.5">
              <div className="min-w-0 flex-1">
                <b className="block truncate text-[12.5px]" title={request.username}>
                  {request.username}
                </b>
                <span className="block truncate font-mono text-[11px] text-faint">
                  {COPY.members.gov(request.governmentLevel)} · {COPY.recruit.requestAt(formatReportTime(request.createdAt))}
                </span>
              </div>
              <span className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  role="联盟弹窗-申请-同意"
                  disabled={alliance.busy}
                  onClick={() => void alliance.respondRequest(request.accountId, true)}
                  className="btn px-2 py-0.5"
                >
                  {COPY.recruit.approve}
                </button>
                <button
                  type="button"
                  role="联盟弹窗-申请-拒绝"
                  disabled={alliance.busy}
                  onClick={() => void alliance.respondRequest(request.accountId, false)}
                  className="btn px-2 py-0.5 text-dim"
                >
                  {COPY.recruit.reject}
                </button>
              </span>
            </div>
          )}
        />
      </section>

      <section className="flex min-h-0 flex-1 flex-col">
        <h4 className="pb-1 text-[12px] text-faint">{COPY.recruit.sentTitle}</h4>
        <PagedList
          role="联盟弹窗-已发邀请列表"
          items={state.sentInvites}
          keyOf={(invite) => invite.accountId}
          gap={2}
          gapClass="gap-0.5"
          empty={<p className="py-3 text-center text-[12.5px] text-faint">{COPY.recruit.sentEmpty}</p>}
          renderRow={(invite) => (
            <div role="联盟弹窗-已发邀请条目" className="flex min-w-0 items-center gap-2 border-b border-line-soft py-1.5">
              <div className="min-w-0 flex-1">
                <b className="block truncate text-[12.5px]" title={invite.username}>
                  {invite.username}
                </b>
                <span className="block truncate font-mono text-[11px] text-faint">
                  {COPY.recruit.sentBy(invite.inviter.username)} · {formatReportTime(invite.expiresAt)}
                </span>
              </div>
              <button
                type="button"
                role="联盟弹窗-撤回邀请"
                disabled={alliance.busy}
                onClick={() => void alliance.invite(invite.username, true)}
                className="btn shrink-0 px-2 py-0.5 text-dim"
              >
                {COPY.recruit.cancelInvite}
              </button>
            </div>
          )}
        />
      </section>
    </div>
  );
}
