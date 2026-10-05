/** 随队将领选择器（v36 AISLG-114）：出征 / 侦察 / 截击 / 运输表单共用。从 HeroContext 读可选武将与当前选择；
 *  重伤 / 欠饷 / 在外 / 城守的武将置灰并标原因（预判，权威判定在服务端）；选中后预览按编队规模折算的实际加成。
 *  没有武将时不渲染。
 */

import { HERO_COPY } from '../copy-hero';
import { useHeroPick } from '../state/heroContext';
import { heroUnavailableReason } from '../state/heroSession';
import { useNow } from '../state/useNow';

interface HeroPickerProps {
  /** 编队总兵数（统率摊薄预览用）；未编队传 0 */
  troopTotal: number;
}

/** 加成预览：镜像服务端 heroBattleBonus（封顶 20%、统率 × 20 以内吃满、超出摊薄），仅作展示 */
function previewBonus(lead: number, force: number, wit: number, troopTotal: number) {
  const leadCap = lead * 20;
  const scale = troopTotal <= 0 ? 1 : Math.min(1, leadCap / troopTotal);
  const atk = Math.min(20, force * 0.3) * scale;
  const def = Math.min(20, wit * 0.3) * scale;
  return { atk: Math.round(atk * 10) / 10, def: Math.round(def * 10) / 10, scale };
}

export function HeroPicker({ troopTotal }: HeroPickerProps) {
  const pick = useHeroPick();
  const now = useNow(false);
  if (!pick || pick.heroes.length === 0) {
    return null;
  }
  const selected = pick.heroes.find((hero) => hero.id === pick.selectedHeroId) ?? null;
  const bonus = selected ? previewBonus(selected.lead, selected.force, selected.wit, troopTotal) : null;

  return (
    <div role="随队将领选择" className="flex flex-col gap-0.5">
      <label className="flex items-center justify-between gap-2 text-[12px]">
        <span className="shrink-0 text-dim">{HERO_COPY.picker.label}</span>
        <select
          role="随队将领下拉"
          value={pick.selectedHeroId ?? ''}
          onChange={(event) => pick.selectHero(event.target.value === '' ? null : event.target.value)}
          className="min-w-0 max-w-[14rem] flex-1 rounded border border-line bg-bg px-1 py-0.5 text-[12px] text-fg outline-none focus:border-accent-dim"
        >
          <option value="">{HERO_COPY.picker.none}</option>
          {pick.heroes.map((hero) => {
            const reason = heroUnavailableReason(hero, now);
            return (
              <option key={hero.id} value={hero.id} disabled={reason !== null}>
                {HERO_COPY.picker.option(hero.name, hero.level, hero.lead, hero.force, hero.wit)}
                {reason ? `（${HERO_COPY.picker.unavailable[reason]}）` : ''}
              </option>
            );
          })}
        </select>
      </label>
      {bonus ? (
        <p role="随队将领加成预览" className="truncate text-[11.5px] text-faint" title={troopTotal > 0 ? HERO_COPY.picker.preview(bonus.atk, bonus.def, bonus.scale) : HERO_COPY.picker.previewIdle}>
          {troopTotal > 0 ? HERO_COPY.picker.preview(bonus.atk, bonus.def, bonus.scale) : HERO_COPY.picker.previewIdle}
        </p>
      ) : null}
    </div>
  );
}
