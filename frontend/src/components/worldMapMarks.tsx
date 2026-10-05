/** 世界地图的地形 / 城池视觉符号：地块网格（WorldMapGrid）与图例（WorldMapView）共用，
 *  保证图例里看到的样子就是地图上的样子。
 *  地形 = 底色（themes.css --t-*，随皮肤变）+ 每种地形一枚带色相的描边图标；
 *  城池 = 形状区分敌我（本方圆角发光块 / NPC 菱形 / 他方方块），不只靠颜色。
 */

import type { TerrainKind } from '../api/protocol';

/** 地形底色（themes.css --t-*，五套皮肤各自配色；金矿 v19 起有独立地形色） */
export const TERRAIN_CLASS: Record<string, string> = {
  plain: 'bg-t-plain',
  grass: 'bg-t-grass',
  forest: 'bg-t-forest',
  hill: 'bg-t-hill',
  desert: 'bg-t-desert',
  marsh: 'bg-t-marsh',
  lake: 'bg-t-lake',
  gold_mine: 'bg-t-gold',
};

/** 地形图标：16×16 描边路径 + 图标色相（底色很接近时靠图标色相区分地形；
 *  选 400/500 档并降透明度，深浅皮肤下都可读） */
const TERRAIN_ICON: Record<TerrainKind, { paths: string[]; tint: string }> = {
  plain: { paths: ['M3 7.5 H13', 'M2 11 H14', 'M5 4 H11'], tint: 'text-slate-500/60' },
  grass: {
    paths: ['M3 13 Q4 9 3 6', 'M6 13 Q6 8 8 5', 'M9.5 13 Q10 9 9 6.5', 'M12.5 13 Q12.5 9.5 14 7.5'],
    tint: 'text-lime-500/55',
  },
  forest: { paths: ['M8 2.5 L12 8 H4 Z', 'M8 6.5 L12.5 12.5 H3.5 Z', 'M8 12.5 V14.5'], tint: 'text-emerald-500/60' },
  hill: { paths: ['M2 12.5 L6.5 4.5 L9 9 L10.5 6.5 L14 12.5 Z'], tint: 'text-orange-400/55' },
  desert: { paths: ['M1.5 11.5 Q5 7 8.5 11.5', 'M7 11.5 Q10.5 6.5 14.5 11.5', 'M12 3.5 A1.5 1.5 0 1 0 12 3.6'], tint: 'text-amber-400/55' },
  marsh: { paths: ['M2 13 H14', 'M5 13 V7', 'M8 13 V4.5', 'M11 13 V8', 'M8 7 Q10 6 10.5 4'], tint: 'text-violet-400/55' },
  lake: { paths: ['M2 6.5 Q4 4.5 6 6.5 T10 6.5 T14 6.5', 'M2 10.5 Q4 8.5 6 10.5 T10 10.5 T14 10.5'], tint: 'text-sky-500/60' },
  gold_mine: { paths: ['M4.5 5.5 H11.5 L13.5 10.5 H2.5 Z', 'M6.5 5.5 L5.5 10.5 M9.5 5.5 L10.5 10.5'], tint: 'text-gold/85' },
};

export function TerrainIcon({ terrain, className = '' }: { terrain: TerrainKind; className?: string }) {
  const icon = TERRAIN_ICON[terrain] ?? TERRAIN_ICON.plain;
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`${icon.tint} ${className}`}
    >
      {icon.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** 城池归属：本方 / NPC / 他方玩家 */
export type CitySide = 'own' | 'npc' | 'famous' | 'enemy';

/** 城池标记（尺寸由外层 className 决定，地图里随格子缩放，图例里固定小号） */
export function CityMark({ side, className = '' }: { side: CitySide; className?: string }) {
  if (side === 'own') {
    return (
      <span
        aria-hidden="true"
        className={`grid aspect-square place-items-center rounded bg-accent font-semibold leading-none text-bg shadow-[0_0_10px_var(--accent)] ${className}`}
      >
        城
      </span>
    );
  }
  if (side === 'famous') {
    // 名城（v24 AISLG-56）：金边八角感方块 + 「名」字，一眼与普通 NPC 菱形区分
    return (
      <span
        aria-hidden="true"
        className={`grid aspect-square place-items-center rounded-[3px] border-2 border-gold bg-warn font-semibold leading-none text-bg shadow-[0_0_10px_var(--gold)] ${className}`}
      >
        名
      </span>
    );
  }
  if (side === 'npc') {
    return (
      <span aria-hidden="true" className={`grid aspect-square place-items-center ${className}`}>
        <span className="col-start-1 row-start-1 h-[78%] w-[78%] rotate-45 rounded-[2px] bg-gold" />
        <span className="relative col-start-1 row-start-1 font-semibold leading-none text-bg">N</span>
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`grid aspect-square place-items-center rounded-[2px] bg-warn font-semibold leading-none text-bg ${className}`}
    >
      城
    </span>
  );
}

/** 野地等级的视觉分档：等级越高（原住守军越强）数字越醒目，扫一眼就能挑软柿子 */
export function levelTone(level: number): string {
  if (level >= 8) {
    return 'text-warn font-semibold';
  }
  if (level >= 5) {
    return 'text-dim';
  }
  return 'text-faint';
}
