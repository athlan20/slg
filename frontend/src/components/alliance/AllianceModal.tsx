/** 联盟弹窗（AISLG-186 F1）：外壳只负责分流与状态条。三种状态——没有联盟（AllianceNoPanel）、冷却中（顶部倒计时条，
 *  其余按没有联盟的规则禁用）、有联盟（概况 + 「成员 / 招募」页签 + 底部退出 / 解散）。弹窗外壳不滚动，内容区在弹窗内部滚。
 */

import { useEffect, useState } from 'react';
import { allianceErrorText } from '../../api/errorText';
import { formatDurationText } from '../../api/format';
import { ALLIANCE_RANK_MIN_MEMBERS } from '../../api/protocol';
import type { CityView } from '../../api/protocol';
import { useCopy } from '../../i18n/bundle';
import type { CityList } from '../../state/useCityList';
import type { AllianceSession } from '../../state/allianceSession';
import { isAllianceManager } from '../../state/allianceSession';
import type { AllianceMarksSession } from '../../state/allianceMarks';
import { useNow } from '../../state/useNow';
import { useMapJump } from '../chat/useMapJump';
import { Modal } from '../ui/Modal';
import { AllianceFooter, AllianceMemberPanel } from './AllianceMemberPanel';
import { AllianceMarkPanel } from './AllianceMarkPanel';
import { AllianceDiplomacyPanel } from './AllianceDiplomacyPanel';
import { LuoyangPanel } from './LuoyangPanel';
import { AllianceNoPanel } from './AllianceNoPanel';
import { AllianceRecruitPanel } from './AllianceRecruitPanel';
import { RoleTag } from './allianceParts';

interface AllianceModalProps {
  alliance: AllianceSession;
  /** 本盟地图标记（AISLG-184 / F2）：标记页签 + 地图上的打标记共用 */
  marks: AllianceMarksSession;
  /** 我的账号 id（判断成员列表里哪一行是自己） */
  myId: string | null;
  city: CityView | null;
  cityList: CityList;
  onClose: () => void;
}

type AllianceTab = 'members' | 'diplomacy' | 'luoyang' | 'marks' | 'recruit';

const TAB_CLASS = (on: boolean) =>
  `cursor-pointer rounded border px-2.5 py-0.5 text-[13px] transition-colors ${
    on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-dim hover:text-fg'
  }`;

export function AllianceModal({ alliance, marks, myId, city, cityList, onClose }: AllianceModalProps) {
  const { ALLIANCE_COPY: COPY } = useCopy();
  const { state, error, done } = alliance;
  const cooldownUntil = state?.cooldownUntil ?? null;
  // 冷却倒计时：有截止时刻时每秒刷新，到点后自动解除禁用（服务端的 cooldownUntil 仍以刷新结果为准）
  const now = useNow(cooldownUntil !== null);
  const cooldownLeft = cooldownUntil === null ? 0 : Math.ceil((Date.parse(cooldownUntil) - now) / 1000);
  const cooling = cooldownLeft > 0;
  const [tab, setTab] = useState<AllianceTab>('members');
  const manager = isAllianceManager(state?.myRole ?? null);
  // 降职（副盟主被撤）后不能停在招募页签
  const activeTab: AllianceTab = tab === 'recruit' && !manager ? 'members' : tab;
  const jump = useMapJump();
  // 切到标记页签时重拉一次（推送断过的变化由此补齐）
  useEffect(() => {
    if (activeTab === 'marks') {
      void marks.refresh();
    }
  }, [activeTab, marks.refresh]);

  const status = (
    <>
      {cooling ? <p role="联盟弹窗-冷却" title={COPY.cooldown.banner(formatDurationText(cooldownLeft))} className="truncate rounded border border-line-soft bg-panel-2 px-2 py-1 text-[12px] text-warn">{COPY.cooldown.banner(formatDurationText(cooldownLeft))}</p> : null}
      {error ? (
        <p role="联盟弹窗-错误" className="truncate rounded border border-line-soft bg-panel-2 px-2 py-1.5 text-[12px] text-st-error" title={allianceErrorText(error.code, error.message, error.data, error.scene)}>
          {allianceErrorText(error.code, error.message, error.data, error.scene)}
        </p>
      ) : null}
      {!error && done ? <p role="联盟弹窗-完成" className="truncate text-[12px] text-accent">{done}</p> : null}
    </>
  );

  return (
    <Modal role="联盟弹窗" title={COPY.modal.title} accent="gold" fill onClose={onClose}>
      {state === null ? (
        <p className="py-6 text-center text-[13px] text-faint">{COPY.modal.loading}</p>
      ) : state.alliance === null ? (
        <>
          {status}
          <AllianceNoPanel alliance={alliance} state={state} cooling={cooling} city={city} cityList={cityList} />
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <header className="flex shrink-0 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <h3 role="联盟弹窗-名称" className="min-w-0 truncate text-[15px] font-semibold">
                {state.alliance.name}
              </h3>
              {state.myRole ? <RoleTag role={state.myRole} /> : null}
            </div>
            <p className="truncate font-mono text-[11.5px] text-dim">
              {COPY.mine.members(state.alliance.memberCount, state.alliance.maxMembers)}
              {' · '}
              {COPY.detail.power(state.alliance.power)}
              {' · '}
              {state.alliance.rank !== null
                ? COPY.detail.rank(state.alliance.rank)
                : state.alliance.memberCount < ALLIANCE_RANK_MIN_MEMBERS
                  ? COPY.mine.unrankedHint(ALLIANCE_RANK_MIN_MEMBERS)
                  : COPY.detail.rank(null)}
            </p>
          </header>
          {status}
          <div role="联盟弹窗-页签-有盟" className="flex shrink-0 items-center gap-1">
            <button type="button" role="联盟弹窗-页签-成员" aria-pressed={activeTab === 'members'} onClick={() => setTab('members')} className={TAB_CLASS(activeTab === 'members')}>
              {COPY.tabs.members}
            </button>
            <button type="button" role="联盟弹窗-页签-外交" aria-pressed={activeTab === 'diplomacy'} onClick={() => setTab('diplomacy')} className={TAB_CLASS(activeTab === 'diplomacy')}>
              {COPY.diplomacy.title}
            </button>
            <button type="button" role="联盟弹窗-页签-洛阳" aria-pressed={activeTab === 'luoyang'} onClick={() => setTab('luoyang')} className={TAB_CLASS(activeTab === 'luoyang')}>
              洛阳
            </button>
            <button type="button" role="联盟弹窗-页签-标记" aria-pressed={activeTab === 'marks'} onClick={() => setTab('marks')} className={TAB_CLASS(activeTab === 'marks')}>
              {COPY.tabs.marks}
            </button>
            {manager ? (
              <button type="button" role="联盟弹窗-页签-招募" aria-pressed={activeTab === 'recruit'} onClick={() => setTab('recruit')} className={TAB_CLASS(activeTab === 'recruit')}>
                {state.requests.length > 0 ? `${COPY.tabs.recruit} (${state.requests.length})` : COPY.tabs.recruit}
              </button>
            ) : null}
          </div>
          <div role="联盟弹窗-内容" className="flex min-h-0 flex-1 flex-col">
            {activeTab === 'members' ? <AllianceMemberPanel alliance={alliance} state={state} myId={myId} /> : null}
            {activeTab === 'diplomacy' ? <AllianceDiplomacyPanel alliance={alliance} state={state} /> : null}
            {activeTab === 'luoyang' ? <LuoyangPanel /> : null}
            {activeTab === 'marks' ? (
              <AllianceMarkPanel
                marks={marks}
                myId={myId}
                onLocate={(x, y) => {
                  // 定位：收起联盟弹窗，地图居中并选中该格（聊天卡片的同一做法）
                  alliance.closePanel();
                  jump(x, y);
                }}
              />
            ) : null}
            {activeTab === 'recruit' && manager ? <AllianceRecruitPanel alliance={alliance} state={state} /> : null}
          </div>
          <AllianceFooter alliance={alliance} state={state} />
        </div>
      )}
    </Modal>
  );
}
