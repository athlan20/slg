// 有联盟时「标记」页签（AISLG-184，F2）：本盟全部有效标记，PagedList 分页列出（类型、坐标、附言、打标人、剩余时间）。
// 「定位」收起联盟弹窗并跳到地图对应坐标（同聊天卡片的做法）；本人打的标记可删，盟主 / 副盟主可删任何人的（二次确认，原地展开）。
// 行高固定（附言与打标人截断），删除确认只在按钮区展开，不让行变高（PagedList 只在列表区尺寸变化时重新分页）。

import { useState } from 'react';
import { allianceMarkErrorText } from '../../api/errorText';
import { formatDurationText } from '../../api/format';
import { ALLIANCE_MARK_MAX, type AllianceMarkView } from '../../api/protocol';
import { useCopy } from '../../i18n/bundle';
import type { AllianceMarksSession } from '../../state/allianceMarks';
import { useNow } from '../../state/useNow';
import { PagedList } from '../ui/PagedList';
import { AllianceMarkGlyph } from '../worldMapMarks';
import { InlineConfirm } from './allianceParts';

interface AllianceMarkPanelProps {
  marks: AllianceMarksSession;
  myId: string | null;
  onLocate: (x: number, y: number) => void;
}

export function AllianceMarkPanel({ marks, myId, onLocate }: AllianceMarkPanelProps) {
  const { ALLIANCE_COPY: COPY } = useCopy();
  const now = useNow(true);
  const [error, setError] = useState<string | null>(null);
  // 服务端已过滤过期项；这里按本地时钟再去掉刚到期、尚未被刷新的
  const rows = marks.marks.filter((mark) => Date.parse(mark.expiresAt) > now);

  const remove = async (mark: AllianceMarkView) => {
    setError(null);
    const result = await marks.remove(mark.id);
    if (!result.ok) {
      setError(allianceMarkErrorText(result.error.code, result.error.message, result.error.data));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2 text-[11.5px] text-faint">
        <span className="min-w-0 flex-1 truncate">{COPY.marks.panelHint(ALLIANCE_MARK_MAX, 24)}</span>
        <span className="shrink-0 font-mono">{COPY.marks.count(rows.length, ALLIANCE_MARK_MAX)}</span>
      </div>
      {marks.canRemoveAny ? <p className="shrink-0 truncate text-[11.5px] text-dim">{COPY.marks.removeAnyHint}</p> : null}
      {error ? (
        <p role="联盟弹窗-标记-错误" className="shrink-0 truncate text-[12px] text-st-error" title={error}>
          {error}
        </p>
      ) : null}
      {!marks.loaded ? (
        <p className="py-6 text-center text-[13px] text-faint">{marks.loadFailed ? COPY.marks.loadFailed : COPY.marks.loading}</p>
      ) : (
        <PagedList
          role="联盟弹窗-标记列表"
          items={rows}
          keyOf={(mark) => mark.id}
          gap={2}
          gapClass="gap-0.5"
          empty={<p className="py-6 text-center text-[13px] text-faint">{COPY.marks.empty}</p>}
          renderRow={(mark) => {
            const canRemove = mark.creator.accountId === myId || marks.canRemoveAny;
            const left = Math.max(0, Math.ceil((Date.parse(mark.expiresAt) - now) / 1000));
            return (
              <div role="联盟弹窗-标记条目" className="flex min-w-0 flex-col gap-0.5 border-b border-line-soft py-1 text-[12px]">
                <div className="flex min-w-0 items-center gap-1.5">
                  <AllianceMarkGlyph kind={mark.kind} />
                  <b className="shrink-0">{COPY.marks.kindLabel[mark.kind]}</b>
                  <span className="shrink-0 font-mono text-dim">
                    ({mark.x},{mark.y})
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-faint">{COPY.marks.expiresIn(formatDurationText(left))}</span>
                </div>
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-dim" title={mark.text}>
                    {mark.text || COPY.marks.noText}
                  </span>
                  <span className="shrink-0 truncate text-[11px] text-faint" title={COPY.marks.by(mark.creator.username)}>
                    {mark.creator.username}
                  </span>
                  <button type="button" role="联盟弹窗-标记-定位" onClick={() => onLocate(mark.x, mark.y)} className="btn shrink-0 px-2 py-0 text-[11px]">
                    {COPY.marks.locate}
                  </button>
                  {canRemove ? (
                    <InlineConfirm
                      role={`联盟弹窗-标记-删除-${mark.id}`}
                      label={COPY.marks.remove}
                      confirmLabel={COPY.confirm.yes}
                      danger
                      disabled={marks.busy}
                      onConfirm={() => remove(mark)}
                    />
                  ) : null}
                </div>
              </div>
            );
          }}
        />
      )}
    </div>
  );
}
