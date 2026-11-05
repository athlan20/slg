/** 武将卡（养成页左，v36 AISLG-114/115/116）：本城城守 / 账号全部武将（分页，任命城守 / 撤任 / 解雇）/ 酒馆候选与招募。
 *  武将账号共享，酒馆候选按当前城。
 */

import type { CityView } from '../api/protocol';
import { useCopy } from '../i18n/bundle';
import { tName } from '../i18n/names';
import type { CityList } from '../state/useCityList';
import type { HeroSession } from '../state/heroSession';
import { useGame } from '../state/GameContext';
import { useNow } from '../state/useNow';
import { heroShareLabel } from './chat/chatText';
import { HeroCard } from './HeroCard';
import { HeroFriendship } from './HeroFriendship';
import { HeroTavern } from './HeroTavern';
import { Card } from './ui/Card';
import { PagedList } from './ui/PagedList';

interface HeroPanelProps {
  city: CityView | null;
  cityList: CityList;
  session: HeroSession;
}

export function HeroPanel({ city, cityList, session }: HeroPanelProps) {
  const copy = useCopy();
  const { EXTRA_PANEL, HERO_COPY } = copy;
  const game = useGame().session;
  const { chat, stratagem } = game;
  // v87（AISLG-217）：酒馆只在主城——当前城是分城时提示并引导切回主城
  const mainCityId = cityList.cities.find((item) => item.isMain)?.id ?? null;
  const isMainCity = city !== null && (mainCityId === null || city.id === mainCityId);
  const { state, error, busy } = session;
  const now = useNow(state !== null && state.heroes.length > 0);
  const cityNames: Record<string, string> = Object.fromEntries(cityList.cities.map((item) => [item.id, item.name]));
  const guard = city?.guard ?? null;
  const captiveCount = state ? state.heroes.filter((hero) => hero.captive !== null).length : 0;
  const lowLoyaltyCount = state ? state.heroes.filter((hero) => hero.loyalty !== null && hero.loyalty <= 30).length : 0;
  const guardText = guard
    ? HERO_COPY.guard.row(tName(guard.name), Math.min(20, Math.round(guard.force * 0.3 * 10) / 10), Math.min(20, Math.round(guard.wit * 0.3 * 10) / 10), guard.bonusPercent)
    : HERO_COPY.guard.none;

  return (
    <Card
      role="武将面板"
      title={HERO_COPY.panel.title}
      meta={<span role="武将面板-上限">{state ? HERO_COPY.panel.meta(state.normalCount, state.normalCap, state.famousCount, state.famousCap) : ''}</span>}
    >
      <p role="武将面板-城守" className="shrink-0 truncate text-[12px] text-dim" title={`${HERO_COPY.guard.title}${EXTRA_PANEL.joiners.colon}${guardText}\n${HERO_COPY.panel.hint}`}>
        <span className="text-faint">{HERO_COPY.guard.title}{EXTRA_PANEL.joiners.colon}</span>
        {guardText}
      </p>
      {error ? (
        <p role="武将面板-错误" className="shrink-0 truncate text-[12px] text-warn" title={error}>
          {error}
        </p>
      ) : null}
      {state === null ? (
        <p className="text-[12px] text-faint">{HERO_COPY.panel.loading}</p>
      ) : (
        <>
          {captiveCount + lowLoyaltyCount > 0 ? (
            <p role="武将面板-提醒" className="shrink-0 truncate text-[12px] text-warn">
              {HERO_COPY.panel.alert(captiveCount, lowLoyaltyCount)}
            </p>
          ) : null}
          <PagedList
            role="武将面板-武将列表"
            items={state.heroes}
            keyOf={(hero) => hero.id}
            empty={<p className="py-3 text-center text-[12px] text-faint">{HERO_COPY.panel.noHeroes}</p>}
            renderRow={(hero) => (
              <HeroCard
                hero={hero}
                currentCityId={city?.id ?? null}
                cityNames={cityNames}
                busy={busy}
                now={now}
                onAssign={() => void session.assignGuard(hero.id)}
                onRemoveGuard={() => void session.assignGuard(null)}
                onDismiss={() => void session.dismiss(hero.id)}
                onShare={() => chat.shareDraft({ card: { kind: 'hero', heroId: hero.id }, label: heroShareLabel(tName(hero.name), hero.level) })}
                onAllocate={(attr) => void session.allocate(hero.id, { [attr]: 1 })}
                onTrain={(tier) => void session.train(hero.id, tier)}
                onCancelTrain={() => void session.cancelTraining(hero.id)}
                onGift={() => void session.gift(hero.id)}
                onRansom={() => void session.ransom(hero.id)}
                onReset={() => void session.reset(hero.id)}
                onCastStratagem={() => stratagem.openPanel({ heroId: hero.id })}
              />
            )}
          />
          <HeroTavern
            state={state}
            city={city}
            isMain={isMainCity}
            onGoMain={() => {
              if (mainCityId !== null) {
                void game.switchCity(mainCityId);
              }
            }}
            busy={busy}
            onRecruit={(id) => void session.recruit(id)}
          />
          <HeroFriendship
            state={state}
            busy={busy}
            onBefriend={(name) => void session.befriend(name)}
            onRecruit={(name) => void session.recruitFamous(name)}
          />
        </>
      )}
    </Card>
  );
}
