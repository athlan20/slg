/** 选中目标面板的关闭按钮（✕，取消选中）：已探索的格（TargetHeader）与未探索的迷雾格共用。
 *  手机上地图页的详情区没有分段条，靠它回到地图（MapPage 的 forceTab 随选中清空而收起）。
 */

import { useCopy } from '../../i18n/bundle';

export function TargetCloseButton({ onClose }: { onClose: () => void }) {
  const { TARGET_COPY } = useCopy();
  return (
    <button
      type="button"
      role="选中详情-关闭按钮"
      aria-label={TARGET_COPY.close}
      title={TARGET_COPY.close}
      onClick={onClose}
      className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[14px] leading-none text-faint hover:text-fg"
    >
      ✕
    </button>
  );
}
