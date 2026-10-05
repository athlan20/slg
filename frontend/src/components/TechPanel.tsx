/** 科技卡（养成页右，v27 AISLG-77）：书院等级、六项科技（两列 3 行卡片：等级 / 当前效果 / 下一级成本·耗时·书院门槛 / 研究或取消）、
 *  进行中的研究（进度条 + 倒计时 + 取消）。科技账号共享、同一时间只研究一项；
 *  按钮禁用条件用 city 数据预判（书院 / 资源 / 已有研究），权威判定在服务端。卡片行文本都截断，悬停看全文。
 */

import { type CityView, type TechEntryView } from '../api/protocol';
import { costParts } from '../api/mapping';
import { formatDurationText } from '../api/format';
import { useCopy } from '../i18n/bundle';
import type { TechSession } from '../state/techSession';
import { useNow } from '../state/useNow';
import { Card } from './ui/Card';

interface TechPanelProps {
  city: CityView | null;
  session: TechSession;
}

function TechCard({ entry, city, researchBusy, researching, onResearch }: { entry: TechEntryView; city: CityView; researchBusy: boolean; researching: boolean; onResearch: () => void }) {
  const copy = useCopy();
  const { TECH_COPY } = copy;
  const next = entry.next;
  const academyOk = next !== null && city.levels.academy >= next.academyRequired;
  const parts = next ? costParts(next.cost, city.resources) : [];
  const lacking = parts.some((part) => part.insufficient);
  const blocked =
    next === null
      ? TECH_COPY.panel.maxed
      : !academyOk
        ? TECH_COPY.panel.needAcademy(next.academyRequired)
        : researchBusy
          ? TECH_COPY.panel.inProgressDisabled
          : lacking
            ? TECH_COPY.panel.insufficient
            : null;
  const effect = entry.kind === 'scouting' ? TECH_COPY.panel.scoutDetail(entry.level) : TECH_COPY.panel.currentEffect(entry.currentPercent);
  const nextLine = next
    ? TECH_COPY.panel.nextLine(next.level, parts.map((part) => `${part.label} ${part.value}`).join(' / '), formatDurationText(next.seconds))
    : TECH_COPY.panel.maxed;
  // 科技名以文案包为准（entry.label 是服务端下发的中文），role 保留服务端原词便于定位
  const label = TECH_COPY.names[entry.kind];
  return (
    <div
      role={`科技面板-条目-${entry.label}`}
      className={`flex min-h-0 min-w-0 flex-col gap-0.5 overflow-hidden rounded-[5px] border px-2 py-1 ${researching ? 'border-accent-dim bg-accent-soft' : 'border-line-soft bg-panel-2'}`}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className="min-w-0 truncate text-[13px] font-semibold">{label}</span>
        <span className="shrink-0 font-mono text-[11.5px] text-accent">{TECH_COPY.panel.levelTag(entry.level, entry.maxLevel)}</span>
      </div>
      <p role="科技面板-当前效果" className="truncate font-mono text-[11.5px] text-dim" title={`${effect}\n${entry.effect}`}>
        {effect}
      </p>
      <p className="truncate text-[11px] text-faint" title={TECH_COPY.effectText[entry.kind] ?? entry.effect}>
        {TECH_COPY.effectText[entry.kind] ?? entry.effect}
      </p>
      <p role="科技面板-下一级" className={`truncate text-[11px] ${lacking ? 'text-warn' : 'text-dim'}`} title={nextLine}>
        {nextLine}
      </p>
      <div className="mt-auto">
        {next ? (
          <button
            type="button"
            role="科技面板-研究按钮"
            disabled={blocked !== null}
            title={blocked ?? undefined}
            onClick={onResearch}
            className="btn w-full truncate"
          >
            {researching ? TECH_COPY.panel.researching : (blocked ?? TECH_COPY.panel.research)}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function TechPanel({ city, session }: TechPanelProps) {
  const copy = useCopy();
  const { TECH_COPY } = copy;
  const { tech, error, busy } = session;
  const research = tech?.research ?? null;
  const now = useNow(research !== null);
  const academy = city?.levels.academy ?? 0;

  return (
    <Card role="科技面板" title={TECH_COPY.panel.title} meta={<span role="科技面板-书院等级">{TECH_COPY.panel.academyMeta(academy)}</span>}>
      {academy === 0 ? (
        <p role="科技面板-无书院提示" className="line-clamp-2 shrink-0 text-[12px] text-warn" title={TECH_COPY.panel.noAcademy}>
          {TECH_COPY.panel.noAcademy}
        </p>
      ) : (
        <p className="truncate text-[11.5px] text-faint" title={TECH_COPY.panel.sharedHint}>
          {TECH_COPY.panel.sharedHint}
        </p>
      )}

      {research ? (
        <div role="科技面板-进行中" className="flex shrink-0 flex-col gap-1 rounded border border-accent-dim bg-accent-soft px-2 py-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-[12.5px]">
              {TECH_COPY.panel.researchingRow(TECH_COPY.names[research.tech], research.level, formatDurationText(Math.max(0, Math.ceil((Date.parse(research.dueAt) - now) / 1000))))}
            </span>
            <button
              type="button"
              role="科技面板-取消按钮"
              disabled={busy}
              onClick={() => void session.cancelResearch()}
              className="shrink-0 cursor-pointer rounded border border-warn px-1.5 text-[11.5px] text-warn disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? TECH_COPY.panel.cancelBusy : TECH_COPY.panel.cancel}
            </button>
          </div>
          <div className="h-1 overflow-hidden rounded bg-line-soft">
            <div
              className="h-full bg-accent"
              style={{ width: `${Math.min(100, Math.max(0, Math.round(((now - Date.parse(research.startedAt)) / Math.max(1, Date.parse(research.dueAt) - Date.parse(research.startedAt))) * 100)))}%` }}
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="科技面板-错误" className="shrink-0 truncate text-[12px] text-warn" title={error}>
          {error}
        </p>
      ) : null}

      <div role="科技面板-科技列表" className="grid min-h-0 flex-1 grid-cols-2 grid-rows-3 gap-1.5">
        {city && tech
          ? tech.techs.map((entry) => (
              <TechCard
                key={entry.kind}
                entry={entry}
                city={city}
                researchBusy={research !== null || busy}
                researching={research?.tech === entry.kind}
                onResearch={() => void session.startResearch(entry.kind)}
              />
            ))
          : null}
      </div>
    </Card>
  );
}
