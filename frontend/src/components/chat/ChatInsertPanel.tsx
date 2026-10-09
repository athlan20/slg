// 聊天插入面板（AISLG-138）：从自己的武将 / 战报 / 城池里选一个，或手填坐标，放进输入框作为卡片草稿。
// 列表都是本账号的数据；坐标只做范围校验（0 到 999），归属与快照由服务端判定。

import { useEffect, useState } from 'react';
import type { CityRefView, HeroView, BattleReportView } from '../../api/protocol';
import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';
import type { ChatDraft } from '../../state/useChat';
import { PagedList } from '../ui/PagedList';
import { battleKindTitle } from '../BattleReportModal';

/** 世界地图边长（与服务端 WORLD_SIZE 一致）：坐标的合法范围是 0 到 WORLD_EDGE - 1 */
const WORLD_EDGE = 1000;

type InsertTab = 'hero' | 'report' | 'city' | 'coord';
const TABS: readonly InsertTab[] = ['hero', 'report', 'city', 'coord'];

const ROW_CLASS = 'flex w-full min-w-0 cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-[12.5px] hover:bg-panel-2';

export function ChatInsertPanel({ onPick, onClose }: { onPick: (draft: ChatDraft) => void; onClose: () => void }) {
  const { CHAT_COPY } = useCopy();
  const { session } = useGame();
  const [tab, setTab] = useState<InsertTab>('hero');
  const [coordError, setCoordError] = useState<string | null>(null);
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const heroes: HeroView[] = session.heroSession.state?.heroes ?? [];
  const reports: BattleReportView[] = session.world.battleReports ?? [];
  const cities: CityRefView[] = session.cityList.cities.filter((city) => city.x !== null && city.y !== null);

  // 打开对应页签时补拉一次（武将与战报列表未加载过才拉）
  useEffect(() => {
    if (tab === 'hero' && session.heroSession.state === null) {
      void session.heroSession.fetchHeroes();
    }
    if (tab === 'report' && session.world.battleReports === null) {
      void session.world.fetchBattleReports();
    }
  }, [tab]);

  const pickCoord = () => {
    const nx = Number(x);
    const ny = Number(y);
    const valid = [nx, ny].every((value) => Number.isInteger(value) && value >= 0 && value < WORLD_EDGE);
    if (x.trim() === '' || y.trim() === '' || !valid) {
      setCoordError(CHAT_COPY.insert.coordInvalid);
      return;
    }
    onPick({ card: { kind: 'coord', x: nx, y: ny }, label: `${CHAT_COPY.card.coordTitle} (${nx}, ${ny})` });
  };

  return (
    <div role="聊天-插入面板" className="flex h-[200px] min-h-0 flex-col gap-1.5 rounded border border-line bg-panel-2 p-2">
      <div role="聊天-插入面板-页签" className="flex shrink-0 items-center gap-1">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            role={`聊天-插入面板-页签-${item}`}
            aria-pressed={item === tab}
            onClick={() => setTab(item)}
            className={`cursor-pointer rounded border px-2 py-0.5 text-[12px] ${
              item === tab ? 'border-accent bg-accent-soft text-accent' : 'border-line text-dim hover:text-fg'
            }`}
          >
            {CHAT_COPY.insert.tabs[item]}
          </button>
        ))}
        <button
          type="button"
          role="聊天-插入面板-关闭按钮"
          onClick={onClose}
          className="ml-auto cursor-pointer px-1 text-[12px] text-faint hover:text-accent"
        >
          ✕
        </button>
      </div>

      {tab === 'hero' ? (
        <PagedList
          role="聊天-插入面板-武将列表"
          items={heroes}
          keyOf={(hero) => hero.id}
          empty={<p className="py-4 text-center text-[12px] text-faint">{CHAT_COPY.insert.emptyHero}</p>}
          renderRow={(hero) => (
            <button
              type="button"
              role="聊天-插入面板-武将"
              className={ROW_CLASS}
              onClick={() => onPick({ card: { kind: 'hero', heroId: hero.id }, label: `${CHAT_COPY.card.heroTag} ${hero.name}` })}
            >
              <span className="min-w-0 truncate font-semibold">{hero.name}</span>
              {hero.famous ? <span className="shrink-0 text-[10.5px] text-gold">{CHAT_COPY.card.heroTag}</span> : null}
              <span className="ml-auto shrink-0 font-mono text-accent">{CHAT_COPY.card.heroLevel(hero.level)}</span>
            </button>
          )}
        />
      ) : null}

      {tab === 'report' ? (
        <PagedList
          role="聊天-插入面板-战报列表"
          items={reports}
          keyOf={(report) => report.id}
          empty={<p className="py-4 text-center text-[12px] text-faint">{CHAT_COPY.insert.emptyReport}</p>}
          renderRow={(report) => (
            <button
              type="button"
              role="聊天-插入面板-战报"
              className={ROW_CLASS}
              onClick={() =>
                onPick({
                  card: { kind: 'report', reportId: report.id },
                  label: `${battleKindTitle(report.kind)} · ${report.won ? CHAT_COPY.card.reportWon : CHAT_COPY.card.reportLost}`,
                })
              }
            >
              <span className="min-w-0 truncate">{battleKindTitle(report.kind)}</span>
              <span className={`shrink-0 ${report.won ? 'text-gold' : 'text-warn'}`}>
                {report.won ? CHAT_COPY.card.reportWon : CHAT_COPY.card.reportLost}
              </span>
              <span className="ml-auto min-w-0 truncate font-mono text-[11px] text-faint">
                ({report.x}, {report.y})
              </span>
            </button>
          )}
        />
      ) : null}

      {tab === 'city' ? (
        <PagedList
          role="聊天-插入面板-城池列表"
          items={cities}
          keyOf={(city) => city.id}
          empty={<p className="py-4 text-center text-[12px] text-faint">{CHAT_COPY.insert.emptyCity}</p>}
          renderRow={(city) => (
            <button
              type="button"
              role="聊天-插入面板-城池"
              className={ROW_CLASS}
              onClick={() =>
                onPick({
                  card: { kind: 'city', cityId: city.id },
                  label: `${CHAT_COPY.card.cityTitle} ${city.name} (${city.x}, ${city.y})`,
                })
              }
            >
              <span className="min-w-0 truncate font-semibold">{city.name}</span>
              {city.isMain ? <span className="shrink-0 text-[10.5px] text-accent">主</span> : null}
              <span className="ml-auto shrink-0 font-mono text-[11px] text-faint">
                ({city.x}, {city.y})
              </span>
            </button>
          )}
        />
      ) : null}

      {tab === 'coord' ? (
        <div role="聊天-插入面板-坐标" className="flex flex-col gap-2 px-1 pt-1 text-[12.5px]">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-dim">
              {CHAT_COPY.insert.coordX}
              <input
                type="number"
                role="聊天-插入面板-坐标-X"
                min={0}
                max={WORLD_EDGE - 1}
                value={x}
                onChange={(event) => setX(event.target.value)}
                className="w-20 rounded border border-line bg-panel px-1.5 py-0.5 font-mono outline-none focus:border-accent"
              />
            </label>
            <label className="flex items-center gap-1 text-dim">
              {CHAT_COPY.insert.coordY}
              <input
                type="number"
                role="聊天-插入面板-坐标-Y"
                min={0}
                max={WORLD_EDGE - 1}
                value={y}
                onChange={(event) => setY(event.target.value)}
                className="w-20 rounded border border-line bg-panel px-1.5 py-0.5 font-mono outline-none focus:border-accent"
              />
            </label>
            <button
              type="button"
              role="聊天-插入面板-坐标-确认"
              onClick={pickCoord}
              className="cursor-pointer rounded border border-accent px-2 py-0.5 text-accent"
            >
              {CHAT_COPY.insert.coordUse}
            </button>
          </div>
          <p className="text-[11px] text-faint">{coordError ?? CHAT_COPY.insert.coordHint}</p>
        </div>
      ) : null}
    </div>
  );
}
