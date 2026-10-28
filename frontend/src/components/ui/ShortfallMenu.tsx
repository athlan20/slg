/** 消耗行上标「缺」的资源：点开浮层，选择集市兑换 / 去对应建筑 / 去地图补齐。
 *  浮层经 portal 挂到 body，避免被城池详情卡 overflow-hidden 裁切。
 */

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { BUILDING_LEVEL_MAX, EXCHANGE_INPUT_PER_GOLD, type BuildingKind, type CityView, type Resources } from '../../api/protocol';
import { formatDurationText } from '../../api/format';
// role 定位值取静态中文文案源（AISLG-137 约定：role 不随界面语言变）
import { RESOURCE_LABEL as RESOURCE_LABEL_ZH } from '../../copy';
import { useCopy } from '../../i18n/bundle';
import { useNav } from '../../state/NavContext';

const GAP = 6;
const EDGE = 8;

/** 五种资源各自的生产建筑（与 BUILDING_LABEL.resource 对齐） */
const PRODUCER: Record<keyof Resources, BuildingKind> = {
  gold: 'government',
  food: 'farm',
  wood: 'lumber_mill',
  stone: 'quarry',
  iron: 'iron_mine',
};

export interface CostPartData {
  key: keyof Resources;
  label: string;
  value: number;
  insufficient: boolean;
}

interface CostPartProps {
  part: CostPartData;
  city: CityView;
  /** role 前缀，如「城池页-建筑详情」→ 触发器 / 浮层 / 选项沿用此前缀 */
  rolePrefix: string;
  insufficientLabel: string;
  /** 前一项后面的分隔，如「 · 」 */
  prefix?: string;
  /** 当前正在看的建筑：与生产建筑相同时不再提供「去建造/升级」 */
  currentKind?: BuildingKind;
}

export function CostPart({ part, city, rolePrefix, insufficientLabel, prefix, currentKind }: CostPartProps) {
  if (!part.insufficient) {
    return (
      <span>
        {prefix}
        {part.label} {part.value}
      </span>
    );
  }
  return (
    <ShortfallTrigger part={part} city={city} rolePrefix={rolePrefix} insufficientLabel={insufficientLabel} prefix={prefix} currentKind={currentKind} />
  );
}

function ShortfallTrigger({ part, city, rolePrefix, insufficientLabel, prefix, currentKind }: CostPartProps) {
  const { SHORTFALL_COPY } = useCopy();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const trigger = triggerRef.current;
    const pop = popRef.current;
    if (!trigger || !pop) {
      return;
    }
    const t = trigger.getBoundingClientRect();
    const p = pop.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fitsBelow = t.bottom + GAP + p.height <= vh - EDGE;
    const fitsAbove = t.top - GAP - p.height >= EDGE;
    const topWanted = fitsBelow || !fitsAbove ? t.bottom + GAP : t.top - GAP - p.height;
    const leftWanted = t.left + p.width > vw - EDGE ? t.right - p.width : t.left;
    setPos({
      top: Math.min(Math.max(EDGE, topWanted), Math.max(EDGE, vh - EDGE - p.height)),
      left: Math.min(Math.max(EDGE, leftWanted), Math.max(EDGE, vw - EDGE - p.width)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !popRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      {prefix}
      <button
        ref={triggerRef}
        type="button"
        role={`${rolePrefix}-消耗-缺口-${RESOURCE_LABEL_ZH[part.key]}`}
        aria-label={SHORTFALL_COPY.openAria(part.label)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={SHORTFALL_COPY.openTitle}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex cursor-pointer items-baseline gap-0.5 whitespace-nowrap rounded border border-accent/50 bg-accent-soft px-1 font-mono text-accent transition-colors hover:border-accent"
      >
        {part.label} {part.value}
        {insufficientLabel}
        <span aria-hidden="true" className="text-[10px] text-accent">
          {SHORTFALL_COPY.chevron}
        </span>
      </button>
      {open
        ? createPortal(
            <ShortfallPopover
              popRef={popRef}
              pos={pos}
              part={part}
              city={city}
              rolePrefix={rolePrefix}
              currentKind={currentKind}
              onClose={() => setOpen(false)}
            />,
            document.body,
          )
        : null}
    </>
  );
}

function ShortfallPopover({
  popRef,
  pos,
  part,
  city,
  rolePrefix,
  currentKind,
  onClose,
}: {
  popRef: RefObject<HTMLDivElement | null>;
  pos: { top: number; left: number } | null;
  part: CostPartData;
  city: CityView;
  rolePrefix: string;
  currentKind?: BuildingKind;
  onClose: () => void;
}) {
  const copy = useCopy();
  const { SHORTFALL_COPY, BUILDING_LABEL } = copy;
  const { go, selectBuilding, requestExchange } = useNav();
  const have = city.resources[part.key];
  const missing = Math.max(0, part.value - have);
  const rate = part.key === 'food' ? city.production.food - city.armyFoodUsePerHour : city.production[part.key];
  const eta = rate > 0 && missing > 0 ? Math.ceil((missing / rate) * 3600) : null;
  const producer = PRODUCER[part.key];
  const producerLevel = city.levels[producer] ?? 0;
  const producerMax = city.levelMax?.[producer] ?? BUILDING_LEVEL_MAX;
  const showBuilding = currentKind !== producer && producerLevel < producerMax;
  const goldCover =
    part.key === 'gold' ? Math.floor((city.resources.food + city.resources.wood + city.resources.stone + city.resources.iron) / EXCHANGE_INPUT_PER_GOLD) : 0;

  const pick = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <div
      ref={popRef}
      role={`${rolePrefix}-获取途径-${RESOURCE_LABEL_ZH[part.key]}`}
      className="fixed z-50 flex w-[min(280px,calc(100vw-16px))] flex-col gap-1.5 rounded-md border border-accent-dim bg-panel-2 px-2.5 py-2 text-[12px] leading-snug text-fg shadow-2xl"
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p role={`${rolePrefix}-获取途径-标题`} className="min-w-0 truncate font-semibold">
          {SHORTFALL_COPY.title(part.label, missing)}
        </p>
        <button
          type="button"
          role={`${rolePrefix}-获取途径-关闭`}
          aria-label={SHORTFALL_COPY.closeAria}
          className="cursor-pointer px-1 text-sm text-faint transition-colors hover:text-accent"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <p className="font-mono text-[11.5px] text-dim">{SHORTFALL_COPY.have(have, part.value)}</p>
      <p className={`font-mono text-[11.5px] ${eta === null ? 'text-warn' : 'text-faint'}`}>
        {eta === null ? SHORTFALL_COPY.noRate : SHORTFALL_COPY.eta(formatDurationText(eta), rate)}
      </p>

      {part.key === 'gold' ? (
        <OptionButton
          role={`${rolePrefix}-获取途径-集市`}
          primary={goldCover >= missing}
          title={SHORTFALL_COPY.exchange.title}
          hint={goldCover >= missing ? SHORTFALL_COPY.exchange.hintCovered(missing) : SHORTFALL_COPY.exchange.hintShort}
          onClick={() => pick(() => requestExchange(missing))}
        />
      ) : null}

      {showBuilding ? (
        <OptionButton
          role={`${rolePrefix}-获取途径-建筑`}
          title={
            producerLevel > 0
              ? SHORTFALL_COPY.building.titleUpgrade(BUILDING_LABEL[producer].name)
              : SHORTFALL_COPY.building.titleBuild(BUILDING_LABEL[producer].name)
          }
          hint={
            producerLevel > 0
              ? SHORTFALL_COPY.building.hintUpgrade(part.label)
              : SHORTFALL_COPY.building.hintBuild(part.label)
          }
          onClick={() =>
            pick(() => {
              selectBuilding(producer);
              go('city');
            })
          }
        />
      ) : null}

      <OptionButton
        role={`${rolePrefix}-获取途径-地图`}
        title={part.key === 'gold' ? SHORTFALL_COPY.map.titleGold : SHORTFALL_COPY.map.titleOther}
        hint={part.key === 'gold' ? SHORTFALL_COPY.map.hintGold : SHORTFALL_COPY.map.hintOther(part.label)}
        onClick={() => pick(() => go('map'))}
      />
    </div>
  );
}

function OptionButton({
  role,
  title,
  hint,
  onClick,
  primary = false,
}: {
  role: string;
  title: string;
  hint: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      role={role}
      onClick={onClick}
      className={`flex cursor-pointer flex-col items-start rounded border px-2 py-1.5 text-left transition-colors ${
        primary
          ? 'border-accent-dim bg-accent-soft hover:border-accent'
          : 'border-line-soft bg-panel hover:border-accent-dim'
      }`}
    >
      <span className="text-[12.5px] font-semibold">{title}</span>
      <span className="text-[11px] leading-snug text-faint">{hint}</span>
    </button>
  );
}
