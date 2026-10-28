/** 剧本战场弹窗（v75，AISLG-198；v80 讨伐董卓 / 赤壁之战）：报名 / 入场 / 战场地图与据点 / 队伍行军与拆队 / 军功榜 / 战场商店；
 *  赤壁额外有风向、火攻与连锁战船。数据来自会话切片（GET_BATTLEFIELD + PUSH_BATTLEFIELD_STATE 重拉）；所有操作以服务端判定为准。
 *  入口：顶栏「战场」胶囊（报名中 / 进行中高亮）。 */

import { useMemo, useState } from 'react';
import { formatClock } from '../api/format';
import {
  TROOP_INFO,
  TROOP_KINDS,
  type BattlefieldCamp,
  type BattlefieldShopItem,
  type BattlefieldShopItemView,
  type BattlefieldSquadView,
  type TroopKind,
} from '../api/protocol';
import { useCopy } from '../i18n/bundle';
import { tName } from '../i18n/names';
import { useGame } from '../state/GameContext';
import { Modal } from './ui/Modal';

type Tab = 'map' | 'squads' | 'shop' | 'merit';

const CAMP_COLOR: Record<BattlefieldCamp, string> = {
  yuan: 'bg-accent',
  cao: 'bg-st-error',
};

function ownerClass(camp: BattlefieldCamp | null): string {
  if (camp === 'yuan') {
    return 'border-accent bg-accent-soft text-accent';
  }
  if (camp === 'cao') {
    return 'border-st-error bg-st-error/15 text-st-error';
  }
  return 'border-line bg-panel-2 text-dim';
}

/** 火攻 / 连锁的军功花费（与服务端 common/src/battlefield.ts 的 BATTLEFIELD_FIRE_MERIT_COST / BATTLEFIELD_CHAIN_MERIT_COST 一致） */
const FIRE_MERIT_COST = 300;
const CHAIN_MERIT_COST = 200;

function sumTroops(troops: Partial<Record<TroopKind, number>>): number {
  return TROOP_KINDS.reduce((sum, kind) => sum + Math.max(0, Math.floor(troops[kind] ?? 0)), 0);
}

function populationOf(troops: Partial<Record<TroopKind, number>>): number {
  return TROOP_KINDS.reduce((sum, kind) => sum + Math.max(0, Math.floor(troops[kind] ?? 0)) * TROOP_INFO[kind].population, 0);
}

export function BattlefieldModal({ onClose }: { onClose: () => void }) {
  const { session } = useGame();
  const { BATTLEFIELD_COPY: B, TROOP_LABEL } = useCopy();
  const bf = session.battlefield;
  const state = bf.state;
  const event = state?.event ?? null;
  const me = state?.me ?? null;
  const active = event?.status === 'active';
  const signupOpen = event?.status === 'signup';
  const [tab, setTab] = useState<Tab>('map');
  const [selectedSquad, setSelectedSquad] = useState<string | null>(null);
  const [selectedStronghold, setSelectedStronghold] = useState<string | null>(null);
  const [entry, setEntry] = useState<Partial<Record<TroopKind, number>>>({});
  const [split, setSplit] = useState<Partial<Record<TroopKind, number>>>({});
  const [heroId, setHeroId] = useState<string>('');

  const army = session.city?.army ?? null;
  const script = event?.script ?? 'guandu';
  const nowMs = Date.now();
  /** 阵营显示名以服务端为准（讨董只有讨董联军，赤壁是孙刘联军） */
  const campName = (camp: BattlefieldCamp): string =>
    event?.camps[camp].name ?? (camp === 'yuan' ? B.camps.yuan : B.camps.cao);
  const strongholds = state?.strongholds ?? [];
  const squads = me?.squads ?? [];
  const currentSquad = squads.find((squad) => squad.id === selectedSquad) ?? null;
  const currentStronghold = strongholds.find((item) => item.id === selectedStronghold) ?? null;
  const heroes = (session.heroSession.state?.heroes ?? []) as Array<{ id: string; name: string }>;
  const entryPopulation = populationOf(entry);
  const entryUnits = sumTroops(entry);
  const splitUnits = sumTroops(split);

  const mySquadsAt = useMemo(() => {
    const map = new Map<string, BattlefieldSquadView[]>();
    for (const squad of squads) {
      const key = `${squad.x},${squad.y}`;
      const list = map.get(key) ?? [];
      list.push(squad);
      map.set(key, list);
    }
    return map;
  }, [squads]);

  const mapCells = [];
  for (let y = 0; y < 30; y += 1) {
    for (let x = 0; x < 30; x += 1) {
      const stronghold = strongholds.find((item) => item.x === x && item.y === y) ?? null;
      const mine = mySquadsAt.get(`${x},${y}`) ?? [];
      const river = x === 15 && !stronghold;
      const classes = stronghold
        ? `${ownerClass(stronghold.ownerCamp)} border`
        : river
          ? 'bg-st-info/40'
          : 'bg-panel-2/40';
      mapCells.push(
        <button
          key={`${x}-${y}`}
          type="button"
          tabIndex={stronghold ? 0 : -1}
          title={stronghold ? `${stronghold.name}（${x},${y}）` : undefined}
          onClick={() => stronghold && setSelectedStronghold(stronghold.id)}
          className={`relative aspect-square min-w-0 rounded-[1px] ${classes} ${stronghold ? 'cursor-pointer' : 'cursor-default'} ${
            stronghold && !stronghold.unlocked ? 'opacity-40' : ''
          } ${selectedStronghold === stronghold?.id ? 'ring-1 ring-gold' : ''}`}
        >
          {mine.length > 0 ? <span className="absolute inset-[2px] rounded-full border border-gold" /> : null}
        </button>,
      );
    }
  }

  // 讨董是单阵营合作本：只给一个加入按钮（服务端统一记为讨董联军）
  const signupCamps: readonly BattlefieldCamp[] = script === 'dongzhuo' ? ['yuan'] : ['yuan', 'cao'];
  const signupRule = script === 'dongzhuo' ? B.rules.dongzhuo : script === 'chibi' ? B.rules.chibi : B.rules.signup;
  const signupButtons = (
    <div role="战场-报名" className="flex shrink-0 flex-wrap items-center gap-2 text-[12.5px]">
      {signupCamps.map((camp) => (
        <button
          key={camp}
          type="button"
          disabled={bf.busy}
          onClick={() => void bf.signup(camp)}
          className="cursor-pointer rounded border border-line bg-panel-2 px-2.5 py-1 hover:border-accent-dim hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {B.signup.button(campName(camp))}
        </button>
      ))}
      <span className="text-faint">{signupRule}</span>
    </div>
  );

  const entryForm = (
    <div role="战场-入场" className="flex shrink-0 flex-col gap-1 rounded border border-line-soft bg-panel-2/40 p-2">
      <p className="text-[12px] text-dim">{B.entry.hint}</p>
      <div className="grid grid-cols-3 gap-1.5">
        {TROOP_KINDS.filter((kind) => (army?.[kind] ?? 0) > 0).map((kind) => (
          <label key={kind} className="flex items-center gap-1 text-[12px]">
            <span className="w-14 shrink-0 truncate text-faint">{tName(TROOP_LABEL[kind].name)}</span>
            <input
              type="number"
              min={0}
              max={army?.[kind] ?? 0}
              value={entry[kind] ?? ''}
              onChange={(event_) => {
                const value = Math.max(0, Math.min(army?.[kind] ?? 0, Math.floor(Number(event_.target.value) || 0)));
                setEntry((prev) => ({ ...prev, [kind]: value }));
              }}
              className="w-full min-w-0 rounded border border-line bg-panel px-1 py-0.5 text-right font-mono text-[12px]"
            />
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <span className={entryPopulation > 3000 ? 'text-st-error' : 'text-faint'}>
          {B.entry.population(entryPopulation, 3000)}
          {entryPopulation > 3000 ? ` · ${B.entry.over}` : ''}
          {entryUnits === 0 ? ` · ${B.entry.empty}` : ''}
        </span>
        <button
          type="button"
          disabled={bf.busy || entryUnits === 0 || entryPopulation > 3000}
          onClick={() => void bf.enter(entry)}
          className="cursor-pointer rounded border border-accent-dim bg-accent-soft px-2.5 py-1 text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {B.entry.submit}
        </button>
      </div>
    </div>
  );

  /** 赤壁技能：孙刘方火攻曹方据点（东南风）、曹方给己方据点连锁战船 */
  const skillButtons = (stronghold: NonNullable<typeof currentStronghold>) => {
    if (script !== 'chibi' || !active || !me?.entered) {
      return null;
    }
    const chainOn = stronghold.chainUntil !== null && Date.parse(stronghold.chainUntil) > nowMs;
    const fireOn = stronghold.fireNextAt !== null && Date.parse(stronghold.fireNextAt) > nowMs;
    if (me.camp === 'yuan' && stronghold.ownerCamp === 'cao') {
      const southeast = event?.wind?.direction === 'se';
      return (
        <div className="flex flex-col gap-0.5">
          <span className="text-[11.5px] text-faint">{B.skills.fireHint}</span>
          <button
            type="button"
            disabled={bf.busy || !southeast || fireOn}
            title={southeast ? undefined : B.skills.fireNotice}
            onClick={() => void bf.fire(stronghold.id)}
            className="cursor-pointer self-start rounded border border-st-error bg-st-error/15 px-2 py-0.5 text-st-error disabled:cursor-not-allowed disabled:opacity-50"
          >
            {B.skills.fire(FIRE_MERIT_COST)}
          </button>
        </div>
      );
    }
    if (me.camp === 'cao' && stronghold.ownerCamp === 'cao') {
      return (
        <div className="flex flex-col gap-0.5">
          <span className="text-[11.5px] text-faint">{B.skills.chainHint}</span>
          <button
            type="button"
            disabled={bf.busy || chainOn}
            onClick={() => void bf.chain(stronghold.id)}
            className="cursor-pointer self-start rounded border border-gold bg-gold/10 px-2 py-0.5 text-gold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {B.skills.chain(CHAIN_MERIT_COST)}
          </button>
        </div>
      );
    }
    return null;
  };

  const mapTab = (
    <div role="战场-地图页签" className="flex min-h-0 flex-1 flex-col gap-2 sm:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between text-[12px] text-faint">
          <span>{B.map.legend}</span>
          <span>{B.map.title}</span>
        </div>
        <div
          role="战场-地图"
          className="grid w-full max-w-[320px] self-center overflow-hidden rounded border border-line"
          style={{ gridTemplateColumns: 'repeat(30, minmax(0, 1fr))' }}
        >
          {mapCells}
        </div>
        <p className="truncate text-[11.5px] text-faint">{B.squads.targetHint}</p>
      </div>
      <div className="flex w-full shrink-0 flex-col gap-1.5 text-[12.5px] sm:w-[190px]">
        {currentStronghold ? (
          <div role="战场-据点详情" className="flex flex-col gap-0.5 rounded border border-line-soft p-2">
            <b className="truncate">{tName(currentStronghold.name)}</b>
            <span className={currentStronghold.ownerCamp ? 'text-dim' : 'text-faint'}>
              {currentStronghold.ownerCamp ? B.stronghold.owner(campName(currentStronghold.ownerCamp)) : B.stronghold.neutral}
            </span>
            <span className="text-faint">{B.stronghold.points(currentStronghold.pointsPerHour)}</span>
            <span className="text-faint">{B.stronghold.garrison(currentStronghold.garrisonPower)}</span>
            {currentStronghold.wallLevel > 0 ? <span className="text-faint">{B.stronghold.wall(currentStronghold.wallLevel)}</span> : null}
            {currentStronghold.towerLevel > 0 ? <span className="text-faint">{B.stronghold.tower(currentStronghold.towerLevel)}</span> : null}
            {currentStronghold.firstCaptureAvailable ? <span className="text-gold">{B.stronghold.first}</span> : null}
            {!currentStronghold.unlocked ? <span className="text-st-error">{B.stronghold.locked}</span> : null}
            {currentStronghold.chainUntil && Date.parse(currentStronghold.chainUntil) > nowMs ? (
              <span className="text-gold">{B.stronghold.chained(B.timeOf(currentStronghold.chainUntil))}</span>
            ) : null}
            {currentStronghold.fireNextAt && Date.parse(currentStronghold.fireNextAt) > nowMs ? (
              <span className="text-faint">{B.stronghold.fireCooldown(B.timeOf(currentStronghold.fireNextAt))}</span>
            ) : null}
            {skillButtons(currentStronghold)}
          </div>
        ) : (
          <p className="text-faint">{B.squads.target}</p>
        )}
        {currentSquad ? (
          <div className="flex flex-col gap-0.5 text-[12px]">
            <span className="truncate text-dim">{B.squads.troops(sumTroops(currentSquad.troops))}</span>
            <button
              type="button"
              disabled={bf.busy || !currentStronghold || currentSquad.status === 'marching'}
              onClick={() => currentStronghold && void bf.march(currentSquad.id, { strongholdId: currentStronghold.id })}
              className="cursor-pointer rounded border border-accent-dim bg-accent-soft px-2 py-1 text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {B.squads.march}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );

  const squadsTab = (
    <div role="战场-队伍页签" className="flex min-h-0 flex-1 flex-col gap-1.5">
      {squads.length === 0 ? <p className="text-[12.5px] text-faint">{B.squads.none}</p> : null}
      <div className="flex min-h-0 flex-col gap-1 overflow-hidden">
        {squads.map((squad) => (
          <button
            key={squad.id}
            type="button"
            role="战场-队伍条目"
            onClick={() => {
              setSelectedSquad(squad.id);
              setSplit({});
            }}
            className={`flex cursor-pointer items-center justify-between gap-2 rounded border px-2 py-1 text-left text-[12.5px] ${
              selectedSquad === squad.id ? 'border-accent bg-accent-soft' : 'border-line-soft hover:border-accent-dim'
            }`}
          >
            <span className="min-w-0 truncate">
              ({squad.x},{squad.y}) · {B.squads.status[squad.status]} · {B.squads.troops(sumTroops(squad.troops))}
            </span>
            <span className="shrink-0 text-[11.5px] text-faint">
              {squad.arriveAt ? B.squads.arrive(formatClock(squad.arriveAt)) : selectedSquad === squad.id ? B.squads.selected : B.squads.select}
            </span>
          </button>
        ))}
      </div>
      {currentSquad ? (
        <div role="战场-拆队" className="mt-1 flex shrink-0 flex-col gap-1 rounded border border-line-soft p-2 text-[12px]">
          <p className="text-faint">{B.squads.splitHint}</p>
          <div className="grid grid-cols-3 gap-1.5">
            {TROOP_KINDS.filter((kind) => (currentSquad.troops[kind] ?? 0) > 0).map((kind) => (
              <label key={kind} className="flex items-center gap-1">
                <span className="w-14 shrink-0 truncate text-faint">{tName(TROOP_LABEL[kind].name)}</span>
                <input
                  type="number"
                  min={0}
                  max={currentSquad.troops[kind] ?? 0}
                  value={split[kind] ?? ''}
                  onChange={(event_) => {
                    const value = Math.max(
                      0,
                      Math.min(currentSquad.troops[kind] ?? 0, Math.floor(Number(event_.target.value) || 0)),
                    );
                    setSplit((prev) => ({ ...prev, [kind]: value }));
                  }}
                  className="w-full min-w-0 rounded border border-line bg-panel px-1 py-0.5 text-right font-mono"
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={bf.busy || splitUnits === 0 || splitUnits >= sumTroops(currentSquad.troops)}
            onClick={() => void bf.split(currentSquad.id, split).then((ok) => ok && setSplit({}))}
            className="self-end cursor-pointer rounded border border-accent-dim bg-accent-soft px-2.5 py-1 text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {B.squads.splitSubmit}
          </button>
        </div>
      ) : null}
    </div>
  );

  const shopTab = (
    <div role="战场-商店页签" className="flex min-h-0 flex-1 flex-col gap-1">
      <p className="shrink-0 text-[12.5px] text-gold">{B.shop.merit(state?.shop.cumulativeMerit ?? 0)}</p>
      <div className="flex min-h-0 flex-col gap-1">
        {(state?.shop.items ?? []).map((item: BattlefieldShopItemView) => {
          const soldOut = item.bought >= item.limit;
          const isHeroExp = item.item === 'hero_exp';
          return (
            <div key={item.item} role="战场-商品条目" className="flex items-center justify-between gap-2 rounded border border-line-soft px-2 py-1 text-[12.5px]">
              <span className="min-w-0 truncate">
                <b>{tName(item.label)}</b>
                <span className="ml-1.5 text-faint">{B.shop.cost(item.cost)}</span>
                <span className="ml-1.5 text-faint">{B.shop.limit(item.bought, item.limit)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {isHeroExp ? (
                  <select
                    value={heroId}
                    onChange={(event_) => setHeroId(event_.target.value)}
                    className="max-w-[110px] rounded border border-line bg-panel px-1 py-0.5 text-[12px]"
                  >
                    <option value="">{heroes.length === 0 ? B.shop.heroNone : B.shop.heroPick}</option>
                    {heroes.map((hero) => (
                      <option key={hero.id} value={hero.id}>
                        {tName(hero.name)}
                      </option>
                    ))}
                  </select>
                ) : null}
                <button
                  type="button"
                  disabled={bf.busy || soldOut || (isHeroExp && heroes.length === 0)}
                  onClick={() =>
                    void bf.buy(item.item as BattlefieldShopItem, isHeroExp ? heroId || undefined : undefined)
                  }
                  className="cursor-pointer rounded border border-accent-dim bg-accent-soft px-2 py-0.5 text-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {soldOut ? B.shop.soldOut : B.shop.buy}
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

  const meritTab = (
    <div role="战场-军功页签" className="flex min-h-0 flex-1 flex-col gap-1 text-[12.5px]">
      <p className="shrink-0 text-gold">{me ? B.merit.mine(me.merit, me.rank) : B.merit.mine(0, null)}</p>
      <div className="flex min-h-0 flex-col gap-0.5">
        {(state?.top ?? []).length === 0 ? <p className="text-faint">{B.merit.empty}</p> : null}
        {(state?.top ?? []).map((entry) => (
          <div key={`${entry.accountId}-${entry.rank}`} role="战场-军功条目" className="flex items-center justify-between border-b border-line-soft py-0.5">
            <span className="min-w-0 truncate">
              #{entry.rank} {tName(entry.username)} · {campName(entry.camp)}
            </span>
            <b className="shrink-0 font-mono text-gold">{entry.merit}</b>
          </div>
        ))}
      </div>
      <div role="战场-奖励表" className="mt-auto shrink-0 border-t border-line-soft pt-1 text-[11.5px] text-faint">
        <p className="text-dim">{B.rewards.title}</p>
        {state ? (
          <>
            {state.rewards.progressTiers.length > 0 ? (
              <>
                {state.rewards.progressTiers.map((tier) => (
                  <p key={tier.progress}>{B.rewards.progress(tName(tier.label), tier.gold, tier.resourcesEach)}</p>
                ))}
                <p>{B.rewards.progressNote}</p>
              </>
            ) : (
              <>
                <p>{B.rewards.win(state.rewards.winner.gold, state.rewards.winner.resourcesEach)}</p>
                <p>{B.rewards.lose(state.rewards.loser.gold, state.rewards.loser.resourcesEach)}</p>
              </>
            )}
            {state.rewards.rankTiers.map((tier) => (
              <p key={tier.label}>{B.rewards.rank(tName(tier.label), tier.gold, tier.resourcesEach)}</p>
            ))}
          </>
        ) : null}
        <p>{B.rewards.note}</p>
      </div>
    </div>
  );

  const body = !state ? (
    <p className="py-6 text-center text-[13px] text-faint">{B.launcher.finished}</p>
  ) : (
    <>
      <div role="战场-概况" className="flex shrink-0 flex-col gap-1">
        <div className="flex items-center justify-between gap-2 text-[12.5px]">
          <span className="flex min-w-0 items-center gap-2">
            <b className="truncate">{B.scripts[script]}</b>
            <span className={event?.status === 'active' ? 'text-ok' : event?.status === 'signup' ? 'text-gold' : 'text-faint'}>
              {event ? B.status[event.status] : B.status.finished}
            </span>
          </span>
          {event ? <span className="truncate text-faint">{B.subtitle(B.timeOf(event.startAt), B.timeOf(event.endAt))}</span> : null}
        </div>
        {event?.wind ? (
          <p role="战场-风向" className="shrink-0 text-[12.5px] text-accent">
            {B.wind.title}：{B.wind.line(B.wind.dir[event.wind.direction], B.timeOf(event.wind.nextAt))} · {B.wind.bonus}
          </p>
        ) : null}
        {event ? (
          <div role="战场-阵营比分" className="flex items-center gap-3 text-[13px]">
            {(['yuan', 'cao'] as const).filter((camp) => script !== 'dongzhuo' || camp === 'yuan').map((camp) => (
              <span key={camp} className="flex items-center gap-1.5">
                <i className={`inline-block h-2 w-2 rounded-full ${CAMP_COLOR[camp]}`} />
                <b>{campName(camp)}</b>
                <span className="text-faint">
                  {B.camps.signups(event.camps[camp].signups)} · {B.camps.entered(event.camps[camp].entered)} ·{' '}
                  {B.camps.score(event.camps[camp].score)}
                </span>
              </span>
            ))}
            {event.underdog ? (
              <span className="text-gold">×{event.underdog.multiplier.toFixed(2)}</span>
            ) : null}
          </div>
        ) : null}
        <p className="truncate text-[11.5px] text-faint">{B.rules.merit}</p>
        {bf.error ? (
          <p role="战场-错误" className="shrink-0 text-[12.5px] text-st-error" onClick={bf.clearError}>
            {bf.error}
          </p>
        ) : null}
      </div>

      {signupOpen && !me ? signupButtons : null}
      {signupOpen && me && !me.entered ? entryForm : null}
      {signupOpen && me && me.entered ? <p className="shrink-0 text-[12.5px] text-ok">{B.entry.submitted}</p> : null}

      {!signupOpen ? (
        <>
          <div className="flex shrink-0 gap-1.5">
            {(
              [
                ['map', B.map.title],
                ['squads', B.squads.title],
                ['shop', B.shop.title],
                ['merit', B.merit.title],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={tab === key}
                onClick={() => setTab(key)}
                className={`cursor-pointer rounded border px-2.5 py-0.5 text-[12.5px] ${
                  tab === key ? 'border-accent bg-accent-soft text-accent' : 'border-line text-dim hover:text-fg'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'map' ? mapTab : null}
          {tab === 'squads' ? squadsTab : null}
          {tab === 'shop' ? shopTab : null}
          {tab === 'merit' ? meritTab : null}
        </>
      ) : null}
      {!active && event?.status === 'finished' ? <p className="shrink-0 text-[12px] text-faint">{B.rewards.note}</p> : null}
    </>
  );

  return (
    <Modal role="剧本战场弹窗" title={B.title} accent="gold" fill onClose={onClose}>
      {body}
    </Modal>
  );
}