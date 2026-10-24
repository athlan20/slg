/** 选中格上的联盟标记（AISLG-184，F2）：有标记时显示类型 / 附言 / 打标人 / 剩余时间，成员可删自己的，盟主 / 副盟主可删任何人的；
 *  没有标记时说明「本格暂无标记」。只在有联盟时出现（TargetPanel 判断）。
 */

import { useState } from 'react';
import { allianceMarkErrorText } from '../../api/errorText';
import { formatDurationText } from '../../api/format';
import { useCopy } from '../../i18n/bundle';
import type { AllianceMarksSession } from '../../state/allianceMarks';
import { InlineConfirm } from '../alliance/allianceParts';
import { AllianceMarkGlyph } from '../worldMapMarks';

interface TargetMarkNoteProps {
  x: number;
  y: number;
  marks: AllianceMarksSession;
  myId: string | null;
  now: number;
}

export function TargetMarkNote({ x, y, marks, myId, now }: TargetMarkNoteProps) {
  const { ALLIANCE_COPY: COPY } = useCopy();
  const [error, setError] = useState<string | null>(null);
  const mark = marks.marks.find((item) => item.x === x && item.y === y && Date.parse(item.expiresAt) > now) ?? null;
  const canRemove = mark !== null && (mark.creator.accountId === myId || marks.canRemoveAny);

  if (mark === null) {
    return (
      <p role="选中详情-标记-无" className="shrink-0 text-[11.5px] text-faint">
        {COPY.marks.tileNone}
      </p>
    );
  }
  const left = Math.max(0, Math.ceil((Date.parse(mark.expiresAt) - now) / 1000));
  return (
    <div role="选中详情-标记-有" className="flex shrink-0 flex-col gap-0.5 rounded-[5px] border border-line-soft bg-panel-2 px-2 py-1 text-[11.5px]">
      <div className="flex min-w-0 items-center gap-1.5">
        <AllianceMarkGlyph kind={mark.kind} />
        <b className="shrink-0">{COPY.marks.kindLabel[mark.kind]}</b>
        <span className="min-w-0 flex-1 truncate text-dim" title={mark.text}>
          {mark.text || COPY.marks.noText}
        </span>
        {canRemove ? (
          <InlineConfirm
            role="选中详情-标记-删除"
            label={COPY.marks.remove}
            confirmLabel={COPY.confirm.yes}
            hint={COPY.marks.removeHint}
            danger
            disabled={marks.busy}
            onConfirm={async () => {
              setError(null);
              const result = await marks.remove(mark.id);
              if (!result.ok) {
                setError(allianceMarkErrorText(result.error.code, result.error.message, result.error.data));
              }
            }}
          />
        ) : null}
      </div>
      <p className="truncate text-faint">
        {COPY.marks.by(mark.creator.username)} · {COPY.marks.expiresIn(formatDurationText(left))}
      </p>
      {error ? <p role="选中详情-标记-删除错误" className="truncate text-warn">{error}</p> : null}
    </div>
  );
}
