/** 地图标记表单（AISLG-184，F2）：选中格上「打标记」——四种类型单选 + 一句话（去首尾空白后 ≤ 20 字，可不填）。
 *  同一格已有标记时按钮禁用并说明；成功后标记并入本盟列表（会话切片 allianceMarks 负责）。服务端的上限与唯一判定为准。
 */

import { useState } from 'react';
import { allianceMarkErrorText } from '../../../api/errorText';
import { ALLIANCE_MARK_KINDS, ALLIANCE_MARK_TEXT_MAX_CHARS, type AllianceMarkKind } from '../../../api/protocol';
import { useCopy } from '../../../i18n/bundle';
import type { AllianceMarksSession } from '../../../state/allianceMarks';
import { glyphCount, INPUT_CLASS } from '../../alliance/allianceParts';
import { AllianceMarkGlyph } from '../../worldMapMarks';
import { ConfirmButton } from './ConfirmButton';

interface MarkFormProps {
  x: number;
  y: number;
  marks: AllianceMarksSession;
  /** 本格已有（未过期的）标记 */
  hasMark: boolean;
}

export function MarkForm({ x, y, marks, hasMark }: MarkFormProps) {
  const { ALLIANCE_COPY: COPY } = useCopy();
  const [kind, setKind] = useState<AllianceMarkKind>('rally');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const trimmed = text.trim();
  const tooLong = glyphCount(trimmed) > ALLIANCE_MARK_TEXT_MAX_CHARS;
  const disabledReason = hasMark ? COPY.marks.existsHere : tooLong ? COPY.markErrors.INVALID_PARAMS : null;

  const submit = async () => {
    if (marks.busy || disabledReason !== null) {
      return;
    }
    setError(null);
    setDone(null);
    const result = await marks.add(x, y, kind, trimmed);
    if (result.ok) {
      setText('');
      setDone(COPY.marks.added);
    } else {
      setError(allianceMarkErrorText(result.error.code, result.error.message, result.error.data));
    }
  };

  return (
    <div role="选中详情-标记表单" className="flex min-w-0 flex-col gap-1.5">
      <p className="text-[11.5px] text-faint">{COPY.marks.formTitle}</p>
      <div role="选中详情-标记-类型" className="flex flex-wrap gap-1" aria-label={COPY.marks.kindField}>
        {ALLIANCE_MARK_KINDS.map((item) => (
          <button
            key={item}
            type="button"
            role={`选中详情-标记-类型-${item}`}
            aria-pressed={kind === item}
            onClick={() => setKind(item)}
            className={`flex cursor-pointer items-center gap-1 rounded border px-2 py-0.5 text-[12px] ${
              kind === item ? 'border-accent bg-accent-soft text-accent' : 'border-line text-dim hover:text-fg'
            }`}
          >
            <AllianceMarkGlyph kind={item} />
            {COPY.marks.kindLabel[item]}
          </button>
        ))}
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <input
          type="text"
          role="选中详情-标记-附言"
          value={text}
          placeholder={COPY.marks.textPlaceholder(ALLIANCE_MARK_TEXT_MAX_CHARS)}
          onChange={(event) => {
            setError(null);
            setDone(null);
            setText(event.target.value);
          }}
          className={`${INPUT_CLASS} min-w-0 flex-1 py-1`}
        />
        <span className={`shrink-0 font-mono text-[11px] ${tooLong ? 'text-warn' : 'text-faint'}`}>
          {COPY.marks.textCounter(glyphCount(trimmed), ALLIANCE_MARK_TEXT_MAX_CHARS)}
        </span>
      </div>
      <ConfirmButton
        role="选中详情-标记-提交"
        label={COPY.marks.submit}
        busy={marks.busy}
        disabledReason={disabledReason}
        onClick={() => void submit()}
      />
      {error ? (
        <p role="选中详情-标记-错误" className="line-clamp-2 text-[12px] text-warn" title={error}>
          {error}
        </p>
      ) : done ? (
        <p role="选中详情-标记-完成" className="text-[12px] text-accent">
          {done}
        </p>
      ) : null}
    </div>
  );
}
