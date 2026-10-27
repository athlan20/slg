/** 玩家交易所弹窗（v78，AISLG-196）：挂单列表 / 我的挂单与成交 / 挂单卖出。
 *  挂单、吃单、撤单都以服务端为准；列表用 PagedList 一屏内分页，不出现竖向滚动。 */

import { useMemo, useState } from 'react';
import {
  MARKET_BUY_KINDS,
  MARKET_RESOURCES,
  type MarketBuyKind,
  type MarketOrderView,
  type MarketResource,
} from '../api/protocol';
import { formatClock } from '../api/format';
import { useCopy } from '../i18n/bundle';
import { useGame } from '../state/GameContext';
import { tName } from '../i18n/names';
import { Modal } from './ui/Modal';
import { PagedList } from './ui/PagedList';

type Tab = 'orders' | 'mine' | 'create';

const inputClass =
  'w-full min-w-0 rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[12.5px] text-right';
const labelClass = 'flex items-center justify-between gap-2 text-[12px] text-dim';

function kindLabel(kind: MarketBuyKind, labels: Record<string, string>): string {
  return kind === 'gold' ? '金' : labels[kind] ?? kind;
}

export function MarketModal({ onClose }: { onClose: () => void }) {
  const { session } = useGame();
  const copy = useCopy();
  const { MARKET_COPY: M, RESOURCE_LABEL } = copy;
  const market = session.market;
  const state = market.state;
  const [tab, setTab] = useState<Tab>('orders');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('');
  const [sell, setSell] = useState<MarketResource>('food');
  const [buy, setBuy] = useState<MarketBuyKind>('gold');
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState('');
  const [allyOnly, setAllyOnly] = useState(false);

  const limits = state?.limits ?? null;
  const selected = state?.orders.find((order) => order.id === selectedId) ?? null;
  const selectedQty = Math.max(0, Math.min(selected?.remaining ?? 0, Math.floor(Number(quantity) || 0)));
  const cost = selected ? Math.max(1, Math.floor(selectedQty * selected.unitPrice)) : 0;
  const priceRange = buy === 'gold' ? limits?.priceRangeGold : limits?.priceRangeResource;
  const priceValue = Number(price);

  const canCreate = useMemo(() => {
    if (!limits || limits.locked) {
      return false;
    }
    const amt = Math.floor(Number(amount) || 0);
    return amt >= limits.minAmount && Number.isFinite(priceValue) && priceRange !== undefined && priceValue >= priceRange.min && priceValue <= priceRange.max;
  }, [amount, limits, priceRange, priceValue]);

  const orderRow = (order: MarketOrderView) => (
    <button
      key={order.id}
      type="button"
      role="交易所-挂单条目"
      onClick={() => {
        setSelectedId(order.id);
        setQuantity(String(order.remaining));
      }}
      className={`flex w-full min-w-0 items-center justify-between gap-2 rounded border px-2 py-1 text-left text-[12.5px] ${
        selectedId === order.id ? 'border-accent bg-accent-soft' : 'border-line-soft hover:border-accent-dim'
      }`}
    >
      <span className="min-w-0 truncate">
        <b className="text-fg">
          {M.list.price(order.unitPrice, RESOURCE_LABEL[order.sellResource], kindLabel(order.buyResource, RESOURCE_LABEL))}
        </b>
        <span className="ml-1.5 text-faint">
          {M.list.remaining(order.remaining)} · {tName(order.seller.username)}
          {order.allyOnly ? ` · ${M.list.allyOnly}` : ''}
          {order.seller.allianceName ? ` · ${order.seller.allianceName}` : ''}
        </span>
      </span>
      <span className="shrink-0 text-[11px] text-faint">{M.list.expires(formatClock(order.expiresAt))}</span>
    </button>
  );

  const ordersTab = (
    <div role="交易所-挂单页签" className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[12px]">
        <label className="flex items-center gap-1">
          {M.filters.sell}
          <select
            value={market.filters.sellResource ?? ''}
            onChange={(event) => market.setFilters({ ...market.filters, sellResource: (event.target.value || undefined) as MarketResource | undefined })}
            className="rounded border border-line bg-panel px-1 py-0.5"
          >
            <option value="">{M.filters.all}</option>
            {MARKET_RESOURCES.map((kind) => (
              <option key={kind} value={kind}>{RESOURCE_LABEL[kind]}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          {M.filters.buy}
          <select
            value={market.filters.buyResource ?? ''}
            onChange={(event) => market.setFilters({ ...market.filters, buyResource: (event.target.value || undefined) as MarketBuyKind | undefined })}
            className="rounded border border-line bg-panel px-1 py-0.5"
          >
            <option value="">{M.filters.all}</option>
            {MARKET_BUY_KINDS.map((kind) => (
              <option key={kind} value={kind}>{kindLabel(kind, RESOURCE_LABEL)}</option>
            ))}
          </select>
        </label>
        <span className="ml-auto text-faint">{state ? `共 ${state.total} 张` : ''}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <PagedList
          role="交易所-挂单列表"
          items={state?.orders ?? []}
          keyOf={(order) => order.id}
          renderRow={orderRow}
          empty={<p className="py-6 text-center text-[13px] text-faint">{M.list.empty}</p>}
        />
      </div>
      <div role="交易所-买入表单" className="flex shrink-0 flex-col gap-1 rounded border border-line-soft bg-panel-2/40 px-2 py-1.5">
        {selected ? (
          <>
            <p className="truncate text-[12px] text-dim">
              {M.buy.title} · {M.list.price(selected.unitPrice, RESOURCE_LABEL[selected.sellResource], kindLabel(selected.buyResource, RESOURCE_LABEL))}
            </p>
            <div className="flex items-center gap-2">
              <label className={labelClass}>
                {M.buy.quantity}
                <input
                  type="number"
                  min={1}
                  max={selected.remaining}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  className={`${inputClass} w-28`}
                />
              </label>
              <span className="text-[11.5px] text-faint">{M.buy.hint(selected.remaining)}</span>
              <span className="ml-auto text-[12px] text-gold">
                {M.buy.cost(cost, kindLabel(selected.buyResource, RESOURCE_LABEL))}
              </span>
              <button
                type="button"
                role="交易所-确认买入"
                disabled={market.busy || selectedQty <= 0}
                onClick={() => void market.buy(selected.id, selectedQty)}
                className="cursor-pointer rounded border border-accent-dim bg-accent-soft px-2.5 py-0.5 text-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {M.buy.submit}
              </button>
            </div>
          </>
        ) : (
          <p className="text-[12px] text-faint">{M.buy.pick}</p>
        )}
      </div>
    </div>
  );

  const mineTab = (
    <div role="交易所-我的页签" className="grid min-h-0 flex-1 grid-cols-2 gap-2">
      <div className="flex min-h-0 flex-col gap-1">
        <h4 className="shrink-0 text-[12.5px] text-accent">{M.mine.orders}</h4>
        <PagedList
          role="交易所-我的挂单"
          items={state?.mine.orders ?? []}
          keyOf={(order) => order.id}
          empty={<p className="py-4 text-[12px] text-faint">{M.mine.empty}</p>}
          renderRow={(order) => (
            <div key={order.id} role="交易所-我的挂单条目" className="flex items-center justify-between gap-1.5 border-b border-line-soft py-1 text-[12px]">
              <span className="min-w-0 truncate">
                {M.list.price(order.unitPrice, RESOURCE_LABEL[order.sellResource], kindLabel(order.buyResource, RESOURCE_LABEL))}
                <span className="ml-1 text-faint">{M.list.remaining(order.remaining)} · {M.mine.status(order.allyOnly ? M.list.allyOnly : '')}</span>
              </span>
              {order.remaining > 0 ? (
                <button
                  type="button"
                  role="交易所-撤单"
                  disabled={market.busy}
                  onClick={() => void market.cancel(order.id)}
                  className="shrink-0 cursor-pointer text-faint hover:text-st-error"
                >
                  {M.mine.cancel}
                </button>
              ) : null}
            </div>
          )}
        />
      </div>
      <div className="flex min-h-0 flex-col gap-1">
        <h4 className="shrink-0 text-[12.5px] text-gold">{M.mine.trades}</h4>
        <PagedList
          role="交易所-成交列表"
          items={state?.mine.trades ?? []}
          keyOf={(trade) => trade.id}
          empty={<p className="py-4 text-[12px] text-faint">{M.mine.empty}</p>}
          renderRow={(trade) => (
            <div key={trade.id} role="交易所-成交条目" className="flex items-center justify-between gap-1.5 border-b border-line-soft py-1 text-[11.5px]">
              <span className="min-w-0 truncate">
                {M.mine.tradeRow(
                  trade.role, tName(trade.other.username), trade.quantity,
                  RESOURCE_LABEL[trade.sellResource], kindLabel(trade.buyResource, RESOURCE_LABEL), trade.paid,
                )}
              </span>
              <span className={`shrink-0 ${trade.deliveredAt ? 'text-ok' : 'text-faint'}`}>
                {trade.deliveredAt ? M.mine.delivered : M.mine.delivering}
              </span>
            </div>
          )}
        />
      </div>
    </div>
  );

  const createTab = (
    <div role="交易所-挂单表单" className="flex min-h-0 flex-1 flex-col gap-2 text-[12.5px]">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-dim">{M.create.sell}</span>
          <select value={sell} onChange={(event) => setSell(event.target.value as MarketResource)} className="rounded border border-line bg-panel px-1.5 py-1">
            {MARKET_RESOURCES.map((kind) => <option key={kind} value={kind}>{RESOURCE_LABEL[kind]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-dim">{M.create.buy}</span>
          <select value={buy} onChange={(event) => setBuy(event.target.value as MarketBuyKind)} className="rounded border border-line bg-panel px-1.5 py-1">
            {MARKET_BUY_KINDS.map((kind) => <option key={kind} value={kind}>{kindLabel(kind, RESOURCE_LABEL)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-dim">{M.create.amount}</span>
          <input type="number" min={limits?.minAmount ?? 1000} value={amount} onChange={(event) => setAmount(event.target.value)} className={inputClass} />
          <span className="text-[10.5px] text-faint">{M.create.min(limits?.minAmount ?? 1000)}</span>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-dim">{M.create.price}</span>
          <input type="number" step="0.0001" value={price} onChange={(event) => setPrice(event.target.value)} className={inputClass} />
          {priceRange ? (
            <span className="text-[10.5px] text-faint">
              {M.create.priceHint(priceRange.min, priceRange.max, RESOURCE_LABEL[sell], kindLabel(buy, RESOURCE_LABEL))}
            </span>
          ) : null}
        </label>
      </div>
      <label className="flex items-center gap-1.5 text-[12px] text-dim">
        <input type="checkbox" checked={allyOnly} onChange={(event) => setAllyOnly(event.target.checked)} />
        {M.create.allyOnly}
      </label>
      <button
        type="button"
        role="交易所-确认挂单"
        disabled={market.busy || !canCreate}
        onClick={() =>
          void market.create({
            sellResource: sell,
            buyResource: buy,
            amount: Math.floor(Number(amount) || 0),
            unitPrice: priceValue,
            allyOnly,
          }).then((ok) => {
            if (ok) {
              setAmount('');
            }
          })
        }
        className="self-start cursor-pointer rounded border border-accent-dim bg-accent-soft px-3 py-1 text-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {M.create.submit}
      </button>
      <p className="text-[11.5px] leading-relaxed text-faint">{M.limits.fee(limits?.feePercent ?? 5)}</p>
    </div>
  );

  return (
    <Modal role="交易所弹窗" title={M.launcher.title} accent="gold" fill onClose={onClose}>
      <div role="交易所-额度" className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-[12px]">
        {limits ? (
          <>
            <span className={limits.locked ? 'text-st-error' : 'text-dim'}>
              {limits.locked
                ? limits.lockedReason === 'newbie'
                  ? M.limits.lockedNewbie
                  : M.limits.lockedGovernment
                : M.limits.line(limits.activeOrders, limits.maxOpenOrders, limits.dailyUsed, limits.dailyLimit)}
            </span>
            <span className="text-faint">{M.limits.fee(limits.feePercent)}</span>
          </>
        ) : null}
      </div>
      {market.error ? (
        <p role="交易所-错误" className="shrink-0 text-[12px] text-st-error" onClick={market.clearError}>{market.error}</p>
      ) : null}
      <div className="flex shrink-0 gap-1.5">
        {(
          [
            ['orders', M.tabs.orders],
            ['mine', M.tabs.mine],
            ['create', M.tabs.create],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
            className={`cursor-pointer rounded border px-2.5 py-0.5 text-[12.5px] ${
              tab === key ? 'border-accent bg-accent-soft text-accent' : 'border-line text-dim hover:text-fg'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'orders' ? ordersTab : null}
      {tab === 'mine' ? mineTab : null}
      {tab === 'create' ? createTab : null}
    </Modal>
  );
}
