/** 离线日报弹窗（v23，AISLG-54）：玩家上线先看「你不在时发生了什么」。
 *  上半部是服务端按实际离线时段统计的数字汇总（收获 / 损失 / 现状），下半部是
 *  Agent 留的总结与建议（没接入 Agent 或没写过时隐藏该区）。数据经
 *  GET_OFFLINE_REPORT（op 41）按需拉取；离线 ≥ 30 分钟上线时自动弹出，
 *  也可在 Agent 面板里重新打开。
 */

import { Modal } from './ui/Modal';
import type { GetOfflineReportResponseData } from '../api/protocol';
import { getCopy, useCopy } from '../i18n/bundle';
import { formatReportTime } from '../api/mapping';

interface OfflineReportModalProps {
  data: GetOfflineReportResponseData;
  onClose: () => void;
}

/** 秒数 → 「X 小时 Y 分钟」（不足 1 小时只显示分钟） */
function durationText(seconds: number): string {
  const { COPY } = getCopy();
  const minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes < 60) {
    return COPY.offlineReport.durationMinutes(minutes);
  }
  return COPY.offlineReport.durationHours(Math.floor(minutes / 60), minutes % 60);
}

export function OfflineReportModal({ data, onClose }: OfflineReportModalProps) {
  const copy = useCopy();
  const { COPY, EXTRA_PANEL, RESOURCE_LABEL, STARVE_COPY } = copy;
  const { offline, agentReport } = data;
  const gains = (Object.keys(RESOURCE_LABEL) as Array<keyof typeof RESOURCE_LABEL>)
    .filter((key) => (offline.gains[key] ?? 0) > 0)
    .map((key) => `${RESOURCE_LABEL[key]} ${offline.gains[key]}`);
  const h4 = 'mb-0.5 text-[13px] font-semibold text-dim';

  return (
    <Modal
      role="离线日报弹窗"
      title={
        <>
          <span className="tag mr-2">{COPY.offlineReport.title}</span>
          {COPY.offlineReport.subtitle}
          <span className="ml-2 font-mono text-[12px] font-normal text-faint">{durationText(offline.seconds)}</span>
        </>
      }
      accent="gold"
      onClose={onClose}
    >
      <div role="离线日报弹窗-收获">
        <h4 className={h4}>{COPY.offlineReport.gainsTitle}</h4>
        {gains.length === 0 ? <p className="text-[12px] text-faint">{COPY.offlineReport.gainsNone}</p> : <p className="text-[13px] text-ok">{COPY.offlineReport.gainsLine(gains.join(EXTRA_PANEL.joiners.enum))}</p>}
      </div>

      <div role="离线日报弹窗-损失">
        <h4 className={h4}>{COPY.offlineReport.lossesTitle}</h4>
        {offline.battles === 0 && offline.npcRaids === 0 && offline.wildernessLost === 0 ? (
          <p className="text-[12px] text-faint">{COPY.offlineReport.lossesNone}</p>
        ) : (
          <ul className="flex flex-col gap-0.5 text-[13px] text-dim">
            {offline.battles > 0 ? <li>{COPY.offlineReport.battlesRow(offline.battles)}</li> : null}
            {offline.troopsLost > 0 ? <li className="text-warn">{COPY.offlineReport.troopsLostRow(offline.troopsLost)}</li> : null}
            {(offline.mutinyLost ?? 0) > 0 ? <li className="text-warn">{STARVE_COPY.offline.mutinyRow(offline.mutinyLost)}</li> : null}
            {offline.npcRaids > 0 ? <li>{COPY.offlineReport.npcRaidsRow(offline.npcRaids)}</li> : null}
            {offline.wildernessLost > 0 ? <li className="text-warn">{COPY.offlineReport.wildernessLostRow(offline.wildernessLost)}</li> : null}
          </ul>
        )}
      </div>

      <div role="离线日报弹窗-现状">
        <h4 className={h4}>{COPY.offlineReport.statusTitle}</h4>
        {offline.storageFull ? (
          <p className="text-[13px] text-warn">
            {COPY.offlineReport.storageFullRow(RESOURCE_LABEL[offline.storageFull.resource as keyof typeof RESOURCE_LABEL] ?? offline.storageFull.resource, offline.storageFull.percent)}
          </p>
        ) : (
          <p className="text-[12px] text-faint">{COPY.offlineReport.statusCalm}</p>
        )}
      </div>

      {agentReport ? (
        <div role="离线日报弹窗-Agent的话" className="min-h-0">
          <h4 className={h4}>{COPY.offlineReport.agentTitle}</h4>
          <div className="rounded border border-accent-dim bg-accent-soft px-2.5 py-1.5">
            <p className="line-clamp-6 text-[13px] text-fg" title={agentReport.text}>
              {agentReport.text}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-faint">{COPY.offlineReport.writtenAt(formatReportTime(agentReport.writtenAt))}</p>
          </div>
        </div>
      ) : null}

      <button type="button" role="离线日报弹窗-知道了按钮" className="btn w-full shrink-0" onClick={onClose}>
        {COPY.offlineReport.acknowledge}
      </button>
    </Modal>
  );
}
