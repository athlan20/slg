// 联盟面板的共用小部件：二次确认按钮、职位标签、在线 / 最近上线文字、联盟名校验。
// 确认不弹第二层弹窗（弹窗叠弹窗在窄屏上会盖住内容），而是把按钮原地换成「确认 / 取消」。

import { useState, type ReactNode } from 'react';
import type { AllianceRole } from '../../api/protocol';
import { formatReportTime } from '../../api/format';
import { ALLIANCE_NAME_MAX_CHARS, ALLIANCE_NAME_MIN_CHARS } from '../../api/protocol';
import { useCopy } from '../../i18n/bundle';

/** 联盟名：去首尾空白后 2–8 字，中间不能有空白或控制字符（与服务端 normalizeAllianceName 同口径，屏蔽词只在服务端判） */
export function isValidAllianceName(raw: string): boolean {
  const name = raw.trim();
  const len = [...name].length;
  return len >= ALLIANCE_NAME_MIN_CHARS && len <= ALLIANCE_NAME_MAX_CHARS && !/[\s\p{C}]/u.test(name);
}

/** 字形计数（公告 / 标记的字数上限按字形算，emoji 与中文都算一个字） */
export function glyphCount(text: string): number {
  return [...text].length;
}

export const INPUT_CLASS = 'rounded border border-line-soft bg-panel-2 px-2 py-1.5 text-[13px] outline-none focus:border-accent-dim disabled:opacity-60';

interface InlineConfirmProps {
  /** 第一次点击前的按钮文字 */
  label: string;
  /** 确认按钮文字 */
  confirmLabel: string;
  /** 确认前显示的提示（说明后果） */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  role: string;
  onConfirm: () => Promise<unknown> | void;
}

/** 两步按钮：第一次点击展开「确认 / 取消」，确认后执行 */
export function InlineConfirm({ label, confirmLabel, hint, danger = false, disabled = false, title, role, onConfirm }: InlineConfirmProps) {
  const { ALLIANCE_COPY } = useCopy();
  const [armed, setArmed] = useState(false);
  const tone = danger ? 'text-st-error' : '';
  if (!armed) {
    return (
      <button type="button" role={role} title={title} disabled={disabled} onClick={() => setArmed(true)} className={`btn px-2 py-0.5 ${tone}`}>
        {label}
      </button>
    );
  }
  return (
    <span role={`${role}-确认区`} className="flex flex-wrap items-center gap-1.5">
      {hint ? <span className="text-[11.5px] text-dim">{hint}</span> : null}
      <button
        type="button"
        role={`${role}-确认`}
        disabled={disabled}
        onClick={() => {
          setArmed(false);
          void onConfirm();
        }}
        className={`btn px-2 py-0.5 ${danger ? 'border-st-error text-st-error' : ''}`}
      >
        {confirmLabel}
      </button>
      <button type="button" role={`${role}-取消`} onClick={() => setArmed(false)} className="btn px-2 py-0.5 text-dim">
        {ALLIANCE_COPY.confirm.no}
      </button>
    </span>
  );
}

const ROLE_TONE: Record<AllianceRole, string> = {
  leader: 'border-gold text-gold',
  vice: 'border-accent-dim text-accent',
  member: 'border-line text-dim',
};

/** 职位标签：用文字区分（盟主 / 副盟主 / 成员），颜色只是辅助 */
export function RoleTag({ role }: { role: AllianceRole }) {
  const { ALLIANCE_COPY } = useCopy();
  return <span className={`shrink-0 rounded border px-1 text-[10.5px] ${ROLE_TONE[role]}`}>{ALLIANCE_COPY.role[role]}</span>;
}

/** 在线标记 / 最近上线时刻 */
export function ActivityText({ online, lastActiveAt }: { online: boolean; lastActiveAt: string | null }): ReactNode {
  const { ALLIANCE_COPY } = useCopy();
  if (online) {
    return <span className="text-st-online">● {ALLIANCE_COPY.members.online}</span>;
  }
  if (lastActiveAt === null) {
    return <span className="text-faint">{ALLIANCE_COPY.members.neverActive}</span>;
  }
  return <span className="font-mono text-faint">{ALLIANCE_COPY.members.lastActive(formatReportTime(lastActiveAt))}</span>;
}
