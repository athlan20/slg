// 探索简报卡片（AISLG-224 第五步）：地图页右上角的一张卡片，列出新区块的计数与最多 10 个坐标（点击跳转）。
import { useCopy } from '../../i18n/bundle';
import { dismissExplorationReport, useExplorationReports } from '../../state/explorationReport';

export function WorldExplorationReport({ onCenter }: { onCenter: (x: number, y: number) => void }) {
  const copy = useCopy();
  const F = copy.EXTRA_MAP.fog;
  const [top] = useExplorationReports();
  if (!top) {
    return null;
  }
  return (
    <section role="世界地图-探索简报" className="pointer-events-auto absolute right-2 top-2 z-20 w-[min(18rem,calc(100%-1rem))] rounded-md border border-line bg-panel p-3 text-xs shadow-lg">
      <header className="mb-1 flex items-center justify-between gap-2">
        <strong className="text-sm">{F.reportTitle}</strong>
        <button type="button" role="世界地图-探索简报-关闭" className="rounded px-1 text-muted hover:text-ink" onClick={() => dismissExplorationReport(top.eventId)}>
          {F.reportClose}
        </button>
      </header>
      <p className="mb-2 text-muted">{F.reportSummary(top.chunks)}</p>
      <p className="mb-1 text-muted">{F.reportCells}</p>
      <ul className="flex flex-col gap-1">
        {top.cells.map((cell) => (
          <li key={`${cell.x},${cell.y}`}>
            <button
              type="button"
              role="世界地图-探索简报-坐标"
              data-x={cell.x}
              data-y={cell.y}
              className="w-full rounded px-1 py-0.5 text-left hover:bg-panel-2"
              onClick={() => onCenter(cell.x, cell.y)}
            >
              ({cell.x}, {cell.y}) · {F.reportKind[cell.kind]}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
