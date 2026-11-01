// 行军详情弹窗（AISLG-215，GitHub #33）：行军列表每一行的「详情」入口。
// 内容自上而下：任务与状态 / 路线（出发城 → 目标、出发与预计到达、实时剩余、进度条）/
// 兵种组成（逐兵种 + 合计）/ 将领（姓名 · Lv，未加载显示「将领」，无将领显示「无」）/
// 运送物资（有 cargo 时金木粮石铁逐项完整数量，返程改标题「随队带回」）/
// 底部「定位」与「撤回」（返程行军与行内一致，换成金蝉脱壳计谋入口）。
// 弹窗开着时该行军到达 / 结算消失了（march = null）→ 切成「该行军已结束」，只留关闭。

import { useState } from 'react';
import type { MarchView } from '../../api/protocol';
import { RESOURCE_KEYS } from '../../api/protocol';
import { formatClock, formatDurationText } from '../../api/format';
import { useCopy } from '../../i18n/bundle';
import { tName } from '../../i18n/names';
import { useGame } from '../../state/GameContext';
import { useNav } from '../../state/NavContext';
import { useNow } from '../../state/useNow';
import { StratagemEntry } from '../stratagem/StratagemEntry';
import { Modal } from '../ui/Modal';
import { fromCityName, isCargoMarch, fullAmount, troopRows, troopTotal } from './marchDetailText';

interface MarchDetailModalProps {
  /** 当前行军的快照；null = 弹窗开着时该行军已结束 */
  march: MarchView | null;
  onClose: () => void;
}

const H4 = 'mb-0.5 text-[13px] font-semibold text-dim';
const ROW = 'flex items-baseline justify-between gap-2 text-[13px]';

export function MarchDetailModal({ march, onClose }: MarchDetailModalProps) {
  const copy = useCopy();
  const { ARMY_COPY, RESOURCE_LABEL, STRATAGEM_COPY } = copy;
  const D = ARMY_COPY.marchDetail;
  const { session } = useGame();
  const { go } = useNav();
  const { world } = session;
  const now = useNow(march !== null);
  const [recallBusy, setRecallBusy] = useState(false);
  const heroes = session.heroSession.state?.heroes ?? [];
  const hero = march?.heroId ? heroes.find((item) => item.id === march.heroId) : undefined;

  // 已结束：内容换成提示，只留关闭按钮
  if (!march) {
    return (
      <Modal role="行军详情弹窗" title={D.title} accent="none" onClose={onClose}>
        <p role="行军详情弹窗-已结束" className="py-6 text-center text-[13px] text-faint">
          {D.ended}
        </p>
        <div className="flex shrink-0 justify-end">
          <button
            type="button"
            role="行军详情弹窗-关闭"
            onClick={onClose}
            className="cursor-pointer rounded border border-line px-3 py-1 text-[12px] transition-colors hover:border-accent hover:text-accent"
          >
            {D.close}
          </button>
        </div>
      </Modal>
    );
  }

  const startedMs = Date.parse(march.startedAt);
  const arriveMs = Date.parse(march.arriveAt);
  const total = Math.max(1, arriveMs - startedMs);
  const left = Math.max(0, Math.ceil((arriveMs - now) / 1000));
  const pct = Math.min(100, Math.max(0, Math.round(((now - startedMs) / total) * 100)));
  const ambush = march.ambushAt !== null && now >= Date.parse(march.ambushAt);
  const state = march.purpose === 'return' ? ARMY_COPY.marchStateReturn : ambush ? ARMY_COPY.marchStateAmbush : ARMY_COPY.marchStateMarching;
  const rows = troopRows(march);
  const cargo = march.cargo;
  const cargoKeys = RESOURCE_KEYS.filter((key) => (cargo?.[key] ?? 0) > 0);

  const recall = async () => {
    if (recallBusy) {
      return;
    }
    setRecallBusy(true);
    try {
      await world.recallMarch(march.id);
    } finally {
      setRecallBusy(false);
    }
    onClose();
  };

  return (
    <Modal role="行军详情弹窗" title={D.title} accent="none" onClose={onClose}>
      <div role="行军详情弹窗-内容" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        <div role="行军详情弹窗-任务">
          <h4 className={H4}>{D.taskTitle}</h4>
          <p className="text-[13px]">
            {D.tasks[march.purpose]} · {state}
          </p>
        </div>

        <div role="行军详情弹窗-路线">
          <h4 className={H4}>{D.routeTitle}</h4>
          <p role="行军详情弹窗-路线行" className="break-all text-[13px]">
            {fromCityName(session.cityList.cities, march.fromCityId)} → ({march.x},{march.y})
          </p>
          <p className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[12px] text-dim">
            <span>{D.startedAt(formatClock(march.startedAt))}</span>
            <span>{D.arriveAt(formatClock(march.arriveAt))}</span>
            <span role="行军详情弹窗-剩余时间" className={ambush ? 'text-gold' : undefined}>
              {D.remaining(formatDurationText(left))}
            </span>
          </p>
          <span className="mt-1 block h-[3px] overflow-hidden rounded bg-line">
            <i className="block h-full bg-accent" style={{ width: `${pct}%` }} />
          </span>
        </div>

        <div role="行军详情弹窗-兵种">
          <h4 className={H4}>{D.troopsTitle}</h4>
          {rows.length === 0 ? (
            <p className="text-[12px] text-faint">{D.troopsEmpty}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-x-4">
              {rows.map((row) => (
                <li key={row.kind} role="行军详情弹窗-兵种行" className={ROW}>
                  <span className="text-dim">{row.name}</span>
                  <span className="font-mono">×{row.count}</span>
                </li>
              ))}
            </ul>
          )}
          <p role="行军详情弹窗-兵种合计" className="mt-1 border-t border-line-soft pt-1 font-mono text-[12px] text-dim">
            {D.troopsTotal(troopTotal(march))}
          </p>
        </div>

        <div role="行军详情弹窗-将领">
          <h4 className={H4}>{D.heroTitle}</h4>
          <p role="行军详情弹窗-将领行" className="text-[13px]">
            {hero ? D.heroLine(tName(hero.name), hero.level) : march.heroId ? D.heroPending : D.heroNone}
          </p>
        </div>

        {isCargoMarch(march) && cargo ? (
          <div role="行军详情弹窗-物资">
            <h4 className={H4}>{march.purpose === 'return' ? D.cargoTitleBack : D.cargoTitle}</h4>
            <ul className="grid grid-cols-2 gap-x-4">
              {RESOURCE_KEYS.map((key) => (
                <li key={key} role="行军详情弹窗-物资行" className={ROW}>
                  <span className="text-dim">{RESOURCE_LABEL[key]}</span>
                  <span className={`font-mono ${cargoKeys.includes(key) ? '' : 'text-faint'}`}>{fullAmount(cargo[key] ?? 0)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div role="行军详情弹窗-底部按钮" className="flex shrink-0 justify-end gap-2 border-t border-line-soft pt-2">
        <button
          type="button"
          role="行军详情弹窗-定位按钮"
          onClick={() => {
            world.centerOn(march.x, march.y);
            onClose();
            go('map');
          }}
          className="cursor-pointer rounded border border-accent px-3 py-0.5 text-[12px] text-accent transition-colors hover:bg-accent-soft"
        >
          {D.locate}
        </button>
        {march.status === 'marching' && march.purpose === 'return' && !march.stratagemUsed ? (
          <StratagemEntry
            role="行军详情弹窗-金蝉脱壳按钮"
            label={STRATAGEM_COPY.entry.cicada}
            target={{ marchId: march.id, label: `(${march.x},${march.y})`, only: ['golden_cicada'] }}
          />
        ) : null}
        {march.status === 'marching' && march.purpose !== 'return' ? (
          <button
            type="button"
            role="行军详情弹窗-撤回按钮"
            disabled={recallBusy}
            onClick={() => void recall()}
            className="cursor-pointer rounded border border-warn px-3 py-0.5 text-[12px] text-warn disabled:cursor-not-allowed disabled:opacity-40"
          >
            {recallBusy ? D.recallBusy : D.recall}
          </button>
        ) : null}
      </div>
    </Modal>
  );
}
