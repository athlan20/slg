import type { CityView } from '../api/protocol';
import { BUILD_QUEUE_CAPACITY } from '../api/protocol';
// role 定位值取静态中文文案源（AISLG-137 约定：role 不随界面语言变）
import { BUILDING_LABEL as BUILDING_LABEL_ZH } from '../copy';
import { useCopy } from '../i18n/bundle';
import { useNow } from '../state/useNow';
import { Card } from './ui/Card';

interface BuildQueuePanelProps {
  city: CityView | null;
  buildError: string | null;
  /** 取消排队条目（CANCEL_BUILD：全额返还成本；仅排队中的条目可取消） */
  onCancelBuild: (buildId: string) => void;
}

/** 建造队列条（城池页顶部，一直可见）：三个槽位 = 1 在建 + 最多 2 排队，空位也显示（「空位 · 可排队建造」），
 *  一眼看出还能不能再排。每个槽位带建筑 / 动作 / 发起者标签（玩家 / Agent）；在建槽位显示剩余时间与进度条；
 *  排队槽位带取消按钮（全额返还成本），在建的不可取消。 */
export function BuildQueuePanel({ city, buildError, onCancelBuild }: BuildQueuePanelProps) {
  const copy = useCopy();
  const { BUILDING_LABEL, CITY_PAGE_COPY, COPY, IDENTITY_LABEL, buildActionText } = copy;
  const queue = city?.queue ?? [];
  const hasActive = queue.some((item) => item.status === 'building');
  // 在建倒计时按本地时钟推进；完成与否以服务端推送 / 查询为准
  const now = useNow(hasActive);
  const slots = Array.from({ length: 1 + BUILD_QUEUE_CAPACITY }, (_, index) => queue[index] ?? null);

  return (
    <Card
      role="建造队列面板"
      title={COPY.buildQueue.title}
      meta={queue.length === 0 ? <span role="建造队列面板-空闲">{COPY.buildQueue.idle}</span> : CITY_PAGE_COPY.queueMeta(queue.length, slots.length)}
      className="shrink-0"
    >
      <div role="建造队列面板-列表" className="grid grid-cols-3 gap-2 max-sm:gap-1">
        {slots.map((item, index) => {
          if (item === null) {
            return (
              <div
                key={`empty-${index}`}
                role="建造队列面板-空位"
                className="grid min-h-[58px] short:min-h-[44px] place-items-center rounded-md border border-dashed border-line px-2 text-center text-[12px] text-faint max-sm:text-[11px]"
              >
                {CITY_PAGE_COPY.emptySlot}
              </div>
            );
          }
          const label = BUILDING_LABEL[item.kind];
          const active = item.status === 'building';
          const totalMs = active && item.dueAt ? Date.parse(item.dueAt) - Date.parse(item.startedAt) : 0;
          const remaining = active && item.dueAt ? Math.max(0, Math.ceil((Date.parse(item.dueAt) - now) / 1000)) : 0;
          const progress = active && totalMs > 0 ? Math.min(100, Math.round(((now - Date.parse(item.startedAt)) / totalMs) * 100)) : 0;
          return (
            <div
              key={item.id}
              role={`建造队列面板-条目-${BUILDING_LABEL_ZH[item.kind].short}`}
              className={`flex min-h-[58px] short:min-h-[50px] min-w-0 flex-col justify-between gap-1 rounded-md border px-2.5 py-1.5 ${
                active ? 'border-accent-dim bg-accent-soft' : 'border-line-soft bg-panel-2'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[13px] font-semibold">
                  <span className={`mr-1.5 font-mono text-[11.5px] font-normal ${active ? 'text-accent' : 'text-faint'}`}>
                    {active ? COPY.buildQueue.active : COPY.buildQueue.queuedAt(index)}
                  </span>
                  {label.name}
                  <span className={`ml-1.5 font-mono text-[11.5px] font-normal ${active ? 'text-accent' : 'text-dim'}`}>{buildActionText(item.level)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className={`tag ${item.initiator === 'player' ? 'actor-player' : ''}`}>{IDENTITY_LABEL[item.initiator]}</span>
                  {active ? null : (
                    <button
                      type="button"
                      role={`建造队列面板-取消-${BUILDING_LABEL_ZH[item.kind].short}`}
                      title={COPY.buildQueue.cancelTitle}
                      aria-label={`${COPY.buildQueue.cancel}${label.name}`}
                      className="grid h-4 w-4 place-items-center rounded border border-line-soft bg-panel text-[11px] leading-none text-faint transition-colors hover:border-accent-dim hover:text-accent"
                      onClick={() => onCancelBuild(item.id)}
                    >
                      ✕
                    </button>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="bar h-[4px] flex-1">
                  <i style={{ width: `${progress}%` }} />
                </div>
                <span className={`shrink-0 font-mono text-[12px] ${active ? 'text-accent' : 'text-faint'}`}>
                  {active
                    ? item.dueAt
                      ? remaining > 0
                        ? COPY.buildQueue.remainingSeconds(remaining)
                        : COPY.buildQueue.waitingSettle
                      : COPY.buildQueue.activating
                    : COPY.buildQueue.waitingStart}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {buildError ? (
        <p className="truncate rounded border border-line-soft bg-panel-2 px-2 py-1 text-[12px] text-dim" role="建造队列面板-建造错误" title={buildError}>
          {buildError}
        </p>
      ) : null}
    </Card>
  );
}
