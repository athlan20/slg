// 没有联盟时的面板（AISLG-186 F1）：三个页签——联盟列表（PagedList 分页，「更多」向服务端要下一页，点进去看公开信息并申请）、
// 创建联盟、收到的邀请（PagedList）。界面不滚动：长列表全部用 PagedList 按高度分页，行内文本截断并带 title。
// 门槛（官府等级、金币）取自 protocol-alliance 常量；金币只在当前城就是主城时能预判，否则交给服务端判定。

import { useEffect, useState, type FormEvent } from 'react';
import type { AllianceBriefView, AllianceDetailView, CityView, GetAllianceResponseData } from '../../api/protocol';
import {
  ALLIANCE_CREATE_COST_GOLD,
  ALLIANCE_CREATE_MIN_GOVERNMENT,
  ALLIANCE_NAME_MAX_CHARS,
  ALLIANCE_NAME_MIN_CHARS,
} from '../../api/protocol';
import { formatReportTime } from '../../api/format';
import { useCopy } from '../../i18n/bundle';
import type { CityList } from '../../state/useCityList';
import type { AllianceSession } from '../../state/allianceSession';
import { PagedList } from '../ui/PagedList';
import { INPUT_CLASS, isValidAllianceName, RoleTag } from './allianceParts';

type NoTab = 'list' | 'create' | 'invites';

interface AllianceNoPanelProps {
  alliance: AllianceSession;
  state: GetAllianceResponseData;
  /** 冷却中（创建 / 加入一律不可用） */
  cooling: boolean;
  /** 当前选中的城（金币只在它是主城时可见） */
  city: CityView | null;
  cityList: CityList;
}

const TAB_CLASS = (on: boolean) =>
  `cursor-pointer rounded border px-2.5 py-0.5 text-[13px] transition-colors ${
    on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-dim hover:text-fg'
  }`;

export function AllianceNoPanel({ alliance, state, cooling, city, cityList }: AllianceNoPanelProps) {
  const { ALLIANCE_COPY: COPY } = useCopy();
  const [tab, setTab] = useState<NoTab>(() => (state.myInvites.length > 0 ? 'invites' : 'list'));
  const invitesCount = state.myInvites.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div role="联盟弹窗-无盟页签" className="flex shrink-0 flex-wrap items-center gap-1">
        <button type="button" role="联盟弹窗-页签-列表" aria-pressed={tab === 'list'} onClick={() => setTab('list')} className={TAB_CLASS(tab === 'list')}>
          {COPY.noTabs.list}
        </button>
        <button type="button" role="联盟弹窗-页签-创建" aria-pressed={tab === 'create'} onClick={() => setTab('create')} className={TAB_CLASS(tab === 'create')}>
          {COPY.noTabs.create}
        </button>
        <button type="button" role="联盟弹窗-页签-邀请" aria-pressed={tab === 'invites'} onClick={() => setTab('invites')} className={TAB_CLASS(tab === 'invites')}>
          {COPY.noTabs.invites(invitesCount)}
        </button>
      </div>
      <div role="联盟弹窗-内容" className="flex min-h-0 flex-1 flex-col gap-2">
        {tab === 'list' ? <ListTab alliance={alliance} state={state} cooling={cooling} /> : null}
        {tab === 'create' ? <CreateTab alliance={alliance} cooling={cooling} city={city} cityList={cityList} /> : null}
        {tab === 'invites' ? <InvitesTab alliance={alliance} state={state} cooling={cooling} /> : null}
      </div>
    </div>
  );
}

function ListTab({ alliance, state, cooling }: Pick<AllianceNoPanelProps, 'alliance' | 'state' | 'cooling'>) {
  const { ALLIANCE_COPY: COPY } = useCopy();
  const { loadList, loadMoreList, list, listLoading, fetchPublic } = alliance;
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  if (selected !== null) {
    return <DetailView alliance={alliance} state={state} cooling={cooling} allianceId={selected} onBack={() => setSelected(null)} fetchPublic={fetchPublic} />;
  }

  const mine = state.myRequest;
  return (
    <>
      {mine ? (
        <div role="联盟弹窗-我的申请" className="flex shrink-0 items-center gap-2 rounded border border-line-soft bg-panel-2 px-2.5 py-1.5 text-[12.5px]">
          <span className="shrink-0 text-dim">{COPY.list.mineTitle}</span>
          <b className="min-w-0 flex-1 truncate" title={mine.alliance.name}>
            {mine.alliance.name}
          </b>
          <button
            type="button"
            role="联盟弹窗-撤回申请"
            disabled={alliance.busy}
            onClick={() => void alliance.apply(mine.alliance.id, true)}
            className="btn shrink-0 px-2 py-0.5"
          >
            {COPY.list.withdraw}
          </button>
        </div>
      ) : null}
      {list === null ? <p className="py-6 text-center text-[13px] text-faint">{listLoading ? COPY.modal.loading : COPY.list.empty}</p> : null}
      {list !== null ? (
        <PagedList
          role="联盟弹窗-联盟列表"
          items={list.alliances}
          keyOf={(item) => item.id}
          gap={2}
          gapClass="gap-0.5"
          empty={<p className="py-6 text-center text-[13px] text-faint">{COPY.list.empty}</p>}
          hasMore={list.alliances.length < list.total}
          loadingMore={listLoading}
          onLoadMore={() => void loadMoreList()}
          moreLabel={COPY.list.more}
          renderRow={(item: AllianceBriefView) => (
            <button
              type="button"
              role="联盟弹窗-列表条目"
              title={`${item.name} · ${COPY.detail.leader(item.leader.username)}`}
              onClick={() => setSelected(item.id)}
              className="flex w-full min-w-0 cursor-pointer items-center gap-2 border-b border-line-soft py-1.5 text-left text-[13px] hover:text-accent"
            >
              <span className="min-w-0 flex-1 truncate font-semibold">{item.name}</span>
              <span className="min-w-0 max-w-[40%] truncate text-[11.5px] text-faint">{COPY.detail.leader(item.leader.username)}</span>
              <span className="shrink-0 font-mono text-[11.5px] text-dim">{COPY.list.members(item.memberCount, item.maxMembers)}</span>
            </button>
          )}
        />
      ) : null}
    </>
  );
}

/**
 * 点进去看到的公开信息：公告、成员（分页），以及申请按钮。
 * 也被联盟榜（AISLG-185 / F2）复用：已有联盟的玩家看别的联盟时 canApply=false，不出申请按钮。
 */
export function DetailView({
  alliance,
  state,
  cooling,
  allianceId,
  onBack,
  fetchPublic,
  canApply = true,
}: Pick<AllianceNoPanelProps, 'alliance' | 'state' | 'cooling'> & {
  allianceId: string;
  onBack: () => void;
  fetchPublic: AllianceSession['fetchPublic'];
  canApply?: boolean;
}) {
  const { ALLIANCE_COPY: COPY } = useCopy();
  const [detail, setDetail] = useState<AllianceDetailView | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    setStatus('loading');
    void fetchPublic(allianceId).then((data) => {
      if (!alive) {
        return;
      }
      setDetail(data);
      setStatus(data ? 'ready' : 'error');
    });
    return () => {
      alive = false;
    };
  }, [allianceId, fetchPublic]);

  const mine = state.myRequest;
  const applied = mine !== null && mine.alliance.id === allianceId;
  const full = detail !== null && detail.memberCount >= detail.maxMembers;
  const blocked = cooling ? COPY.list.blockedCooldown : mine !== null && !applied ? COPY.list.blockedOther : full ? COPY.list.blockedFull : null;

  if (status !== 'ready' || !detail) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <button type="button" role="联盟弹窗-返回列表" onClick={onBack} className="btn shrink-0 self-start px-2 py-0.5 text-dim">
          ← {COPY.modal.backToList}
        </button>
        <p className={`py-6 text-center text-[13px] ${status === 'error' ? 'text-st-error' : 'text-faint'}`}>
          {status === 'error' ? COPY.modal.detailFailed : COPY.list.detailLoading}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" role="联盟弹窗-返回列表" onClick={onBack} className="btn shrink-0 px-2 py-0.5 text-dim">
          ← {COPY.modal.backToList}
        </button>
        <h3 role="联盟弹窗-详情-名称" className="min-w-0 flex-1 truncate text-right text-[15px] font-semibold" title={detail.name}>
          {detail.name}
        </h3>
      </div>
      <header className="flex shrink-0 flex-col gap-0.5">
        <p className="truncate text-[12px] text-dim" title={`${COPY.detail.leader(detail.leader.username)} · ${COPY.list.members(detail.memberCount, detail.maxMembers)}`}>
          {COPY.detail.leader(detail.leader.username)} · {COPY.list.members(detail.memberCount, detail.maxMembers)}
        </p>
        <p className="truncate font-mono text-[11.5px] text-faint">
          {COPY.detail.power(detail.power)} · {COPY.detail.rank(detail.rank)}
        </p>
      </header>
      <section className="flex shrink-0 flex-col gap-0.5">
        <h4 className="text-[12px] text-faint">{COPY.detail.notice}</h4>
        <p className="line-clamp-3 break-words text-[12.5px] text-dim" title={detail.notice}>
          {detail.notice || COPY.detail.noNotice}
        </p>
      </section>
      <section className="flex min-h-0 flex-1 flex-col">
        <h4 className="pb-1 text-[12px] text-faint">{COPY.detail.members}</h4>
        <PagedList
          role="联盟弹窗-详情-成员"
          items={detail.members}
          keyOf={(member) => member.accountId}
          gap={2}
          gapClass="gap-0.5"
          renderRow={(member) => (
            <div className="flex min-w-0 items-center gap-2 border-b border-line-soft py-1 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate" title={member.username}>
                {member.username}
              </span>
              <RoleTag role={member.role} />
              <span className="shrink-0 font-mono text-[11px] text-faint">{COPY.members.gov(member.governmentLevel)}</span>
            </div>
          )}
        />
      </section>
      {canApply ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {applied ? (
            <>
              <span className="text-[12.5px] text-accent">{COPY.list.applied}</span>
              <button type="button" role="联盟弹窗-撤回申请" disabled={alliance.busy} onClick={() => void alliance.apply(allianceId, true)} className="btn px-2 py-0.5">
                {COPY.list.withdraw}
              </button>
            </>
          ) : (
            <button
              type="button"
              role="联盟弹窗-申请加入"
              disabled={blocked !== null || alliance.busy}
              title={blocked ?? undefined}
              onClick={() => void alliance.apply(allianceId)}
              className="btn px-3 py-1"
            >
              {COPY.list.apply}
            </button>
          )}
          {blocked !== null && !applied ? <span className="min-w-0 truncate text-[11.5px] text-faint" title={blocked}>{blocked}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function CreateTab({ alliance, cooling, city, cityList }: Pick<AllianceNoPanelProps, 'alliance' | 'cooling' | 'city' | 'cityList'>) {
  const { ALLIANCE_COPY: COPY } = useCopy();
  const [name, setName] = useState('');
  const mainCity = cityList.cities.find((item) => item.isMain) ?? null;
  const government = mainCity?.level ?? 0;
  // 金币从主城扣：只有当前城就是主城时才能看到余额，否则不预判（服务端会校验）
  const gold = city !== null && mainCity !== null && city.id === mainCity.id ? city.resources.gold : null;
  const nameOk = isValidAllianceName(name);
  const govOk = government >= ALLIANCE_CREATE_MIN_GOVERNMENT;
  const goldOk = gold === null || gold >= ALLIANCE_CREATE_COST_GOLD;
  const cost = ALLIANCE_CREATE_COST_GOLD.toLocaleString();
  const blocked = cooling
    ? COPY.create.blockedCooldown
    : !govOk
      ? COPY.create.blockedGov
      : !goldOk
        ? COPY.create.blockedGold
        : null;
  const disabled = !nameOk || blocked !== null || alliance.busy;
  const nameTouched = name.trim().length > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!disabled) {
      void alliance.create(name.trim());
    }
  };

  return (
    <form role="联盟弹窗-创建表单" className="flex min-h-0 flex-1 flex-col gap-2" onSubmit={submit}>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] text-dim">{COPY.create.nameLabel}</span>
        <input
          role="联盟弹窗-创建-名称"
          className={INPUT_CLASS}
          value={name}
          placeholder={COPY.create.namePlaceholder}
          onChange={(event) => setName(event.target.value)}
          disabled={alliance.busy}
          autoComplete="off"
        />
      </label>
      <p className={`text-[11.5px] ${nameTouched && !nameOk ? 'text-st-error' : 'text-faint'}`}>
        {COPY.create.nameHint(ALLIANCE_NAME_MIN_CHARS, ALLIANCE_NAME_MAX_CHARS)}
      </p>
      <p className="text-[12.5px] text-dim">{COPY.create.rule(ALLIANCE_CREATE_MIN_GOVERNMENT, cost)}</p>
      <div className="flex flex-col gap-0.5 font-mono text-[11.5px]">
        <span role="联盟弹窗-创建-官府" className={`truncate ${govOk ? 'text-faint' : 'text-st-error'}`}>
          {COPY.create.govStatus(government, ALLIANCE_CREATE_MIN_GOVERNMENT)}
        </span>
        {gold !== null ? (
          <span role="联盟弹窗-创建-金币" className={`truncate ${goldOk ? 'text-faint' : 'text-st-error'}`}>
            {COPY.create.goldStatus(gold.toLocaleString(), cost)}
          </span>
        ) : (
          <span className="truncate text-faint">{COPY.create.goldUnknown}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" role="联盟弹窗-创建-提交" disabled={disabled} className="btn px-3 py-1">
          {COPY.create.submit}
        </button>
        {blocked !== null ? <span className="min-w-0 truncate text-[11.5px] text-st-error" title={blocked}>{blocked}</span> : null}
        {blocked === null && !nameOk && nameTouched ? <span className="text-[11.5px] text-faint">{COPY.create.blockedName}</span> : null}
      </div>
    </form>
  );
}

function InvitesTab({ alliance, state, cooling }: Pick<AllianceNoPanelProps, 'alliance' | 'state' | 'cooling'>) {
  const { ALLIANCE_COPY: COPY } = useCopy();
  return (
    <PagedList
      role="联盟弹窗-邀请列表"
      items={state.myInvites}
      keyOf={(invite) => invite.alliance.id}
      gap={2}
      gapClass="gap-0.5"
      empty={<p className="py-6 text-center text-[13px] text-faint">{COPY.invites.empty}</p>}
      renderRow={(invite) => (
        <div role="联盟弹窗-邀请条目" className="flex min-w-0 flex-col gap-1 border-b border-line-soft py-2">
          <div className="flex min-w-0 items-center gap-2">
            <b className="min-w-0 flex-1 truncate text-[13.5px]" title={invite.alliance.name}>
              {invite.alliance.name}
            </b>
            <span className="shrink-0 font-mono text-[11.5px] text-dim">{COPY.list.members(invite.alliance.memberCount, invite.alliance.maxMembers)}</span>
          </div>
          <p className="truncate text-[12px] text-dim" title={COPY.invites.from(invite.inviter.username)}>
            {COPY.invites.from(invite.inviter.username)}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate font-mono text-[11px] text-faint">{COPY.invites.expires(formatReportTime(invite.expiresAt))}</span>
            <span className="ml-auto flex shrink-0 gap-1.5">
              <button
                type="button"
                role="联盟弹窗-邀请-接受"
                disabled={cooling || alliance.busy}
                title={cooling ? COPY.invites.blockedCooldown : undefined}
                onClick={() => void alliance.respondInvite(invite.alliance.id, true)}
                className="btn px-2 py-0.5"
              >
                {COPY.invites.accept}
              </button>
              <button
                type="button"
                role="联盟弹窗-邀请-拒绝"
                disabled={alliance.busy}
                onClick={() => void alliance.respondInvite(invite.alliance.id, false)}
                className="btn px-2 py-0.5 text-dim"
              >
                {COPY.invites.reject}
              </button>
            </span>
          </div>
        </div>
      )}
    />
  );
}
