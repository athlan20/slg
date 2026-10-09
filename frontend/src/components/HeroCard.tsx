/** 武将卡片（v36 AISLG-114/115/116）：名字 / 名将标记 / 等级 / 当前状态（城内·出征·城守·重伤倒计时·欠饷）、
 *  统武智与满编加成 / 俸禄（一行截断，悬停看全文）、经验条，以及任命城守 / 撤任 / 解雇（二次确认）。
 *  状态与按钮预判与服务端一致，权威判定在服务端。行高固定（文本都截断），供分页列表量高。
 */

import { useState } from 'react';
import type { HeroView } from '../api/protocol';
import { formatClock } from '../api/format';
import { getCopy, useCopy } from '../i18n/bundle';
import { tName } from '../i18n/names';
import { ChatShareButton } from './chat/ChatShareButton';

const HERO_LEVEL_MAX = 20;

interface HeroCardProps {
  hero: HeroView;
  /** 当前正在看的城 id（任命 / 撤任针对它） */
  currentCityId: string | null;
  /** 城 id → 城名（城守状态显示用） */
  cityNames: Record<string, string>;
  busy: boolean;
  now: number;
  onAssign: () => void;
  onRemoveGuard: () => void;
  onDismiss: () => void;
  /** 分享到聊天（AISLG-138）：有值时显示「分享武将」按钮 */
  onShare?: () => void;
}

function statusOf(hero: HeroView, cityNames: Record<string, string>, now: number): { text: string; tone: string } {
  const { EXTRA_PANEL, HERO_COPY } = getCopy();
  if (hero.woundedUntil && Date.parse(hero.woundedUntil) > now) {
    return { text: HERO_COPY.card.statusWounded(formatClock(hero.woundedUntil)), tone: 'text-warn' };
  }
  if (hero.arrears) {
    return { text: HERO_COPY.card.statusArrears, tone: 'text-warn' };
  }
  if (hero.marchingMarchId) {
    return { text: HERO_COPY.card.statusMarching, tone: 'text-accent' };
  }
  if (hero.guardCityId) {
    // 城名可能是名城名，按码表翻译；查不到时给兜底短语
    return { text: HERO_COPY.card.statusGuard(tName(cityNames[hero.guardCityId] ?? EXTRA_PANEL.heroCard.cityFallback)), tone: 'text-ok' };
  }
  return { text: HERO_COPY.card.statusIdle, tone: 'text-faint' };
}

const smallBtn = 'cursor-pointer rounded border px-1.5 text-[11.5px] disabled:cursor-not-allowed disabled:opacity-40';

export function HeroCard({ hero, currentCityId, cityNames, busy, now, onAssign, onRemoveGuard, onDismiss, onShare }: HeroCardProps) {
  const copy = useCopy();
  const { HERO_COPY, CHAT_COPY } = copy;
  const [confirming, setConfirming] = useState(false);
  const status = statusOf(hero, cityNames, now);
  const guardsHere = currentCityId !== null && hero.guardCityId === currentCityId;
  const canAssign = !guardsHere && !hero.marchingMarchId && currentCityId !== null;
  const expPercent = hero.expNext > 0 ? Math.min(100, Math.round((hero.exp / hero.expNext) * 100)) : 100;
  const detail = [
    HERO_COPY.card.attrs(hero.lead, hero.force, hero.wit),
    HERO_COPY.card.bonus(hero.bonus.atkPercent, hero.bonus.defPercent, hero.bonus.leadCap),
    HERO_COPY.card.salary(hero.salaryPerHour),
    HERO_COPY.card.guardProd(hero.guardProductionPercent),
  ].join(' · ');

  return (
    <div
      role={`武将面板-武将-${hero.name}`}
      className={`flex flex-col gap-0.5 rounded-[5px] border bg-panel-2 px-2 py-1 ${hero.famous ? 'border-gold/50' : 'border-line-soft'}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[13px] font-semibold">
          {tName(hero.name)}
          {hero.famous ? (
            <span role="武将面板-名将标记" className="ml-1.5 rounded border border-gold px-1 text-[10.5px] font-normal text-gold">
              {HERO_COPY.card.famousTag}
            </span>
          ) : null}
          <span className="ml-1.5 font-mono text-[11.5px] font-normal text-accent">{HERO_COPY.card.level(hero.level, HERO_LEVEL_MAX)}</span>
        </span>
        <span role="武将面板-状态" className={`shrink-0 truncate text-[11.5px] ${status.tone}`} title={status.text}>
          {status.text}
        </span>
      </div>

      <p role="武将面板-属性" className="truncate font-mono text-[11.5px] text-dim" title={detail}>
        {detail}
      </p>

      <div className="flex items-center gap-2">
        <div role="武将面板-经验条" className="flex min-w-0 flex-1 items-center gap-1.5" title={HERO_COPY.card.exp(hero.exp, hero.expNext)}>
          <div className="h-[3px] flex-1 overflow-hidden rounded bg-line-soft">
            <div className="h-full bg-accent" style={{ width: `${expPercent}%` }} />
          </div>
        </div>
        <div role="武将面板-操作" className="flex shrink-0 items-center gap-1">
          {onShare ? <ChatShareButton role="武将面板-分享按钮" label={CHAT_COPY.share.hero} onClick={onShare} /> : null}
          {guardsHere ? (
            <button type="button" role="武将面板-撤任城守按钮" disabled={busy} onClick={onRemoveGuard} className={`${smallBtn} border-line text-dim hover:text-fg`}>
              {HERO_COPY.card.removeGuard}
            </button>
          ) : (
            <button
              type="button"
              role="武将面板-任命城守按钮"
              disabled={busy || !canAssign}
              title={hero.marchingMarchId ? HERO_COPY.card.guardDenied : undefined}
              onClick={onAssign}
              className={`${smallBtn} border-accent text-accent disabled:border-line disabled:text-faint`}
            >
              {hero.guardCityId ? HERO_COPY.card.guardOther : HERO_COPY.card.assignGuard}
            </button>
          )}
          {confirming ? (
            <span role="武将面板-解雇确认" className="flex items-center gap-1 text-[11.5px]">
              <span className="max-w-[9rem] truncate text-warn" title={hero.famous ? HERO_COPY.card.dismissFamousHint : HERO_COPY.card.dismissConfirm}>
                {hero.famous ? HERO_COPY.card.dismissFamousHint : HERO_COPY.card.dismissConfirm}
              </span>
              <button
                type="button"
                role="武将面板-确认解雇按钮"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  onDismiss();
                }}
                className={`${smallBtn} border-warn text-warn`}
              >
                {HERO_COPY.card.dismiss}
              </button>
              <button type="button" role="武将面板-取消解雇按钮" onClick={() => setConfirming(false)} className={`${smallBtn} border-line text-dim hover:text-fg`}>
                {HERO_COPY.card.cancel}
              </button>
            </span>
          ) : (
            <button type="button" role="武将面板-解雇按钮" disabled={busy} onClick={() => setConfirming(true)} className={`${smallBtn} border-line text-faint hover:text-warn`}>
              {HERO_COPY.card.dismiss}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
