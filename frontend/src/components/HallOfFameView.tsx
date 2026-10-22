/** 名人堂页签（v65，AISLG-134）：排行榜弹窗里的第二个视图。顶部赛季下拉 + 榜种页签 + 我的荣誉，
 *  下方是分页列表（服务端每页 20 条；界面按可用高度分页，翻到末页时点「更多」再向服务端要下一页）。只读、不滚动。
 *  没有任何已结束赛季时显示空态「第 1 季结束后，这里会留下各榜前列」。
 */

import { HALL_KINDS, type HallEntryView, type HallKind, type HallModelEntryView, type HonorView } from '../api/protocol';
import { formatReportTime } from '../api/format';
import { useCopy } from '../i18n/bundle';
import type { HallOfFameSession } from '../state/hallOfFame';
import { tName } from '../i18n/names';
import { PagedList } from './ui/PagedList';

// role 定位值取静态中文（与排行榜弹窗一致：role 不随界面语言变）
const KIND_ROLE_ZH: Record<HallKind, string> = {
  power: '力量',
  territory: '领土',
  plunder: '掠夺',
  model: '模型',
  arena: '竞技场',
  starTower: '将星塔',
};

const ROW_GRID = 'grid grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-2';

interface HallOfFameViewProps {
  hall: HallOfFameSession;
  honors: HonorView[];
}

export function HallOfFameView({ hall, honors }: HallOfFameViewProps) {
  const { HALL_COPY: COPY, SEASON_COPY, PAGED_COPY } = useCopy();
  const isModel = hall.kind === 'model';
  const kindLabel = (kind: HallKind): string => COPY.kinds[kind] ?? kind;
  const valueColumn = isModel ? COPY.modelValueColumn : kindLabel(hall.kind);
  const noSeasons = hall.loaded && !hall.loading && !hall.error && hall.seasons.length === 0;
  const honorsText = honors.length > 0 ? honors.map((honor) => honor.title).join(' · ') : SEASON_COPY.honorsNone;

  return (
    <div role="排行榜-名人堂" className="flex min-h-0 flex-1 flex-col gap-2">
      <div role="排行榜-名人堂-工具栏" className="flex shrink-0 flex-wrap items-center gap-1.5">
        <label className="flex min-w-0 items-center gap-1.5 text-[12px] text-faint">
          <span className="shrink-0">{COPY.seasonLabel}</span>
          <select
            role="排行榜-名人堂-赛季选择"
            value={hall.seasonId ?? ''}
            disabled={hall.seasons.length === 0}
            onChange={(event) => hall.selectSeason(Number(event.target.value))}
            className="max-w-[16rem] cursor-pointer truncate rounded border border-line bg-panel-2 px-1.5 py-0.5 text-[12.5px] text-fg disabled:cursor-not-allowed disabled:opacity-50"
          >
            {hall.seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
                {season.endedAt ? ` · ${COPY.seasonEnded(formatReportTime(season.endedAt))}` : ''}
              </option>
            ))}
          </select>
        </label>
        <div role="排行榜-名人堂-榜种页签" className="flex flex-wrap items-center gap-1">
          {HALL_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              role={`排行榜-名人堂-榜种页签-${KIND_ROLE_ZH[kind]}`}
              disabled={noSeasons}
              onClick={() => hall.selectKind(kind)}
              className={`cursor-pointer rounded border px-2 py-0.5 text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                hall.kind === kind ? 'border-accent bg-accent-soft text-accent' : 'border-line text-dim hover:text-fg'
              }`}
            >
              {kindLabel(kind)}
            </button>
          ))}
        </div>
      </div>

      <p role="排行榜-名人堂-我的荣誉" title={honorsText} className="shrink-0 truncate text-[12px] text-dim">
        <span className="text-faint">{SEASON_COPY.honorsLabel}：</span>
        {honorsText}
      </p>

      {noSeasons ? (
        <p role="排行榜-名人堂-空态" className="py-8 text-center text-[13px] text-faint">
          {COPY.emptyNoSeason}
        </p>
      ) : hall.error ? (
        <p role="排行榜-名人堂-错误" className="py-8 text-center text-[13px] text-st-error">
          {COPY.loadFailed}
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={`${ROW_GRID} shrink-0 px-1 text-[12px] text-faint`}>
            <span>{COPY.rankColumn}</span>
            <span>{isModel ? COPY.modelColumn : COPY.playerColumn}</span>
            <span className="text-right">{valueColumn}</span>
          </div>
          {isModel ? (
            <PagedList<HallModelEntryView>
              role="排行榜-名人堂-列表"
              items={hall.modelEntries}
              keyOf={(entry) => entry.modelId}
              gap={2}
              gapClass="gap-0.5"
              moreLabel={COPY.more}
              hasMore={hall.hasMore}
              loadingMore={hall.loading}
              onLoadMore={hall.loadMore}
              empty={<p className="py-6 text-center text-[13px] text-faint">{hall.loading ? PAGED_COPY.loading : COPY.emptyRows}</p>}
              renderRow={(entry) => (
                <div role="排行榜-名人堂-条目" className={`${ROW_GRID} border-t border-line-soft px-1 py-1 text-[13px] text-dim`}>
                  <span className="font-mono">{entry.rank}</span>
                  <span className="min-w-0 truncate">
                    <span className="text-fg">{entry.label}</span>
                    <span className="ml-1.5 text-faint">{COPY.modelPlayers(entry.players)}</span>
                    {entry.topPlayer ? <span className="ml-1.5 text-faint">{entry.topPlayer.username}</span> : null}
                  </span>
                  <span className="font-mono">{entry.value}</span>
                </div>
              )}
            />
          ) : (
            <PagedList<HallEntryView>
              role="排行榜-名人堂-列表"
              items={hall.entries}
              keyOf={(entry) => `${entry.rank}-${entry.accountId ?? entry.username}`}
              gap={2}
              gapClass="gap-0.5"
              moreLabel={COPY.more}
              hasMore={hall.hasMore}
              loadingMore={hall.loading}
              onLoadMore={hall.loadMore}
              empty={<p className="py-6 text-center text-[13px] text-faint">{hall.loading ? PAGED_COPY.loading : COPY.emptyRows}</p>}
              renderRow={(entry) => (
                <div role="排行榜-名人堂-条目" className={`${ROW_GRID} border-t border-line-soft px-1 py-1 text-[13px] text-dim`}>
                  <span className="font-mono">{entry.rank}</span>
                  <span className="min-w-0 truncate">
                    <span className="text-fg">{entry.username}</span>
                    <span className="ml-1.5 text-faint">{tName(entry.cityName ?? '')}</span>
                    {entry.agentModel ? (
                      <span className="tag ml-1.5" title={COPY.modelRule}>
                        {entry.agentModel} · {COPY.agentModelBadge}
                      </span>
                    ) : null}
                  </span>
                  <span className="font-mono">{entry.value}</span>
                </div>
              )}
            />
          )}
        </div>
      )}
    </div>
  );
}
