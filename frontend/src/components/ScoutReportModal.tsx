/** 侦察报告弹窗（v23，AISLG-62）：把一份 ScoutIntel 快照渲染成报告。
 *  内容：守军构成与总战力、与我方城内驻军的战力对比提示（打得过 / 五五开 / 打不过）、
 *  城墙减伤、NPC 城可掠夺库存、占领者、侦察时间（相对时间，提醒情报可能过时）。
 *  打开入口收敛在 state/scoutReportModal（useScoutReportModal().openScoutReport），
 *  事件流 / 战报面板 / 地块详情三处共用。
 */

import { Modal } from './ui/Modal';
import { TROOP_KINDS, TROOP_POWER, type ArmyCounts, type CityView, type ScoutIntel } from '../api/protocol';
import { getCopy, useCopy } from '../i18n/bundle';
import { tName } from '../i18n/names';

interface ScoutReportModalProps {
  intel: ScoutIntel;
  /** 我方城池现状（战力对比用；未就绪时不显示对比行） */
  city: CityView | null;
  onClose: () => void;
}

function armyTotal(army: ArmyCounts): number {
  return TROOP_KINDS.reduce((sum, kind) => sum + Math.max(0, army[kind] ?? 0), 0);
}

function armyPower(army: ArmyCounts): number {
  return TROOP_KINDS.reduce((sum, kind) => sum + Math.max(0, army[kind] ?? 0) * TROOP_POWER[kind], 0);
}

/** 相对时间：「X 分钟前」（超过 1 小时显示「X 小时 Y 分钟前」，超过 1 天显示「X 天前」） */
export function relativeAgo(iso: string, now: number): string {
  const { COPY, EXTRA_PANEL } = getCopy();
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) {
    return '';
  }
  const diff = Math.max(0, now - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return EXTRA_PANEL.scoutReport.justNow;
  }
  if (minutes < 60) {
    return COPY.scoutReport.minutesAgo(minutes);
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return COPY.scoutReport.hoursAgo(hours, minutes % 60);
  }
  return COPY.scoutReport.daysAgo(Math.floor(hours / 24));
}

/** 战力对比结论：比值阈值给人读判断（粗估，城墙减伤以乘数近似折算进守方战力） */
function verdictOf(myPower: number, defenderPower: number, wallPercent: number): { text: string; tone: 'ok' | 'warn' | 'error' } {
  const { COPY } = getCopy();
  const adjusted = defenderPower * (1 + wallPercent / 100);
  const ratio = adjusted > 0 ? myPower / adjusted : Infinity;
  if (ratio >= 1.5) {
    return { text: COPY.scoutReport.verdictSafe(Math.round(ratio * 10) / 10), tone: 'ok' };
  }
  if (ratio >= 1) {
    return { text: COPY.scoutReport.verdictEven, tone: 'warn' };
  }
  return { text: COPY.scoutReport.verdictDanger, tone: 'error' };
}

export function ScoutReportModal({ intel, city, onClose }: ScoutReportModalProps) {
  const copy = useCopy();
  const { COPY, RESOURCE_LABEL, TECH_COPY, TERRAIN_LABEL, TROOP_LABEL } = copy;
  const now = Date.now();
  const garrisonRows = TROOP_KINDS.filter((kind) => (intel.garrison[kind] ?? 0) > 0);
  // 侦察科技决定详细度（v27 AISLG-77）：rough 只给总兵力范围、kinds 兵种近似、缺省 / exact 精确
  const precision = intel.detail ?? 'exact';
  const totalRange = intel.garrisonTotal ?? null;
  const garrisonTotal = precision === 'rough' && totalRange ? Math.round((totalRange.min + totalRange.max) / 2) : armyTotal(intel.garrison);
  const garrisonPower = armyPower(intel.garrison);
  const myPower = city ? armyPower(city.army) : null;
  const myTotal = city ? armyTotal(city.army) : null;
  const verdict = myPower !== null ? verdictOf(myPower, garrisonPower, intel.wallDefensePercent) : null;
  const stockKeys = (Object.keys(RESOURCE_LABEL) as Array<keyof typeof RESOURCE_LABEL>).filter((key) => (intel.npcStock?.[key] ?? 0) > 0);
  const h4 = 'mb-0.5 text-[13px] font-semibold text-dim';

  return (
    <Modal
      role="侦察报告弹窗"
      title={
        <>
          <span className="tag actor-system mr-2">{COPY.scoutReport.title}</span>
          {TERRAIN_LABEL[intel.terrain]}
          {intel.level > 0 ? ` Lv${intel.level}` : ''}
          {intel.owner ? COPY.scoutReport.ownerRow(`${intel.owner.username} · ${tName(intel.owner.cityName)}`) : ''}
          <span className="ml-2 font-mono text-[12px] font-normal text-faint">
            {COPY.scoutReport.location(intel.x, intel.y)} · {COPY.scoutReport.scoutedAtAgo(relativeAgo(intel.scoutedAt, now))}
          </span>
        </>
      }
      onClose={onClose}
    >
      <div role="侦察报告弹窗-守军">
        <h4 className={h4}>{COPY.scoutReport.garrisonTitle}</h4>
        {precision !== 'exact' && totalRange ? (
          <p role="侦察报告弹窗-精度提示" className="mb-1 text-[12px] text-warn">
            {precision === 'rough' ? TECH_COPY.scout.rough(totalRange.min, totalRange.max) : TECH_COPY.scout.kinds(totalRange.min, totalRange.max)}
          </p>
        ) : null}
        {garrisonRows.length === 0 ? (
          precision === 'rough' ? null : <p className="text-[12px] text-faint">{COPY.scoutReport.garrisonNone}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            {garrisonRows.map((kind) => (
              <li key={kind} className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="text-dim">{TROOP_LABEL[kind].name}</span>
                <span className="font-mono">
                  {precision === 'kinds' ? TECH_COPY.scout.approx : ''}×{intel.garrison[kind]}
                  <span className="ml-2 text-faint">{COPY.scoutReport.powerHint(armyPower({ ...emptyArmy(), [kind]: intel.garrison[kind] }))}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3 border-t border-line-soft pt-1.5 font-mono text-[12px] text-dim">
          <span>{COPY.scoutReport.garrisonTotal(garrisonTotal)}</span>
          <span>{COPY.scoutReport.garrisonPower(garrisonPower)}</span>
          {intel.wallDefensePercent > 0 ? <span className="text-warn">{COPY.scoutReport.wallRow(intel.wallDefensePercent)}</span> : null}
        </p>
        {verdict && garrisonTotal > 0 && precision === 'rough' ? (
          <p role="侦察报告弹窗-战力对比" className="mt-1 text-[13px] text-faint">
            {TECH_COPY.scout.noVerdict}
          </p>
        ) : null}
        {verdict && garrisonTotal > 0 && precision !== 'rough' ? (
          <p role="侦察报告弹窗-战力对比" className={`mt-1 text-[13px] ${verdict.tone === 'ok' ? 'text-ok' : verdict.tone === 'warn' ? 'text-warn' : 'text-st-error'}`}>
            {COPY.scoutReport.compareRow(myPower ?? 0, myTotal ?? 0)} · {verdict.text}
          </p>
        ) : null}
      </div>

      {intel.npcStock ? (
        <div role="侦察报告弹窗-库存">
          <h4 className={h4}>{COPY.scoutReport.stockTitle}</h4>
          {stockKeys.length === 0 ? (
            <p className="text-[12px] text-warn">{COPY.scoutReport.stockEmpty}</p>
          ) : (
            <p className="flex flex-wrap gap-x-3 text-[13px]">
              {stockKeys.map((key) => (
                <span key={key} className="text-dim">
                  {RESOURCE_LABEL[key]} <span className="font-mono">{intel.npcStock?.[key]}</span>
                </span>
              ))}
            </p>
          )}
        </div>
      ) : null}

      <p role="侦察报告弹窗-过时提示" className="text-[12px] text-faint">
        {COPY.scoutReport.staleHint}
      </p>
    </Modal>
  );
}

function emptyArmy(): ArmyCounts {
  return TROOP_KINDS.reduce((army, kind) => ({ ...army, [kind]: 0 }), {} as ArmyCounts);
}
