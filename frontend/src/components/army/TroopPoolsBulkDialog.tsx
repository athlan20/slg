/** 伤兵营「全部城池一键处理」的确认框与结果摘要（v88，AISLG-218）：站内 Modal（不用浏览器原生 confirm）。
 *  确认阶段一城一行「城名（主）· 兵种数量 · 花费」（放弃 / 释放写「免费，不返还任何东西」，
 *  「全部劝回」里断粮中的城标「跳过：断粮中」且不列入处理），最下面合计花费；最多 11 行（账号上限
 *  1 主城 + 10 分城，共 11 座城），单行不换行、不出现滚动条，手机宽度下溢出省略。
 *  确认后按最早过期时间从早到晚、一座城一座城地串行发 RESTORE_TROOPS / RELEASE_TROOPS（整池 + cityId），
 *  每城独立成败；结束后同一弹窗变成逐城结果摘要：成功 / 跳过仍是一行，失败拆两行（第一行「城名（主）· 失败」，
 *  第二行缩进放完整的人读原因，含资源缺口数字，允许换行，不看悬停也能读到，v88 AISLG-219）。
 *  资源与人口仍是各城用各城的（不跨城调资源，服务端规则不变）。
 */

import { useState } from 'react';
import type { Resources, TroopKind, TroopPoolKind } from '../../api/protocol';
import { poolCostText, poolTroopsText } from '../../api/poolText';
import { useCopy } from '../../i18n/bundle';
import { Modal } from '../ui/Modal';

/** 确认框里的一城：整池 troops、花费与是否跳过（断粮中不能劝回） */
export interface BulkRow {
  cityId: string;
  name: string;
  isMain: boolean;
  troops: Partial<Record<TroopKind, number>>;
  /** 花费（治疗 / 招降 / 劝回）；放弃 / 释放为 null（免费） */
  cost: Resources | null;
  /** 招降另扣人口；其余为 0 */
  populationCost: number;
  /** 断粮中跳过（只有「全部劝回」会命中） */
  skipped: boolean;
  /** 该城池子最早一批的过期时刻（调用方已按它从早到晚排序） */
  earliestExpireAt: string | null;
}

interface TroopPoolsBulkDialogProps {
  pool: TroopPoolKind;
  mode: 'restore' | 'release';
  /** 要处理与跳过的城，按最早过期时间从早到晚排好（跳过的不发请求） */
  rows: BulkRow[];
  /** 逐城动作：cityId 必带（缺省 = 当前城，不是这里要的行为） */
  onRestore: (pool: TroopPoolKind, troops: Partial<Record<TroopKind, number>>, cityId?: string) => Promise<string | null>;
  onRelease: (pool: TroopPoolKind, troops: Partial<Record<TroopKind, number>>, cityId?: string) => Promise<string | null>;
  onClose: () => void;
  /** 处理结束（无论成败）：调用方据此刷新全城池子与本城状态 */
  onFinished: () => void;
}

interface BulkResult extends BulkRow {
  ok: boolean;
  /** 失败的人读原因（成功为 null） */
  reason: string | null;
}

/** 合计花费：只算要处理的城，五种资源分别累加（放弃 / 释放全为 0） */
function sumCost(rows: BulkRow[]): Resources {
  const total: Resources = { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 };
  for (const row of rows) {
    if (!row.cost) {
      continue;
    }
    for (const key of Object.keys(total) as Array<keyof Resources>) {
      total[key] += row.cost[key] ?? 0;
    }
  }
  return total;
}

export function TroopPoolsBulkDialog({ pool, mode, rows, onRestore, onRelease, onClose, onFinished }: TroopPoolsBulkDialogProps) {
  const copy = useCopy();
  const A = copy.ARMY_COPY.pools.poolsAll;
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const pending = rows.filter((row) => !row.skipped);
  const skippedCount = rows.length - pending.length;

  /** 串行处理：按 rows 的顺序（最早过期在前），每城独立成败，一城失败不影响其他城 */
  async function run(): Promise<void> {
    if (busy) {
      return;
    }
    setBusy(true);
    const collected: BulkResult[] = [];
    for (const row of pending) {
      const failure = mode === 'restore' ? await onRestore(pool, row.troops, row.cityId) : await onRelease(pool, row.troops, row.cityId);
      collected.push({ ...row, ok: failure === null, reason: failure });
    }
    setBusy(false);
    const done = new Map(collected.map((result) => [result.cityId, result]));
    setResults(rows.map((row) => done.get(row.cityId) ?? { ...row, ok: true, reason: null }));
    onFinished();
  }

  /** 确认阶段的一行：城名（主）· 兵种数量 · 花费 / 跳过 */
  const confirmLine = (row: BulkRow): string => {
    const head = A.rowHost(row.name, row.isMain);
    if (row.skipped) {
      return `${head}${A.rowJoin}${A.rowSkippedStarving}`;
    }
    const costText = row.cost === null ? A.rowFree : poolCostText(row.cost) + (row.populationCost > 0 ? ` ${A.rowPopulation(row.populationCost)}` : '');
    return `${head}${A.rowJoin}${poolTroopsText(row.troops)}${A.rowJoin}${costText}`;
  };

  /** 结果行第一行：只写城名与成败（失败原因单独一行，不挤进这里，v88 AISLG-219） */
  const resultLine = (result: BulkResult): string =>
    `${A.rowHost(result.name, result.isMain)}${A.rowJoin}${
      result.skipped ? A.rowSkippedStarving : result.ok ? A.resultSuccess : A.resultFailed
    }`;

  const rowClass = 'truncate text-[12px] leading-tight';
  /** 每城的行块 role（确认阶段与结果摘要沿用同一个，e2e 靠它定位城池） */
  const rowRole = (name: string): string => `伤兵营-全城确认框-行-${name}`;

  return (
    <Modal
      role="伤兵营-全城确认框"
      title={results === null ? (mode === 'restore' ? A.dialogTitleRestore : A.dialogTitleRelease) : A.resultTitle}
      size="sm"
      accent="none"
      onClose={() => (busy ? undefined : onClose())}
    >
      {results === null ? (
        <>
          <div role="伤兵营-全城确认框-城池列表" className="flex min-w-0 flex-col gap-0.5">
            {rows.map((row) => (
              <p key={row.cityId} role={rowRole(row.name)} className={`${rowClass} text-dim`} title={confirmLine(row)}>
                {confirmLine(row)}
              </p>
            ))}
          </div>
          <div role="伤兵营-全城确认框-合计" className="mt-1 border-t border-line-soft pt-1 font-mono text-[12px] text-dim">
            {mode === 'release'
              ? A.totalFree
              : `${A.totalCost(poolCostText(sumCost(pending)))}${skippedCount > 0 ? A.totalSkipped(skippedCount) : ''}`}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" role="伤兵营-全城确认框-返回按钮" className="btn" disabled={busy} onClick={onClose}>
              {A.cancel}
            </button>
            <button type="button" role="伤兵营-全城确认框-确认按钮" className="btn px-3" disabled={busy || pending.length === 0} onClick={() => void run()}>
              {busy ? A.busy : A.confirm}
            </button>
          </div>
        </>
      ) : (
        <>
          <div role="伤兵营-全城结果摘要" className="flex max-h-[calc(100dvh-240px)] min-w-0 flex-col gap-0.5 overflow-y-auto">
            {results.map((result) =>
              result.ok || result.skipped ? (
                <p key={result.cityId} role={rowRole(result.name)} className={`${rowClass} text-dim`} title={resultLine(result)}>
                  {resultLine(result)}
                </p>
              ) : (
                <div key={result.cityId} role={rowRole(result.name)} className="flex min-w-0 flex-col text-st-error">
                  <p className={rowClass} title={resultLine(result)}>
                    {resultLine(result)}
                  </p>
                  {/* 失败原因完整换行显示（含资源缺口数字），触屏也能看到，不靠 title 悬停 */}
                  <p
                    role={`伤兵营-全城结果摘要-原因-${result.name}`}
                    className="whitespace-normal break-words pl-3 text-[11px] leading-snug"
                  >
                    {result.reason ?? ''}
                  </p>
                </div>
              ),
            )}
          </div>
          <div role="伤兵营-全城结果摘要-统计" className="mt-1 border-t border-line-soft pt-1 text-[12px] text-dim">
            {results.every((result) => result.ok)
              ? A.resultAllOk(results.filter((result) => !result.skipped).length)
              : A.resultSummary(
                  results.filter((result) => result.ok && !result.skipped).length,
                  results.filter((result) => !result.ok).length,
                )}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" role="伤兵营-全城结果摘要-知道了" className="btn px-3" onClick={onClose}>
              {A.done}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}