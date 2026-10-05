/** 离线日报摘要卡（Agent 页右）：离线时长、收获、战斗、减员、NPC 袭击、Agent 日报原文开头 + 「查看完整日报」（弹窗）。
 *  数据来自 GET_OFFLINE_REPORT（进入 Agent 页时拉一次，不弹窗）。 */

import { useEffect } from 'react';
import { getCopy, useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';
import { Card } from '../ui/Card';

function durationText(seconds: number): string {
  const { COPY } = getCopy();
  const minutes = Math.max(0, Math.floor(seconds / 60));
  return minutes < 60 ? COPY.offlineReport.durationMinutes(minutes) : COPY.offlineReport.durationHours(Math.floor(minutes / 60), minutes % 60);
}

export function OfflineSummaryCard() {
  const copy = useCopy();
  const { COPY, EXTRA_PANEL, INTEL_COPY, RESOURCE_LABEL } = copy;
  const { session } = useGame();
  const { offlineSummary, loadOfflineSummary } = session;
  useEffect(() => {
    void loadOfflineSummary();
    // 只在进入页面时拉一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const offline = offlineSummary?.offline;
  const gains = offline
    ? (Object.keys(RESOURCE_LABEL) as Array<keyof typeof RESOURCE_LABEL>).filter((key) => (offline.gains[key] ?? 0) > 0).map((key) => `${RESOURCE_LABEL[key]} ${offline.gains[key]}`)
    : [];

  return (
    <Card role="Agent页-离线日报" title={COPY.offlineReport.title} meta={offline ? durationText(offline.seconds) : undefined}>
      {offline ? (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
          <Line label={COPY.offlineReport.gainsTitle} value={gains.length > 0 ? gains.join(' · ') : COPY.offlineReport.gainsNone} tone={gains.length > 0 ? 'text-ok' : 'text-faint'} />
          <Line label={COPY.offlineReport.lossesTitle} value={offline.battles > 0 ? COPY.offlineReport.battlesRow(offline.battles) : COPY.offlineReport.lossesNone} />
          {offline.troopsLost > 0 ? <Line label={EXTRA_PANEL.offlineSummary.troopsLostLabel} value={COPY.offlineReport.troopsLostRow(offline.troopsLost)} tone="text-warn" /> : null}
          {offline.npcRaids > 0 ? <Line label="NPC" value={COPY.offlineReport.npcRaidsRow(offline.npcRaids)} /> : null}
          <div className="mt-1 min-h-0 flex-1 overflow-hidden rounded border border-line-soft bg-panel-2 px-2 py-1.5" role="Agent页-日报原文">
            <p className="text-[11px] text-faint">{COPY.offlineReport.agentTitle}</p>
            <p className="mt-0.5 line-clamp-6 text-[12.5px] text-dim" title={offlineSummary?.agentReport?.text}>
              {offlineSummary?.agentReport?.text ?? INTEL_COPY.noAgentReport}
            </p>
          </div>
        </div>
      ) : (
        <p className="py-6 text-center text-[12.5px] text-faint">{INTEL_COPY.offlineLoading}</p>
      )}
      <button type="button" role="Agent页-查看完整日报按钮" className="btn shrink-0 py-1.5" onClick={() => void session.openOfflineReport()}>
        {INTEL_COPY.fullReport}
      </button>
    </Card>
  );
}

function Line({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <p className="flex shrink-0 items-baseline justify-between gap-2 text-[12.5px]">
      <span className="shrink-0 text-faint">{label}</span>
      <span className={`min-w-0 truncate text-right ${tone}`} title={value}>
        {value}
      </span>
    </p>
  );
}
