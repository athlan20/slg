/** 集市兑换小浮层（docs 第 7 节：轻量操作，锚在「集市」按钮下方，点外面关闭）。
 *  粮 / 木 / 石 / 铁按固定汇率换成金币（金币不可逆兑）。预览用前端镜像汇率，成交以服务端响应为准；
 *  仓库快满（AISLG-73）的警示文案引导到这里变现。锚点不可见（手机上入口收进账号菜单）时居中显示。
 */

import { useEffect, useState, type RefObject } from 'react';
import { EXCHANGE_INPUT_PER_GOLD, type Resources } from '../../api/protocol';
import { useCopy } from '../../i18n/bundle';
import type { ExchangeResource } from '../../state/exchangeAction';

const EXCHANGE_RESOURCES: ExchangeResource[] = ['food', 'wood', 'stone', 'iron'];

interface ExchangePopoverProps {
  resources: Resources;
  anchorRef: RefObject<HTMLElement | null>;
  /** 发起兑换：成功返回 null（关闭浮层），失败返回人读错误 */
  onExchange: (resource: ExchangeResource, amount: number) => Promise<string | null>;
  onClose: () => void;
}

export function ExchangePopover({ resources, anchorRef, onExchange, onClose }: ExchangePopoverProps) {
  const copy = useCopy();
  const { COPY, RESOURCE_LABEL } = copy;
  const [resource, setResource] = useState<ExchangeResource>('food');
  const [amountInput, setAmountInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rect = anchorRef.current?.getBoundingClientRect();
  const anchored = rect !== undefined && rect.width > 0;
  const style = anchored
    ? { top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) }
    : { top: '18%', left: '50%', transform: 'translateX(-50%)' };

  const available = resources[resource];
  const amount = Math.max(0, Math.floor(Number(amountInput) || 0));
  const gold = Math.floor(amount / EXCHANGE_INPUT_PER_GOLD);

  const pickResource = (next: ExchangeResource) => {
    setResource(next);
    setError(null);
    // 换资源后数量超过持有量时收回上限，避免直接提交出必然失败的数量
    if (amount > resources[next]) {
      setAmountInput(String(resources[next]));
    }
  };

  const submit = async () => {
    if (busy || amount <= 0 || gold < 1) {
      return;
    }
    setBusy(true);
    const failure = await onExchange(resource, amount);
    setBusy(false);
    if (failure === null) {
      onClose();
    } else {
      setError(failure);
    }
  };

  return (
    <>
      <div role="集市兑换浮层-遮罩" className="fixed inset-0 z-40" onClick={onClose} />
      <div
        role="集市兑换浮层"
        style={style}
        className="fixed z-50 flex w-[min(300px,calc(100vw-16px))] flex-col gap-2 rounded-lg border border-line bg-panel-2 p-3 shadow-2xl"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-[14px] font-semibold">{COPY.exchange.title}</h2>
          <button
            type="button"
            role="集市兑换浮层-关闭按钮"
            aria-label={COPY.exchange.closeAria}
            className="px-1 text-sm text-faint transition-colors hover:text-accent"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <p className="text-[11.5px] leading-snug text-faint">{COPY.exchange.subtitle}</p>

        <div role="集市兑换浮层-资源选择" className="flex gap-1.5">
          {EXCHANGE_RESOURCES.map((key) => (
            <button
              key={key}
              type="button"
              role="集市兑换浮层-资源选项"
              aria-pressed={resource === key}
              onClick={() => pickResource(key)}
              className={`flex-1 cursor-pointer rounded border px-1 py-0.5 font-mono text-[13px] transition-colors ${
                resource === key ? 'border-accent-dim bg-accent-soft text-accent' : 'border-line-soft bg-panel text-dim hover:border-accent-dim'
              }`}
            >
              {RESOURCE_LABEL[key]}
            </button>
          ))}
        </div>

        <label className="flex items-center justify-between gap-2 text-[12.5px] text-dim">
          <span className="min-w-0 truncate">{COPY.exchange.amountLabel(available)}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            <input
              role="集市兑换浮层-数量输入"
              type="number"
              min={0}
              max={available}
              value={amountInput}
              placeholder="0"
              autoFocus
              onChange={(event) => {
                setError(null);
                setAmountInput(event.target.value);
              }}
              className="w-20 rounded border border-line bg-bg px-1.5 py-0.5 text-right font-mono text-[13px] text-fg outline-none placeholder:text-faint focus:border-accent-dim"
            />
            <button
              type="button"
              role="集市兑换浮层-全部按钮"
              onClick={() => setAmountInput(String(available))}
              className="cursor-pointer rounded border border-line px-1.5 py-0.5 font-mono text-[12px] text-dim hover:border-accent-dim hover:text-accent"
            >
              {COPY.exchange.all}
            </button>
          </span>
        </label>

        <p role="集市兑换浮层-预览" className="truncate font-mono text-[12px] text-dim">
          {COPY.exchange.rateLine(EXCHANGE_INPUT_PER_GOLD)}
          {gold > 0 ? ` · ${COPY.exchange.preview(gold, amount - gold * EXCHANGE_INPUT_PER_GOLD, RESOURCE_LABEL[resource])}` : ''}
        </p>
        {amount > 0 && gold < 1 ? (
          <p role="集市兑换浮层-数量提示" className="text-[12px] text-warn">
            {COPY.exchange.tooSmall(EXCHANGE_INPUT_PER_GOLD)}
          </p>
        ) : null}
        {error ? (
          <p role="集市兑换浮层-错误" className="truncate rounded border border-line-soft bg-panel px-2 py-1 text-[12px] text-dim" title={error}>
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" role="集市兑换浮层-取消按钮" className="btn" onClick={onClose}>
            {COPY.exchange.cancel}
          </button>
          <button
            type="button"
            role="集市兑换浮层-确认按钮"
            className="btn px-3"
            disabled={busy || amount <= 0 || gold < 1}
            onClick={() => void submit()}
          >
            {busy ? COPY.exchange.busy : COPY.exchange.submit}
          </button>
        </div>
      </div>
    </>
  );
}
