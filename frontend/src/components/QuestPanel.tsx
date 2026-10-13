/** 任务面板（养成页，v56/v56 AISLG-200）：页签 = 日常（签到 + 6 条日常） / 主线 / 成就 / 活动。
 *  只做展示与触发，规则与奖励数值在服务端（common/src/quest.ts 与 quests.ts）；奖励发往主城，
 *  领取后城池资源随响应刷新。文案走 i18n 文案包（copy-quest.ts）。 */

import { useEffect, useState } from 'react';
import type { Resources } from '../api/protocol';
import type { AchievementView, ActivityView, MainStepView } from '../api/protocol-quests';
import { formatDate } from '../api/format';
import { useCopy } from '../i18n/bundle';
import { tName } from '../i18n/names';
import type { QuestSession } from '../state/questSession';
import { Card } from './ui/Card';

/** 资源奖励的可读文本，如「金+1500 木+1500」 */
function rewardText(r: Resources, labels: Record<keyof Resources, string>): string {
  return (Object.keys(labels) as (keyof Resources)[])
    .filter((k) => (r[k] ?? 0) > 0)
    .map((k) => `${labels[k]}+${r[k]}`)
    .join(' ');
}

type Tab = 'daily' | 'main' | 'achv' | 'act';

export function QuestPanel({ session }: { session: QuestSession }) {
  const copy = useCopy();
  const { QUEST_COPY } = copy;
  const [tab, setTab] = useState<Tab>('daily');
  const { quest, quests, activities, error, refresh } = session;

  // 每次打开养成页重新拉取：动作完成后的进度不推送，靠挂载时拉一次对齐
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const dailyClaimable = quest ? quest.daily.filter((t) => t.done && !t.claimed).length + (quest.signin.todaySigned ? 0 : 1) : 0;
  const mainClaimable = quests ? quests.main.steps.filter((s) => s.done && !s.claimed && s.unlocked).length : 0;
  const achvClaimable = quests ? quests.achievements.reduce((n, a) => n + a.tiers.filter((t) => t.done && !t.claimed).length, 0) : 0;
  const actClaimable = activities ? activities.reduce((n, a) => n + a.tiers.filter((t) => t.done && !t.claimed).length, 0) : 0;
  const totalClaimable = dailyClaimable + mainClaimable + achvClaimable + actClaimable;

  const tabs: { key: Tab; label: string; badge: number }[] = [
    { key: 'daily', label: QUEST_COPY.tabs.daily, badge: dailyClaimable },
    { key: 'main', label: QUEST_COPY.tabs.main, badge: mainClaimable },
    { key: 'achv', label: QUEST_COPY.tabs.achv, badge: achvClaimable },
    { key: 'act', label: QUEST_COPY.tabs.act, badge: actClaimable },
  ];

  return (
    <Card
      role="任务面板"
      title={QUEST_COPY.panel.title}
      meta={<span role="任务面板-可领取">{totalClaimable > 0 ? QUEST_COPY.panel.claimable(totalClaimable) : QUEST_COPY.panel.allClear}</span>}
    >
      <div role="任务面板-页签" className="flex shrink-0 gap-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role={`任务面板-页签-${t.key}`}
            className={`flex-1 rounded border px-1 py-1 text-[12px] ${tab === t.key ? 'border-accent-dim bg-accent-soft text-accent' : 'border-line-soft bg-panel-2 text-dim'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.badge > 0 ? <span className="ml-1 text-accent">({t.badge})</span> : null}
          </button>
        ))}
      </div>

      {error ? (
        <p role="任务面板-错误" className="shrink-0 truncate text-[12px] text-warn" title={error}>
          {error}
        </p>
      ) : null}

      {tab === 'daily' ? <DailyTab session={session} /> : null}
      {tab === 'main' ? <MainTab session={session} /> : null}
      {tab === 'achv' ? <AchvTab session={session} /> : null}
      {tab === 'act' ? <ActTab session={session} /> : null}
    </Card>
  );
}

function DailyTab({ session }: { session: QuestSession }) {
  const copy = useCopy();
  const { QUEST_COPY, RESOURCE_LABEL } = copy;
  const { quest, busy } = session;
  if (!quest) {
    return <p className="text-[12px] text-faint">{QUEST_COPY.panel.loading}</p>;
  }
  const { signin, daily } = quest;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div role="任务面板-签到" className="flex shrink-0 flex-col gap-1 rounded border border-line-soft bg-panel-2 px-2 py-1.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[12.5px] font-semibold">{QUEST_COPY.signin.title}</span>
          <span role="任务面板-连续签到" className="text-[11px] text-faint">
            {QUEST_COPY.signin.streak(signin.streak, signin.total)}
          </span>
          <button
            type="button"
            role="任务面板-签到按钮"
            disabled={busy || signin.todaySigned}
            onClick={() => void session.signin()}
            className="btn ml-auto shrink-0"
          >
            {signin.todaySigned ? QUEST_COPY.signin.signed : busy ? QUEST_COPY.signin.busy : QUEST_COPY.signin.button}
          </button>
        </div>
        <div role="任务面板-签到格" className="grid grid-cols-7 gap-1">
          {signin.days.map((d) => {
            const rw = rewardText(d.reward, RESOURCE_LABEL);
            const parts = rw.split(' ').map((p) => p.replace('+', ' '));
            return (
              <div
                key={d.day}
                title={QUEST_COPY.signin.dayTitle(d.day, rw)}
                className={`flex min-w-0 flex-col items-center overflow-hidden rounded border px-0.5 py-0.5 ${d.claimed ? 'border-accent-dim bg-accent-soft' : 'border-line-soft bg-panel'}`}
              >
                <span className="w-full truncate text-center text-[9px] leading-tight text-faint">{QUEST_COPY.signin.day(d.day)}</span>
                {d.claimed ? (
                  <span className="text-[11px] leading-tight text-accent">✔</span>
                ) : (
                  parts.map((p, i) => (
                    <span key={i} className="w-full break-words text-center text-[8.5px] leading-tight text-dim">
                      {p}
                    </span>
                  ))
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div role="任务面板-列表" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {daily.map((t) => (
          <div key={t.id} role={`任务面板-条目-${t.id}`} className="flex items-center gap-2 rounded border border-line-soft bg-panel-2 px-2 py-1">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px]">
                {tName(t.title)}
                {t.done ? <span className="ml-1 text-accent">✓</span> : null}
              </div>
              <div className="truncate text-[10.5px] text-faint" title={QUEST_COPY.reward.line(tName(t.desc), rewardText(t.reward, RESOURCE_LABEL))}>
                {QUEST_COPY.reward.line(tName(t.desc), rewardText(t.reward, RESOURCE_LABEL))}
              </div>
            </div>
            <button
              type="button"
              role={`任务面板-领取按钮-${t.id}`}
              disabled={busy || !t.done || t.claimed}
              onClick={() => void session.claimDaily(t.id)}
              className="btn shrink-0"
            >
              {t.claimed ? QUEST_COPY.panel.claimed : t.done ? QUEST_COPY.panel.claim : QUEST_COPY.panel.undone}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function MainTab({ session }: { session: QuestSession }) {
  const copy = useCopy();
  const { QUEST_COPY, RESOURCE_LABEL } = copy;
  const { quests, busy } = session;
  if (!quests) {
    return <p className="text-[12px] text-faint">{QUEST_COPY.panel.loading}</p>;
  }
  const { main } = quests;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="shrink-0 text-[11px] text-faint">{QUEST_COPY.main.progress(main.currentIndex, main.total)}</div>
      <div role="任务面板-主线列表" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {main.steps.map((s, i) => (
          <MainRow key={s.id} step={s} index={i} session={session} busy={busy} labels={RESOURCE_LABEL} />
        ))}
      </div>
    </div>
  );
}

function MainRow({ step, index, session, busy, labels }: { step: MainStepView; index: number; session: QuestSession; busy: boolean; labels: Record<keyof Resources, string> }) {
  const { QUEST_COPY } = useCopy();
  const state = step.claimed ? QUEST_COPY.panel.claimed : !step.unlocked ? QUEST_COPY.panel.locked : step.done ? QUEST_COPY.panel.claim : QUEST_COPY.panel.undone;
  return (
    <div
      role={`任务面板-主线-${step.id}`}
      className={`flex items-center gap-2 rounded border px-2 py-1 ${step.unlocked ? 'border-line-soft bg-panel-2' : 'border-line-soft bg-panel opacity-60'}`}
    >
      <span className="w-4 shrink-0 text-center text-[10.5px] text-faint">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px]">
          {tName(step.title)}
          {step.done ? <span className="ml-1 text-accent">✓</span> : null}
        </div>
        <div className="truncate text-[10.5px] text-faint" title={QUEST_COPY.reward.line(tName(step.desc), rewardText(step.reward, labels))}>
          {QUEST_COPY.reward.line(tName(step.desc), rewardText(step.reward, labels))}
        </div>
      </div>
      <button
        type="button"
        role={`任务面板-主线领取-${step.id}`}
        disabled={busy || !step.unlocked || !step.done || step.claimed}
        onClick={() => void session.claimQuest('main', step.id)}
        className="btn shrink-0"
      >
        {state}
      </button>
    </div>
  );
}

function AchvTab({ session }: { session: QuestSession }) {
  const copy = useCopy();
  const { QUEST_COPY, RESOURCE_LABEL } = copy;
  const { quests, busy } = session;
  if (!quests) {
    return <p className="text-[12px] text-faint">{QUEST_COPY.panel.loading}</p>;
  }
  return (
    <div role="任务面板-成就列表" className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
      {quests.side.length > 0 ? (
        <>
          <div className="shrink-0 text-[11px] text-faint">{QUEST_COPY.achv.sideLabel}</div>
          {quests.side.map((s) => (
            <div key={s.id} role={`任务面板-支线-${s.id}`} className="flex items-center gap-2 rounded border border-line-soft bg-panel-2 px-2 py-1">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px]">
                  {tName(s.title)}
                  {s.done ? <span className="ml-1 text-accent">✓</span> : null}
                </div>
                <div className="truncate text-[10.5px] text-faint" title={QUEST_COPY.reward.line(tName(s.desc), rewardText(s.reward, RESOURCE_LABEL))}>
                  {QUEST_COPY.reward.line(tName(s.desc), rewardText(s.reward, RESOURCE_LABEL))}
                </div>
              </div>
              <button
                type="button"
                role={`任务面板-支线领取-${s.id}`}
                disabled={busy || !s.done || s.claimed}
                onClick={() => void session.claimQuest('side', s.id)}
                className="btn shrink-0"
              >
                {s.claimed ? QUEST_COPY.panel.claimed : s.done ? QUEST_COPY.panel.claim : QUEST_COPY.panel.undone}
              </button>
            </div>
          ))}
          <div className="mt-1 shrink-0 text-[11px] text-faint">{QUEST_COPY.achv.achvLabel}</div>
        </>
      ) : null}
      {quests.achievements.map((a) => (
        <AchvRow key={a.id} a={a} session={session} busy={busy} labels={RESOURCE_LABEL} />
      ))}
    </div>
  );
}

function AchvRow({ a, session, busy, labels }: { a: AchievementView; session: QuestSession; busy: boolean; labels: Record<keyof Resources, string> }) {
  const { QUEST_COPY } = useCopy();
  return (
    <div role={`任务面板-成就-${a.id}`} className="flex flex-col gap-1 rounded border border-line-soft bg-panel-2 px-2 py-1">
      <div className="flex items-baseline gap-2">
        <span className="text-[12.5px]">{tName(a.title)}</span>
        <span className="text-[10.5px] text-faint">
          {tName(a.desc)} · {QUEST_COPY.achv.current(a.value)}
        </span>
      </div>
      <div className="flex gap-1">
        {a.tiers.map((t) => (
          <div key={t.tier} className="flex min-w-0 flex-1 flex-col gap-0.5 rounded border border-line-soft bg-panel px-1 py-0.5">
            <span className="break-words text-[10px] leading-tight text-faint" title={QUEST_COPY.achv.tierTitle(t.threshold, rewardText(t.reward, labels))}>
              {t.threshold} · {rewardText(t.reward, labels)}
            </span>
            <button
              type="button"
              role={`任务面板-成就领取-${a.id}-${t.tier}`}
              disabled={busy || !t.done || t.claimed}
              onClick={() => void session.claimQuest('achv', `${a.id}:${t.tier - 1}`)}
              className="btn w-full shrink-0"
            >
              {t.claimed ? QUEST_COPY.panel.claimed : t.done ? QUEST_COPY.panel.claim : QUEST_COPY.panel.notReached}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActTab({ session }: { session: QuestSession }) {
  const copy = useCopy();
  const { QUEST_COPY, RESOURCE_LABEL } = copy;
  const { activities, busy } = session;
  if (!activities) {
    return <p className="text-[12px] text-faint">{QUEST_COPY.panel.loading}</p>;
  }
  return (
    <div role="任务面板-活动列表" className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
      {activities.map((a) => (
        <ActRow key={a.id} a={a} session={session} busy={busy} labels={RESOURCE_LABEL} />
      ))}
    </div>
  );
}

function ActRow({ a, session, busy, labels }: { a: ActivityView; session: QuestSession; busy: boolean; labels: Record<keyof Resources, string> }) {
  const { QUEST_COPY } = useCopy();
  const ends = a.endsAt ? formatDate(a.endsAt) : null;
  const head = a.daily ? QUEST_COPY.act.dailyTag : ends ? QUEST_COPY.act.endsTag(ends) : '';
  return (
    <div role={`任务面板-活动-${a.id}`} className="flex flex-col gap-1 rounded border border-line-soft bg-panel-2 px-2 py-1">
      <div className="flex items-baseline gap-2">
        <span className="text-[12.5px] font-semibold">{tName(a.title)}</span>
        <span className="min-w-0 break-words text-[10.5px] text-faint" title={tName(a.desc)}>
          {head} · {tName(a.desc)}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {a.tiers.map((t) => (
          <div key={t.id} role={`任务面板-活动档-${t.id}`} className="flex items-center gap-2 rounded border border-line-soft bg-panel px-2 py-0.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11.5px]">{tName(t.title)}</div>
              <div className="truncate text-[10px] text-faint">{QUEST_COPY.act.rewardLine(rewardText(t.reward, labels))}</div>
            </div>
            <button
              type="button"
              role={`任务面板-活动领取-${t.id}`}
              disabled={busy || !t.done || t.claimed}
              onClick={() => void session.claimActivity(t.id)}
              className="btn shrink-0"
            >
              {t.claimed ? QUEST_COPY.panel.claimed : t.done ? QUEST_COPY.panel.claim : QUEST_COPY.panel.notReached}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
