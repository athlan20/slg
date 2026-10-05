import { useEffect, useState } from 'react';

/** 本地时钟秒级推进：active 时每秒钟刷新一次（如在建倒计时），inactive 时停表 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}
