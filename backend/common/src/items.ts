// 道具（AISLG-222，v90）：配置表 ITEM_DEFS 与纯规则。道具定义在代码里，不进数据库；日后调价只改 shopPrice 并重启。
// 背包的存取（发放 / 消耗 / 读取）在 items-db.ts，购买事务在 api/src/handlers-items.ts。
// 首批两种：迁城令（random 模式）与高级迁城令（pointing 模式），由 AISLG-220 的 MOVE_CITY 消耗。

/** 道具 id（新增道具：在 ITEM_IDS 与 ITEM_DEFS 各加一行） */
export const ITEM_IDS = ['city_order', 'city_order_adv'] as const;
export type ItemId = (typeof ITEM_IDS)[number];

/** 道具种类（目前只有令类） */
export type ItemKind = 'order';

export interface ItemDef {
  id: ItemId;
  name: string;
  nameEn: string;
  desc: string;
  descEn: string;
  kind: ItemKind;
  /** 礼金单价；null = 不卖（只能靠任务 / 活动获得） */
  shopPrice: number | null;
  /** 每种道具的堆叠上限（发放超出的部分作废） */
  stackMax: number;
}

/** 道具配置表（数值已定，AISLG-222 需求单）。测试可临时改 shopPrice 验证调价，用完还原。 */
export const ITEM_DEFS: ItemDef[] = [
  {
    id: 'city_order',
    name: '迁城令',
    nameEn: 'City Move Order',
    desc: '消耗 1 张，随机迁城一次。',
    descEn: 'Uses 1 order to relocate the city once to a random spot.',
    kind: 'order',
    shopPrice: 50,
    stackMax: 99,
  },
  {
    id: 'city_order_adv',
    name: '高级迁城令',
    nameEn: 'Advanced City Move Order',
    desc: '消耗 1 张，指定坐标迁城一次。',
    descEn: 'Uses 1 order to relocate the city once to chosen coordinates.',
    kind: 'order',
    shopPrice: 100,
    stackMax: 99,
  },
];

/** 购买数量的合法范围（整数）；堆叠上限另由每种道具的 stackMax 决定 */
export const BUY_COUNT_MIN = 1;
export const BUY_COUNT_MAX = 99;

/** 消耗失败的错误码（数量不足时返回，数量与其他数据都不变） */
export const INSUFFICIENT_ITEM = 'INSUFFICIENT_ITEM' as const;

/** 是否为已定义的道具 id（未知 id 一律拒绝） */
export function isItemId(value: unknown): value is ItemId {
  return typeof value === 'string' && (ITEM_IDS as readonly string[]).includes(value);
}

/** 道具定义（未知 id 返回 null） */
export function itemDef(id: unknown): ItemDef | null {
  if (!isItemId(id)) {
    return null;
  }
  return ITEM_DEFS.find((def) => def.id === id) ?? null;
}

/** 在商店里出售的道具（shopPrice 非 null），按配置表顺序 */
export function shopItemDefs(): ItemDef[] {
  return ITEM_DEFS.filter((def) => def.shopPrice !== null);
}

/** 背包全量（每种道具都有键，缺省 0），用于 GET_ITEMS / GET_STATE 的 items 字段 */
export function emptyItems(): Record<ItemId, number> {
  const items = {} as Record<ItemId, number>;
  for (const def of ITEM_DEFS) {
    items[def.id] = 0;
  }
  return items;
}

/** 数量参数是否为正整数（发放 / 消耗 / 购买的数量校验共用） */
export function isPositiveCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
