/** 结交面板（v54，AISLG-144）：在野名将的结交资格与结交进度。每行 = 一名在野名将：好感条、
 *  每次花费、今日剩余次数，以及「结交」（花金币 +10 好感）与「招揽」（好感满 100）。
 *  同时结交上限 2 名（好感未满且未被他人招揽的才计入）；被他人招揽后的进度标为作废。
 *  行高固定（名字与状态截断），供分页列表量高。权威判定在服务端（HERO_* 错误码）。
 */

import type { FriendshipView, HeroStateView } from '../api/protocol';
import { useCopy } from '../i18n/bundle';
import { tName } from '../i18n/names';
import { PagedList } from './ui/PagedList';

interface HeroFriendshipProps {
  state: HeroStateView;
  busy: boolean;
  onBefriend: (heroName: string) => void;
  onRecruit: (heroName: string) => void;
}

const smallBtn = 'cursor-pointer rounded border px-1.5 text-[11.5px] disabled:cursor-not-allowed disabled:opacity-40';

interface FriendshipRow {
  heroName: string;
  friendship: FriendshipView | null;
}

export function HeroFriendship({ state, busy, onBefriend, onRecruit }: HeroFriendshipProps) {
  const copy = useCopy();
  const { HERO_COPY } = copy;
  const copyText = HERO_COPY.friendship;
  const active = state.friendships.filter((item) => !item.lost).length;
  const rows: FriendshipRow[] = [
    ...state.friendships.map((friendship) => ({ heroName: friendship.heroName, friendship })),
    ...state.unlocks
      .filter((name) => !state.friendships.some((item) => item.heroName === name))
      .map((heroName) => ({ heroName, friendship: null })),
  ];
  const famousFull = state.famousCount >= state.famousCap;

  return (
    <div role="武将面板-结交" className="flex shrink-0 flex-col gap-1 border-t border-line-soft pt-1.5">
      <p className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="font-semibold">{copyText.title}</span>
        <span role="武将面板-结交-数量" className="font-mono text-[11.5px] text-faint">
          {copyText.count(active, state.friendshipCap)}
        </span>
      </p>
      {rows.length === 0 ? (
        <p className="py-1 text-center text-[12px] text-faint">{copyText.empty}</p>
      ) : (
        <PagedList
          role="武将面板-结交列表"
          items={rows}
          keyOf={(row) => row.heroName}
          renderRow={(row) => {
            const friendship = row.friendship;
            const lost = friendship?.lost ?? false;
            const favor = friendship?.favor ?? 0;
            const canBefriend =
              !busy &&
              !lost &&
              favor < 100 &&
              (friendship?.todayLeft ?? 1) > 0 &&
              (friendship !== null || active < state.friendshipCap);
            const canRecruit = !busy && !lost && favor >= 100 && !famousFull;
            return (
              <div role={`武将面板-结交-${row.heroName}`} className="flex items-center gap-2 text-[11.5px]">
                <span className="w-[4.5rem] shrink-0 truncate font-semibold">{tName(row.heroName)}</span>
                <div className="flex min-w-0 flex-1 items-center gap-1.5" title={lost ? copyText.lost : copyText.favor(favor)}>
                  <div className="h-[3px] flex-1 overflow-hidden rounded bg-line-soft">
                    <div className="h-full bg-gold" style={{ width: `${Math.min(100, favor)}%` }} />
                  </div>
                  <span className="shrink-0 font-mono text-faint">{lost ? copyText.lost : copyText.favor(favor)}</span>
                </div>
                {!lost && friendship ? (
                  <span className="hidden shrink-0 text-faint @max-lg:hidden">{copyText.todayLeft(friendship.todayLeft)}</span>
                ) : null}
                <div className="flex shrink-0 items-center gap-1">
                  {lost ? null : (
                    <button
                      type="button"
                      role={`武将面板-结交按钮-${row.heroName}`}
                      disabled={!canBefriend}
                      title={copyText.cost(friendship?.cost ?? 0)}
                      onClick={() => onBefriend(row.heroName)}
                      className={`${smallBtn} border-accent text-accent disabled:border-line disabled:text-faint`}
                    >
                      {copyText.befriend}
                    </button>
                  )}
                  {lost ? null : (
                    <button
                      type="button"
                      role={`武将面板-招揽按钮-${row.heroName}`}
                      disabled={!canRecruit}
                      onClick={() => onRecruit(row.heroName)}
                      className={`${smallBtn} border-gold text-gold disabled:border-line disabled:text-faint`}
                    >
                      {copyText.recruit}
                    </button>
                  )}
                </div>
              </div>
            );
          }}
        />
      )}
    </div>
  );
}
