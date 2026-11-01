// 被施计警报弹窗（v86，AISLG-211）：PUSH_STRATAGEM 到达即弹——谁、用哪名武将、对哪座城 /
// 哪支部队施了什么计、成没成。会失败的计谋不论成败都会推（欺敌与金蝉脱壳不通知任何人）。
// 等式文案同时由服务端 stratagem_received 事件进事件流，这里只做即时提醒。

import type { StratagemPushData } from '../../api/protocol';
import { stratagemName } from '../../api/stratagemText';
import { useCopy } from '../../i18n/bundle';
import { Modal } from '../ui/Modal';

export function StratagemAlertModal({ data, onDismiss }: { data: StratagemPushData; onDismiss: () => void }) {
  const copy = useCopy();
  const { STRATAGEM_COPY } = copy;
  const name = stratagemName(data.stratagem);
  const where =
    data.target.kind === 'city'
      ? STRATAGEM_COPY.event.targetCity(data.target.cityName ?? '', data.target.x ?? 0, data.target.y ?? 0)
      : STRATAGEM_COPY.event.targetMarch(data.target.x ?? 0, data.target.y ?? 0);
  const effect = data.effect ?? {};
  const detail: string[] = [];
  if (typeof effect.foodBurned === 'number') {
    detail.push(STRATAGEM_COPY.alert.foodBurned(effect.foodBurned));
  }
  if (typeof effect.protectionDownPercent === 'number') {
    detail.push(STRATAGEM_COPY.effect.protectionDown(effect.protectionDownPercent));
  }
  if (typeof effect.extendedPercent === 'number') {
    detail.push(STRATAGEM_COPY.effect.eightGates(effect.extendedPercent));
  }

  return (
    <Modal role="被施计警报弹窗" title={<span className="text-warn">{STRATAGEM_COPY.alert.title}</span>} size="sm" accent="warn" onClose={onDismiss}>
      <div role="被施计警报弹窗-详情" className="flex flex-col gap-1 text-[12.5px] text-dim">
        <p role="被施计警报弹窗-施计方">{STRATAGEM_COPY.alert.subtitle(data.caster.username, data.caster.heroName)}</p>
        <p role="被施计警报弹窗-计谋">
          {STRATAGEM_COPY.title}：{name}
          {where}
        </p>
        <p role="被施计警报弹窗-结果" className={data.success ? 'text-warn' : 'text-dim'}>
          {data.success ? STRATAGEM_COPY.alert.success : STRATAGEM_COPY.alert.failure}
        </p>
        {detail.length > 0 ? (
          <p role="被施计警报弹窗-效果" className="font-mono">
            {detail.join(' · ')}
          </p>
        ) : null}
        <p role="被施计警报弹窗-建议" className="rounded border border-warn/40 bg-warn/10 px-2 py-1 text-[11.5px] leading-relaxed">
          {name}：{STRATAGEM_COPY.desc[data.stratagem]}
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" role="被施计警报弹窗-确认按钮" className="btn px-3" onClick={onDismiss}>
          {STRATAGEM_COPY.alert.acknowledge}
        </button>
      </div>
    </Modal>
  );
}
