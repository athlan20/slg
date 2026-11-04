/** 背包与商店弹窗（v90，AISLG-222）：账号菜单「背包 / 商店」打开。固定高度不滚动：列表用 PagedList 分页（每页最多 6 种）。
 *  背包页列出每种道具的名称、说明与数量；商店页列出可卖的道具并可买。数量与礼金余额来自 useCityList，购买后即时刷新。
 *  底部常驻「道具随换季清空」。role 按功能命名（AGENTS 前端规范）。
 */

import { useCopy } from '../../i18n/bundle';
import type { ItemCounts, ItemDefView, ItemId } from '../../api/protocol';
import type { ItemsSession, ItemsTab } from '../../state/itemsSession';
import type { GiftView } from '../../state/useCityList';
import { Modal } from '../ui/Modal';
import { PagedList } from '../ui/PagedList';
import { ItemShopRow } from './ItemShopRow';

interface ItemsModalProps {
  session: ItemsSession;
  counts: ItemCounts | null;
  gift: GiftView | null;
}

export function ItemsModal({ session, counts, gift }: ItemsModalProps) {
  const { ITEM_COPY } = useCopy();
  const catalog = session.catalog ?? [];
  const shop = catalog.filter((def) => def.shopPrice !== null);
  const ownedOf = (id: ItemId) => counts?.[id] ?? 0;

  const tabButton = (value: ItemsTab, role: string, label: string) => (
    <button
      type="button"
      role={role}
      aria-pressed={session.tab === value}
      onClick={() => session.setTab(value)}
      className={`cursor-pointer rounded border px-3 py-1 text-[12.5px] ${
        session.tab === value ? 'border-accent-dim bg-accent-soft text-accent' : 'border-line bg-panel-2 text-dim hover:text-fg'
      }`}
    >
      {label}
    </button>
  );

  return (
    <Modal
      role="背包商店"
      title={ITEM_COPY.title}
      onClose={session.closePanel}
      fill
      headExtra={
        gift ? (
          <span role="背包商店-礼金" className="shrink-0 font-mono text-[12px] tabular-nums text-gold">
            {ITEM_COPY.giftChip(gift.balance, gift.seasonGrant)}
          </span>
        ) : null
      }
    >
      <div role="背包商店-页签" className="flex shrink-0 gap-1.5">
        {tabButton('bag', '背包商店-页签-背包', ITEM_COPY.tabBag)}
        {tabButton('shop', '背包商店-页签-商店', ITEM_COPY.tabShop)}
      </div>
      {session.tab === 'bag' ? (
        <PagedList<ItemDefView>
          role="背包商店-背包列表"
          items={catalog}
          maxPerPage={6}
          gap={6}
          gapClass="gap-1.5"
          keyOf={(def) => def.id}
          empty={<p className="text-[12px] text-faint">{session.loading ? ITEM_COPY.loading : ''}</p>}
          renderRow={(def) => (
            <div role="背包商店-背包行" className="flex items-center gap-2 rounded border border-line-soft px-2.5 py-1.5">
              <div className="min-w-0 flex-1">
                <b className="block truncate text-[13px]">{ITEM_COPY.names[def.id]}</b>
                <small className="block truncate text-[11.5px] text-dim">{ITEM_COPY.descs[def.id]}</small>
              </div>
              <span role="背包商店-背包行-数量" className="shrink-0 font-mono text-[13px] tabular-nums">
                ×{ownedOf(def.id)}
              </span>
            </div>
          )}
        />
      ) : (
        <PagedList<ItemDefView>
          role="背包商店-商店列表"
          items={shop}
          maxPerPage={6}
          gap={6}
          gapClass="gap-1.5"
          keyOf={(def) => def.id}
          empty={<p className="text-[12px] text-faint">{session.loading ? ITEM_COPY.loading : ITEM_COPY.shopEmpty}</p>}
          renderRow={(def) => (
            <ItemShopRow
              def={def}
              owned={ownedOf(def.id)}
              gift={gift?.balance ?? null}
              busy={session.busy}
              onBuy={(itemId, count, price) => void session.buy(itemId, count, price)}
            />
          )}
        />
      )}
      {session.error ? (
        <p role="背包商店-错误" className="shrink-0 text-[12px] text-st-error">
          {session.error}
        </p>
      ) : null}
      {session.notice ? (
        <p role="背包商店-提示" className="shrink-0 text-[12px] text-st-online">
          {session.notice}
        </p>
      ) : null}
      <p role="背包商店-换季提示" className="shrink-0 text-[11.5px] text-faint">
        {ITEM_COPY.seasonNote}
      </p>
    </Modal>
  );
}
