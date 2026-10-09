// 「分享到聊天」按钮（AISLG-138）：各页面的分享入口共用样式；点击后卡片放进聊天输入框并展开浮窗。

export function ChatShareButton({
  role,
  label,
  onClick,
  disabled = false,
}: {
  role: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role={role}
      disabled={disabled}
      onClick={onClick}
      className="shrink-0 cursor-pointer rounded border border-line px-1.5 py-0 text-[11px] text-dim hover:border-accent hover:text-accent disabled:cursor-default disabled:opacity-50"
    >
      {label}
    </button>
  );
}
