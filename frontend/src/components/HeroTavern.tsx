/** 酒馆候选 + 名将归属（v36 AISLG-114/115）：三名候选横排成卡片（属性 / 招募费），金币或上限不足时禁用并说明；
 *  下次刷新时刻；名将归属（11 名名将的来源与当前主人，全服唯一）点开弹窗看，不占常驻空间。
 */

import { useState } from 'react';
import type { CityView, HeroStateView } from '../api/protocol';
import { formatClock } from '../api/format';
import { useCopy } from '../i18n/bundle';
import { tHeroSource, tName } from '../i18n/names';
import { Modal } from './ui/Modal';
import { PagedList } from './ui/PagedList';

interface HeroTavernProps {
  state: HeroStateView;
  city: CityView | null;
  busy: boolean;
  onRecruit: (candidateId: string) => void;
}

/** 候选批次下一次刷新时刻：refreshedAt + 4 小时基准 ÷ 全局缩放（缩放来自当前城） */
function nextRefreshIso(refreshedAt: string, timeScale: number): string {
  return new Date(Date.parse(refreshedAt) + (4 * 3_600_000) / Math.max(1, timeScale)).toISOString();
}

export function HeroTavern({ state, city, busy, onRecruit }: HeroTavernProps) {
  const copy = useCopy();
  const { HERO_COPY } = copy;
  const [famousOpen, setFamousOpen] = useState(false);
  const gold = city?.resources.gold ?? 0;
  const capReached = state.normalCount >= state.normalCap;

  return (
    <div role="武将面板-酒馆区" className="flex shrink-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="border-l-[3px] border-accent pl-2 text-[13px] font-semibold">{HERO_COPY.candidates.title}</h3>
        <span className="flex items-baseline gap-2">
          {state.tavernLevel > 0 && state.candidates.length > 0 ? (
            <span role="武将面板-候选刷新时刻" className="text-[11px] text-faint">
              {HERO_COPY.candidates.refreshAt(formatClock(nextRefreshIso(state.candidates[0].refreshedAt, city?.timeScale ?? 1)))}
            </span>
          ) : null}
          <button type="button" role="武将面板-名将归属开关" onClick={() => setFamousOpen(true)} className="cursor-pointer text-[11.5px] text-faint hover:text-dim">
            {HERO_COPY.famous.title}
          </button>
        </span>
      </div>
      {state.tavernLevel <= 0 ? (
        <p role="武将面板-无酒馆提示" className="text-[12px] text-warn">
          {HERO_COPY.panel.noTavern}
        </p>
      ) : state.candidates.length === 0 ? (
        <p className="text-[12px] text-faint">{HERO_COPY.candidates.empty}</p>
      ) : (
        <div className="grid grid-cols-3 gap-1">
          {state.candidates.map((cand) => {
            const blocked = capReached ? HERO_COPY.candidates.capReached(state.normalCap) : gold < cand.cost ? HERO_COPY.candidates.needGold(cand.cost) : null;
            return (
              <div key={cand.id} role={`武将面板-候选-${cand.name}`} className="flex min-w-0 flex-col gap-0.5 rounded-[5px] border border-dashed border-line px-1.5 py-1 text-[11.5px]">
                <b className="truncate text-[12.5px]">{tName(cand.name)}</b>
                <span className="truncate font-mono text-[11px] text-dim" title={HERO_COPY.candidates.attrs(cand.lead, cand.force, cand.wit)}>
                  {HERO_COPY.candidates.attrs(cand.lead, cand.force, cand.wit)}
                </span>
                <button
                  type="button"
                  role="武将面板-招募按钮"
                  disabled={busy || blocked !== null}
                  title={blocked ?? undefined}
                  onClick={() => onRecruit(cand.id)}
                  className="btn mt-0.5 truncate"
                >
                  {busy ? HERO_COPY.candidates.recruiting : `${HERO_COPY.candidates.recruit} ${HERO_COPY.candidates.cost(cand.cost)}`}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {famousOpen ? (
        <Modal role="名将归属弹窗" title={HERO_COPY.famous.title} accent="gold" fill onClose={() => setFamousOpen(false)}>
          <PagedList
            role="武将面板-名将归属"
            items={state.famousClaims}
            keyOf={(claim) => claim.name}
            renderRow={(claim) => (
              <p className="flex items-baseline justify-between gap-2 border-b border-line-soft py-1 text-[12.5px]">
                <span className="min-w-0 truncate text-dim">
                  {tName(claim.name)}
                  <span className="ml-1 text-faint">{tHeroSource(claim.sourceLabel)}</span>
                </span>
                <span className={`shrink-0 ${claim.ownerUsername ? 'text-accent' : 'text-faint'}`}>
                  {claim.ownerUsername ? HERO_COPY.famous.owner(claim.ownerUsername) : HERO_COPY.famous.free}
                </span>
              </p>
            )}
          />
        </Modal>
      ) : null}
    </div>
  );
}
