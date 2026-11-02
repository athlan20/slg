/** 伤兵营「全城汇总 + 一键处理」的挂载块（v88，AISLG-218）：表单里只放两处挂载点——
 *  汇总行（池子页签下方 `TroopPoolsAllCitiesSummary`）与一键按钮组（提交按钮组旁 `TroopPoolsAllCities`）。
 *  汇总行 = 当前页签的「全部城池合计」：数量之和、有该池子的城数、各城最早过期的最小值（不足 6 小时标红），
 *  全账号该池子为空显示「全部城池：无」。一键按钮按池子给出（伤兵：全部治疗 / 全部放弃；俘虏：全部招降 /
 *  全部释放；逃兵：只有全部劝回），该池子全账号为空时置灰。点按钮弹站内确认框（TroopPoolsBulkDialog），
 *  里面按「最早过期时间从早到晚、一座城一座城地串行」逐城发 RESTORE_TROOPS / RELEASE_TROOPS（整池 + cityId）。
 */

import { useState } from 'react';
import {
  CAPTIVE_RECRUIT_COST_PERCENT,
  DESERTER_RECALL_COST_PERCENT,
  HEAL_COST_PERCENT,
  TROOP_INFO,
  TROOP_KINDS,
  restoreCostPreview,
  type AccountTroopPoolsCityView,
  type TroopKind,
  type TroopPoolKind,
} from '../../api/protocol';
import { formatDurationText } from '../../api/format';
import { useCopy } from '../../i18n/bundle';
import {
  cityPoolView,
  cityStarvingNow,
  poolExpiringSoon,
  poolRemainSeconds,
  poolSumOf,
  poolTroopsOf,
} from '../../state/troopPoolsAllCities';
import type { ConnectionStatus } from '../../state/useGameSession';
import { TroopPoolsBulkDialog, type BulkRow } from './TroopPoolsBulkDialog';

/** 治疗 / 招降 / 劝回的花费比例（沿用现有常量，不新造数值） */
function costPercentOf(pool: TroopPoolKind): number {
  return pool === 'wounded' ? HEAL_COST_PERCENT : pool === 'captive' ? CAPTIVE_RECRUIT_COST_PERCENT : DESERTER_RECALL_COST_PERCENT;
}

/** 招降另扣人口 = Σ 单兵人口 × 数量（与表单 / 服务端同口径）；其余池子为 0 */
function populationCostOf(pool: TroopPoolKind, troops: Partial<Record<TroopKind, number>>): number {
  if (pool !== 'captive') {
    return 0;
  }
  return TROOP_KINDS.reduce((sum, kind) => sum + (troops[kind] ?? 0) * TROOP_INFO[kind].population, 0);
}

/** 排序键：最早过期时刻升序（池子有兵必有到期，空值兜底排最后） */
function sortKey(earliestExpireAt: string | null): number {
  return earliestExpireAt === null ? Number.MAX_SAFE_INTEGER : Date.parse(earliestExpireAt);
}

interface SummaryProps {
  cities: AccountTroopPoolsCityView[] | null;
  pool: TroopPoolKind;
}

/** 汇总行（池子页签下方一行小字）：全部城池合计 + 最早过期（不足 6 小时红色）；全账号为空显示「无」 */
export function TroopPoolsAllCitiesSummary({ cities, pool }: SummaryProps) {
  const { ARMY_COPY } = useCopy();
  const P = ARMY_COPY.pools;
  const A = P.poolsAll;
  const { total, citiesWith, earliestExpireAt } = poolSumOf(cities, pool);
  const label = pool === 'wounded' ? P.poolWounded : pool === 'captive' ? P.poolCaptives : P.poolDeserters;
  if (total <= 0) {
    return (
      <p role="伤兵营-全城汇总" className="shrink-0 px-1 text-[10.5px] leading-tight text-faint">
        {A.empty}
      </p>
    );
  }
  const hot = poolExpiringSoon(earliestExpireAt);
  return (
    <p role="伤兵营-全城汇总" className="flex min-w-0 flex-wrap items-baseline gap-x-1 px-1 text-[10.5px] leading-tight text-dim">
      <span role="伤兵营-全城汇总-合计">{A.summary(label, total, citiesWith)}</span>
      {earliestExpireAt !== null ? (
        <span role="伤兵营-全城汇总-最早过期" className={hot ? 'font-semibold text-st-error' : 'text-faint'}>
          {A.earliest(formatDurationText(poolRemainSeconds(earliestExpireAt)))}
        </span>
      ) : null}
    </p>
  );
}

interface AllCitiesProps extends SummaryProps {
  connection: ConnectionStatus;
  onRestore: (pool: TroopPoolKind, troops: Partial<Record<TroopKind, number>>, cityId?: string) => Promise<string | null>;
  onRelease: (pool: TroopPoolKind, troops: Partial<Record<TroopKind, number>>, cityId?: string) => Promise<string | null>;
  /** 一键处理结束（成功或失败都已刷新）：调用方重拉全城池子 + 对齐本城状态 */
  onFinished: () => void;
}

type BulkMode = 'restore' | 'release';

/** 一键按钮组（提交按钮组旁）：按池子给「全部治疗 / 全部放弃 / 全部招降 / 全部释放 / 全部劝回」 */
export function TroopPoolsAllCities({ cities, pool, connection, onRestore, onRelease, onFinished }: AllCitiesProps) {
  const { ARMY_COPY } = useCopy();
  const A = ARMY_COPY.pools.poolsAll;
  const [bulk, setBulk] = useState<{ mode: BulkMode; rows: BulkRow[] } | null>(null);
  const total = poolSumOf(cities, pool).total;
  const disabled = connection !== 'online' || cities === null || total <= 0;

  /** 组装确认框的一城一行：整池 troops + 花费预览；断粮中的城在「全部劝回」里标跳过 */
  function openDialog(mode: BulkMode): void {
    const percent = costPercentOf(pool);
    const rows: BulkRow[] = [];
    for (const city of cities ?? []) {
      const view = cityPoolView(city, pool);
      const troops = poolTroopsOf(view);
      if (Object.keys(troops).length === 0) {
        continue;
      }
      const skipped = pool === 'deserter' && mode === 'restore' && cityStarvingNow(city);
      rows.push({
        cityId: city.cityId,
        name: city.name,
        isMain: city.isMain,
        troops,
        cost: mode === 'restore' ? restoreCostPreview(troops, percent) : null,
        populationCost: mode === 'restore' ? populationCostOf(pool, troops) : 0,
        skipped,
        earliestExpireAt: view.earliestExpireAt,
      });
    }
    // 从早到晚：最早一批快过期的城先处理（跳过的城不发请求，排序里照常出现）
    rows.sort((left, right) => sortKey(left.earliestExpireAt) - sortKey(right.earliestExpireAt));
    setBulk({ mode, rows });
  }

  const restoreLabel = pool === 'wounded' ? A.healAll : pool === 'captive' ? A.recruitAll : A.recallAll;
  const releaseLabel = pool === 'wounded' ? A.abandonAll : A.releaseAll;

  return (
    <>
      <div role="伤兵营-全城按钮组" className="flex shrink-0 gap-1">
        <button
          type="button"
          role={`伤兵营-全城按钮-${restoreLabel}`}
          className="btn px-1.5 py-1.5 text-[11.5px]"
          disabled={disabled}
          onClick={() => openDialog('restore')}
        >
          {restoreLabel}
        </button>
        {pool !== 'deserter' ? (
          <button
            type="button"
            role={`伤兵营-全城按钮-${releaseLabel}`}
            className="btn px-1.5 py-1.5 text-[11.5px]"
            disabled={disabled}
            onClick={() => openDialog('release')}
          >
            {releaseLabel}
          </button>
        ) : null}
      </div>
      {bulk !== null ? (
        <TroopPoolsBulkDialog
          pool={pool}
          mode={bulk.mode}
          rows={bulk.rows}
          onRestore={onRestore}
          onRelease={onRelease}
          onClose={() => setBulk(null)}
          onFinished={onFinished}
        />
      ) : null}
    </>
  );
}