// 页面导航状态（docs/frontend-nav-layout.md 第 4 节）：当前页面存在 location.hash，刷新后停在原页；
// 不引入路由库，只读写 hash 并监听 hashchange。

import { useCallback, useEffect, useState } from 'react';

export const PAGE_KEYS = ['overview', 'map', 'city', 'army', 'growth', 'intel', 'agent'] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

const DEFAULT_PAGE: PageKey = 'overview';

function readHash(): PageKey {
  const raw = window.location.hash.replace(/^#/, '');
  return (PAGE_KEYS as readonly string[]).includes(raw) ? (raw as PageKey) : DEFAULT_PAGE;
}

export function usePage(): [PageKey, (page: PageKey) => void] {
  const [page, setPage] = useState<PageKey>(readHash);

  useEffect(() => {
    const onHash = () => setPage(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((next: PageKey) => {
    if (window.location.hash !== `#${next}`) {
      window.location.hash = next;
    }
    setPage(next);
  }, []);

  return [page, go];
}
