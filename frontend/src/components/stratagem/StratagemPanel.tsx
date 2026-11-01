// 施计弹窗（v86，AISLG-211）：选武将 → 选计谋 → 看效果与成功率 → 确认。目标由入口带进来
// （地图上的城 / 返程行军 / 来袭预警），弹窗里不选目标。确认框写清：消耗 1 张哪类令（当前持有 N 张）、
// 成功率、按这名武将智力算好的效果数值、持续时间、对方会不会收到警报；令不够给去战场商店的入口。
// 数据来自 GET_STRATAGEMS（state/stratagemSession），权威判定在服务端。

import { useEffect, useMemo, useState } from 'react';
import { formatClock, formatDurationText } from '../../api/format';
import type { SpyTrailIntel, StratagemKind } from '../../api/protocol';
import { stratagemAlertHint, stratagemDurationText, stratagemEffectText, stratagemName, stratagemSuccessText, stratagemTokenName } from '../../api/stratagemText';
import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';
import { useNav } from '../../state/NavContext';
import { useNow } from '../../state/useNow';
import type { StratagemCastResult, StratagemTargetRef } from '../../state/stratagemSession';
import { Modal } from '../ui/Modal';
import { remainingSeconds } from './StratagemCityNote';
import { StratagemTargetPicker } from './StratagemTargetPicker';

export function StratagemPanel() {
  const copy = useCopy();
  const { STRATAGEM_COPY } = copy;
  const { session } = useGame();
  const { requestBattlefield } = useNav();
  const { state, error, busy, panel, cast, closePanel, fetch } = session.stratagem;
  const now = useNow(true);
  const [heroId, setHeroId] = useState<string | null>(panel?.heroId ?? null);
  const [kind, setKind] = useState<StratagemKind | null>(null);
  const [result, setResult] = useState<StratagemCastResult | null>(null);
  // 没带目标进来（从武将卡进入）时，目标在弹窗里选
  const [picked, setPicked] = useState<StratagemTargetRef | null>(null);

  const given = panel?.target ?? null;
  const hasGivenTarget = given !== null && (given.cityId !== undefined || given.marchId !== undefined || given.attackId !== undefined);
  const target: StratagemTargetRef | null = hasGivenTarget ? given : picked;
  const heroes = state?.heroes ?? [];
  // 缺省武将：入口带进来的，否则第一名在家的
  const activeHero = useMemo(
    () => heroes.find((hero) => hero.heroId === heroId) ?? heroes.find((hero) => hero.available) ?? heroes[0] ?? null,
    [heroes, heroId],
  );
  // 入口限定可用的计谋（自己的城只给欺敌，返程只给金蝉脱壳，来袭预警只给八门金锁）
  const defs = (state?.stratagems ?? []).filter((def) => (target?.only ? target.only.includes(def.kind) : true));
  const activeKind = kind && defs.some((def) => def.kind === kind) ? kind : (defs[0]?.kind ?? null);
  const def = defs.find((item) => item.kind === activeKind) ?? null;
  const tokens = state?.tokens ?? { deception: 0, march: 0, assault: 0, intel: 0 };
  const tokenLimits = state?.tokenLimits ?? { deception: 6, march: 5, assault: 3, intel: 3 };
  const haveToken = def ? (tokens[def.tokenKind] ?? 0) : 0;
  const targetView = state?.target ?? null;
  const immuneLeft = targetView?.immuneUntil ? remainingSeconds(targetView.immuneUntil, now) : 0;
  const cooldownLeft = activeHero?.cooldownUntil ? remainingSeconds(activeHero.cooldownUntil, now) : 0;

  // 换计谋 / 换武将时重新问一次对目标的判定（成功率按两者算）
  useEffect(() => {
    if (activeKind && activeHero && target) {
      void fetch(target, activeHero.heroId, activeKind);
    }
  }, [activeKind, activeHero?.heroId, target, fetch]);

  if (!panel) {
    return null;
  }

  const effect = def && activeHero ? stratagemEffectText(def.kind, activeHero.effects?.[def.kind]) : '';
  const duration = def && activeHero ? stratagemDurationText(activeHero.effects?.[def.kind]) : '';
  const blocked =
    !def || !activeHero || !target || !activeHero.available || haveToken < 1 || (targetView !== null && (!targetView.valid || targetView.protectedReason !== null));

  const submit = async () => {
    if (!def || !activeHero || !target) {
      return;
    }
    const response = await cast({
      heroId: activeHero.heroId,
      stratagem: def.kind,
      target: {
        ...(target.cityId ? { cityId: target.cityId } : {}),
        ...(target.marchId ? { marchId: target.marchId } : {}),
        ...(target.attackId ? { attackId: target.attackId } : {}),
      },
    });
    setResult(response);
  };

  const intel = result?.response?.success && def?.kind === 'spy_trail' ? (result.response.effect.intel as SpyTrailIntel | undefined) : undefined;

  return (
    <Modal role="施计弹窗" title={STRATAGEM_COPY.panel.title} onClose={closePanel} size="md">
      <p role="施计弹窗-说明" className="shrink-0 text-[11.5px] leading-relaxed text-dim">
        {STRATAGEM_COPY.panel.subtitle}
      </p>
      <div role="施计弹窗-计谋令" className="flex shrink-0 flex-wrap items-center gap-1.5 text-[11.5px]">
        <span className="text-faint">{STRATAGEM_COPY.panel.tokensTitle}</span>
        {(['deception', 'march', 'assault', 'intel'] as const).map((tokenKind) => (
          <span
            key={tokenKind}
            role={`施计弹窗-计谋令-${tokenKind}`}
            className={`rounded border px-1.5 ${(tokens[tokenKind] ?? 0) > 0 ? 'border-accent/50 text-accent' : 'border-line text-faint'}`}
          >
            {stratagemTokenName(tokenKind)} {tokens[tokenKind] ?? 0}/{tokenLimits[tokenKind] ?? 0}
          </span>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        {hasGivenTarget ? null : (
          <StratagemTargetPicker
            onPick={(next) => {
              setPicked(next);
              setKind(null);
              setResult(null);
            }}
          />
        )}
        <section role="施计弹窗-武将" className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-faint">{STRATAGEM_COPY.panel.heroTitle}</span>
          <div className="flex flex-wrap gap-1">
            {heroes.map((hero) => (
              <button
                key={hero.heroId}
                type="button"
                role={`施计弹窗-武将-${hero.name}`}
                aria-pressed={activeHero?.heroId === hero.heroId}
                onClick={() => {
                  setHeroId(hero.heroId);
                  setResult(null);
                }}
                title={
                  hero.available
                    ? STRATAGEM_COPY.panel.heroLine(hero.name, hero.wit)
                    : (hero.unavailableReason ? STRATAGEM_COPY.panel.heroUnavailable[hero.unavailableReason] : '')
                }
                className={`cursor-pointer rounded border px-1.5 py-0.5 text-[11.5px] ${
                  activeHero?.heroId === hero.heroId ? 'border-accent bg-accent-soft text-accent' : 'border-line text-dim'
                } disabled:opacity-50`}
              >
                {STRATAGEM_COPY.panel.heroLine(hero.name, hero.wit)}
                {hero.available ? '' : ` · ${hero.unavailableReason ? STRATAGEM_COPY.panel.heroUnavailable[hero.unavailableReason] : ''}`}
                {hero.cooldownUntil && remainingSeconds(hero.cooldownUntil, now) > 0 ? ` · ${formatDurationText(remainingSeconds(hero.cooldownUntil, now))}` : ''}
              </button>
            ))}
          </div>
        </section>

        <section role="施计弹窗-计谋" className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-faint">{STRATAGEM_COPY.panel.stratagemTitle}</span>
          {defs.length === 0 ? (
            <p className="text-[11.5px] text-faint">{STRATAGEM_COPY.panel.targetMissing}</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {defs.map((item) => (
                <button
                  key={item.kind}
                  type="button"
                  role={`施计弹窗-计谋-${item.name}`}
                  aria-pressed={activeKind === item.kind}
                  disabled={state === null}
                  onClick={() => {
                    setKind(item.kind);
                    setResult(null);
                  }}
                  title={STRATAGEM_COPY.desc[item.kind]}
                  className={`cursor-pointer rounded border px-1.5 py-0.5 text-[11.5px] disabled:opacity-50 ${
                    activeKind === item.kind ? 'border-accent bg-accent-soft text-accent' : 'border-line text-dim'
                  } ${(tokens[item.tokenKind] ?? 0) < 1 ? 'opacity-60' : ''}`}
                >
                  {item.name}
                  <span className="ml-1 text-[10.5px] text-faint">
                    {stratagemTokenName(item.tokenKind)} {tokens[item.tokenKind] ?? 0}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {def ? (
          <section role="施计弹窗-判定" className="flex flex-col gap-0.5 rounded border border-line-soft bg-panel-2 px-2 py-1 text-[11.5px] text-dim">
            <p role="施计弹窗-目标">
              {STRATAGEM_COPY.panel.targetTitle}：{target?.label ?? STRATAGEM_COPY.panel.targetMissing}
            </p>
            <p role="施计弹窗-效果">
              {STRATAGEM_COPY.panel.effectLabel}
              {effect}
              {duration ? ` · ${duration}` : ''}
            </p>
            {stratagemSuccessText(def.canFail, targetView) ? (
              <p role="施计弹窗-成功率" className="text-accent">
                {stratagemSuccessText(def.canFail, targetView)}
                {targetView ? ` · ${stratagemName(def.kind)}` : ''}
              </p>
            ) : null}
            <p role="施计弹窗-警报">{stratagemAlertHint(def.notifiesTarget)}</p>
            <p role="施计弹窗-免疫">
              {def.immunitySeconds ? STRATAGEM_COPY.panel.immunityLabel(Math.round(def.immunitySeconds / 3600)) : STRATAGEM_COPY.panel.noImmunity}
            </p>
            {targetView && !targetView.valid ? (
              <p role="施计弹窗-目标不合法" className="text-warn">
                {STRATAGEM_COPY.panel.invalidTarget}
              </p>
            ) : null}
            {targetView?.protectedReason ? (
              <p role="施计弹窗-目标受保护" className="text-warn">
                {STRATAGEM_COPY.panel.protectedReason[targetView.protectedReason]}
              </p>
            ) : null}
            {immuneLeft > 0 && targetView?.immuneUntil ? (
              <p role="施计弹窗-目标免疫" className="text-warn">
                {STRATAGEM_COPY.panel.immune(formatClock(targetView.immuneUntil))}
              </p>
            ) : null}
            {cooldownLeft > 0 ? (
              <p role="施计弹窗-武将冷却" className="text-warn">
                {STRATAGEM_COPY.panel.cooldownNotice(formatDurationText(cooldownLeft))}
              </p>
            ) : null}
            <p role="施计弹窗-消耗" className={haveToken > 0 ? '' : 'text-warn'}>
              {haveToken > 0 ? STRATAGEM_COPY.panel.cost(stratagemTokenName(def.tokenKind), haveToken) : STRATAGEM_COPY.panel.noToken(stratagemTokenName(def.tokenKind))}
            </p>
          </section>
        ) : null}

        {error ? (
          <p role="施计弹窗-错误" className="text-[11.5px] text-warn">
            {error}
          </p>
        ) : null}
        {result ? (
          <p role="施计弹窗-结果" className={result.ok && result.response?.success ? 'text-[12px] text-ok' : 'text-[12px] text-warn'}>
            {result.text}
          </p>
        ) : null}
        {intel ? (
          <div role="施计弹窗-蛛丝马迹" className="flex flex-col gap-0.5 rounded border border-line-soft bg-panel-2 px-2 py-1 text-[11.5px] text-dim">
            <span className="font-semibold text-faint">{STRATAGEM_COPY.panel.spyTitle}</span>
            {intel.cities.map((city) => (
              <span key={city.cityId} role="施计弹窗-蛛丝马迹-城池">
                {STRATAGEM_COPY.panel.spyCityRow(city.name, city.x, city.y)}
              </span>
            ))}
            {intel.marches.length === 0 ? (
              <span className="text-faint">{STRATAGEM_COPY.panel.spyNoMarch}</span>
            ) : (
              intel.marches.map((march) => (
                <span key={march.marchId} role="施计弹窗-蛛丝马迹-部队">
                  {STRATAGEM_COPY.panel.spyMarchRow(march.x, march.y, march.purpose, formatClock(march.arriveAt))}
                </span>
              ))
            )}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {haveToken < 1 ? (
          <button
            type="button"
            role="施计弹窗-去战场商店"
            onClick={() => {
              closePanel();
              requestBattlefield();
            }}
            className="btn px-3"
          >
            {STRATAGEM_COPY.panel.goShop}
          </button>
        ) : null}
        <button type="button" role="施计弹窗-取消按钮" onClick={closePanel} className="btn px-3">
          {STRATAGEM_COPY.panel.cancel}
        </button>
        <button type="button" role="施计弹窗-确认按钮" disabled={busy || blocked} onClick={() => void submit()} className="btn px-3">
          {STRATAGEM_COPY.panel.confirm}
        </button>
      </div>
    </Modal>
  );
}
