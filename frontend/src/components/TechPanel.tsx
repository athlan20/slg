/** 科技卡（养成页右，v27 AISLG-77；v72 AISLG-192 扩到十六项）：
 *  书院等级、进行中的研究（进度条 + 倒计时 + 取消）、按「发展 / 军事」两栏排列的 16 项科技。
 *  每项一行：科技名 + 「？」/ 等级 / 研究按钮，16 项在一屏内、不出滚动条。
 *  「？」悬停或点按弹浮窗，分行看当前效果、科技作用、下一级成本·耗时·书院门槛（AISLG-188）。
 *  科技账号共享、同一时间只研究一项；按钮禁用条件用 city 数据预判（书院 / 资源 / 已有研究），权威判定在服务端。
 */

import { type CityView, type TechCategory, type TechEntryView } from '../api/protocol';
import { costParts } from '../api/mapping';
import { formatDurationText } from '../api/format';
import { useCopy } from '../i18n/bundle';
import type { TechSession } from '../state/techSession';
import { useNow } from '../state/useNow';
import { Card } from './ui/Card';
import { HelpTip } from './ui/HelpTip';

interface TechPanelProps {
  city: CityView | null;
  session: TechSession;
}

/** 服务端下发的归类；老服务端没有 category 时按已知的军事项兜底 */
const MILITARY_KINDS = new Set(['marching', 'scouting', 'defense', 'drill', 'combat', 'protection', 'riding', 'archery']);

function categoryOf(entry: TechEntryView): TechCategory {
  return entry.category ?? (MILITARY_KINDS.has(entry.kind) ? 'military' : 'development');
}

const CATEGORIES: TechCategory[] = ['development', 'military'];

function TechRow({ entry, city, researchBusy, researching, onResearch }: { entry: TechEntryView; city: CityView; researchBusy: boolean; researching: boolean; onResearch: () => void }) {
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
  // 科技名以文案包为准（entry.label 是服务端下发的中文），role 保留服务端原词便于定位
  const label = TECH_COPY.names[entry.kind];
  const costText = parts.map((part) => `${part.label} ${part.value}`).join(' / ');
  return (
    <div
      role={`科技面板-条目-${entry.label}`}
      title={blocked ?? undefined}
      className={`flex min-h-0 flex-1 items-center gap-1 overflow-hidden rounded-[5px] border px-1.5 ${researching ? 'border-accent-dim bg-accent-soft' : 'border-line-soft bg-panel-2'}`}
    >
      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{label}</span>
      <HelpTip
        triggerRole="科技面板-说明图标"
        popRole="科技面板-说明浮窗"
        ariaLabel={TECH_COPY.panel.helpAria(label)}
      >
        <p role="科技面板-当前效果">
          <span className="text-faint">{TECH_COPY.panel.rowEffect}</span>
          {effect}
        </p>
        <p role="科技面板-科技作用">
          <span className="text-faint">{TECH_COPY.panel.rowTech}</span>
          {TECH_COPY.effectText[entry.kind] ?? entry.effect}
        </p>
        {next ? (
          <p role="科技面板-下一级" className="text-dim">
            <span className="text-faint">{TECH_COPY.panel.rowNext(next.level)}</span>
            <span className={lacking ? 'text-warn' : undefined}>{costText}</span>
            {` · ${TECH_COPY.panel.duration(formatDurationText(next.seconds))}`}
          </p>
        ) : (
          <p role="科技面板-下一级" className="text-dim">
            {TECH_COPY.panel.maxed}
          </p>
        )}
        {next && !academyOk ? (
          <p role="科技面板-书院门槛" className="text-warn">
            {TECH_COPY.panel.needAcademy(next.academyRequired)}
          </p>
        ) : null}
      </HelpTip>
      <span role="科技面板-等级" className="shrink-0 font-mono text-[10.5px] text-accent">
        {TECH_COPY.panel.levelTag(entry.level, entry.maxLevel)}
      </span>
      {next ? (
        <button
          type="button"
          role="科技面板-研究按钮"
          disabled={blocked !== null}
          title={blocked ?? undefined}
          onClick={onResearch}
          className="btn shrink-0 px-1.5 text-[10.5px] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {researching ? '…' : TECH_COPY.panel.researchShort}
        </button>
      ) : (
        <span className="shrink-0 text-[10.5px] text-faint">{TECH_COPY.panel.maxed}</span>
      )}
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
      <p
        role={academy === 0 ? '科技面板-无书院提示' : '科技面板-共享提示'}
        className={`line-clamp-1 shrink-0 text-[11px] ${academy === 0 ? 'text-warn' : 'text-faint'}`}
        title={academy === 0 ? TECH_COPY.panel.noAcademy : TECH_COPY.panel.sharedHint}
      >
        {academy === 0 ? TECH_COPY.panel.noAcademy : TECH_COPY.panel.sharedHint}
      </p>

      {research ? (
        <div role="科技面板-进行中" className="flex shrink-0 flex-col gap-1 rounded border border-accent-dim bg-accent-soft px-2 py-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-[12px]">
              {TECH_COPY.panel.researchingRow(TECH_COPY.names[research.tech], research.level, formatDurationText(Math.max(0, Math.ceil((Date.parse(research.dueAt) - now) / 1000))))}
            </span>
            <button
              type="button"
              role="科技面板-取消按钮"
              disabled={busy}
              onClick={() => void session.cancelResearch()}
              className="shrink-0 cursor-pointer rounded border border-warn px-1.5 text-[11px] text-warn disabled:cursor-not-allowed disabled:opacity-40"
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

      <div role="科技面板-科技列表" className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-hidden">
        {city && tech
          ? CATEGORIES.map((category) => (
              <div role={`科技面板-${category}-栏`} key={category} className="flex min-h-0 min-w-0 flex-col gap-0.5">
                <p role={`科技面板-${category}-标题`} className="shrink-0 text-[11px] font-semibold text-faint">
                  {TECH_COPY.panel.category[category]}
                </p>
                <div role={`科技面板-${category}-列表`} className="flex min-h-0 flex-1 flex-col gap-0.5">
                  {tech.techs.filter((entry) => categoryOf(entry) === category).map((entry) => (
                    <TechRow
                      key={entry.kind}
                      entry={entry}
                      city={city}
                      researchBusy={research !== null || busy}
                      researching={research?.tech === entry.kind}
                      onResearch={() => void session.startResearch(entry.kind)}
                    />
                  ))}
                </div>
              </div>
            ))
          : null}
      </div>
    </Card>
  );
}