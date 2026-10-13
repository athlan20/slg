// 阵容编辑（v55 从竞技场面板拆出，竞技场与将星塔共用）：3 个号位各选一名武将，保存即提交 SET_ARENA_LINEUP。
// role 前缀由调用方传入（子元素按 `${role}-1号位`、`${role}-保存` 命名，便于定位）。阵容为 null 表示尚未加载。

import { useEffect, useState } from 'react';
import type { ArenaFighterView } from '../api/protocol';
import type { HeroView } from '../api/protocol-hero';

export interface LineupCopy {
  title: string;
  slot: (n: number) => string;
  emptySlot: string;
  noHeroes: string;
  save: string;
  saving: string;
  stats: (lead: number, force: number, wit: number) => string;
  /** 还没入榜（阵容全空）时的提示 */
  joinHint: string;
}

interface LineupEditorProps {
  role: string;
  /** 我的武将（号位下拉的候选） */
  heroes: HeroView[];
  /** 服务端的当前阵容；null = 尚未加载 */
  lineup: Array<ArenaFighterView | null> | null;
  busy: boolean;
  copy: LineupCopy;
  /** 标题是否在编辑器内显示（外层已有卡片标题时关掉） */
  showTitle?: boolean;
  onSave: (heroIds: Array<string | null>) => void;
}

/** 阵容的 heroId 串：只在服务端阵容真的变了时才重置编辑草稿（推送刷新不冲掉正在编辑的号位） */
function lineupKeyOf(lineup: Array<ArenaFighterView | null> | null): string {
  return lineup ? lineup.map((f) => f?.heroId ?? '-').join(',') : '';
}

export function LineupEditor({ role, heroes, lineup, busy, copy, showTitle = true, onSave }: LineupEditorProps) {
  const [draft, setDraft] = useState<Array<string | null>>([null, null, null]);
  const lineupKey = lineupKeyOf(lineup);

  useEffect(() => {
    if (lineup) {
      setDraft(lineup.map((f) => f?.heroId ?? null));
    }
    // 只依赖阵容的 key：lineup 数组每次拉取都会换，直接依赖会冲掉正在编辑的号位
  }, [lineupKey]);

  const joined = lineup !== null && lineup.some((f) => f !== null);
  const draftFilled = draft.some((id) => id !== null);
  const dirty = lineup !== null && draft.some((id, i) => id !== (lineup[i]?.heroId ?? null));

  return (
    <div role={role} className="flex shrink-0 flex-col gap-1 rounded-[5px] border border-line-soft bg-panel-2 px-2 py-1.5">
      {showTitle || (lineup !== null && !joined) ? (
        <div className="flex items-baseline justify-between gap-2">
          {showTitle ? <span className="text-[12.5px] font-semibold">{copy.title}</span> : <span />}
          {lineup !== null && !joined ? <span className="truncate text-[11px] text-warn">{copy.joinHint}</span> : null}
        </div>
      ) : null}
      {heroes.length === 0 ? (
        <p className="truncate text-[11.5px] text-warn">{copy.noHeroes}</p>
      ) : (
        <div className="grid grid-cols-3 gap-1">
          {draft.map((id, index) => {
            const taken = new Set(draft.filter((other, i) => i !== index && other !== null));
            return (
              <label key={index} className="flex min-w-0 flex-col gap-0.5 text-[11px] text-faint">
                <span className="truncate">{copy.slot(index + 1)}</span>
                <select
                  role={`${role}-${index + 1}号位`}
                  value={id ?? ''}
                  disabled={busy}
                  onChange={(event) => {
                    const next = event.target.value === '' ? null : event.target.value;
                    setDraft((prev) => prev.map((old, i) => (i === index ? next : old)));
                  }}
                  className="min-w-0 truncate rounded border border-line bg-panel px-1 py-0.5 text-[12px] text-text"
                >
                  <option value="">{copy.emptySlot}</option>
                  {heroes
                    .filter((hero) => !taken.has(hero.id))
                    .map((hero) => (
                      <option key={hero.id} value={hero.id}>
                        {`${hero.name} · ${copy.stats(hero.lead, hero.force, hero.wit)}`}
                      </option>
                    ))}
                </select>
              </label>
            );
          })}
        </div>
      )}
      <button
        type="button"
        role={`${role}-保存`}
        disabled={busy || heroes.length === 0 || !draftFilled || (joined && !dirty)}
        onClick={() => onSave(draft)}
        className="btn w-full truncate"
      >
        {busy ? copy.saving : copy.save}
      </button>
    </div>
  );
}
