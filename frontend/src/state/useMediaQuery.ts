// 媒体查询订阅（AISLG-231）：返回当前是否匹配，窗口尺寸变化时跟着更新。
// 用于按宽度决定「渲染哪一种」而不是渲染两份再用 CSS 藏一份（那样同一功能的 role 会重复出现）。

import { useEffect, useState } from 'react';

/** 首帧就取真实值（懒初始化），避免宽屏先闪一下窄屏布局 */
function readMatch(query: string): boolean {
  return typeof window === 'undefined' ? false : window.matchMedia(query).matches;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => readMatch(query));

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    // 挂载与 query 变化时对齐一次，之后由 change 事件驱动
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
