// 英文文案孪生（AISLG-137）：copy-troop-pools.ts 的逐成员 satisfies 对应中文对象的类型，漏译在 tsc 就报错。

import type { TROOP_POOL_ALL_COPY } from './copy-troop-pools';

export const TROOP_POOL_ALL_COPY_EN = {
  summary: (poolLabel: string, total: number, citiesWith: number) => `All cities: ${poolLabel} ${total} (${citiesWith} ${citiesWith === 1 ? 'city' : 'cities'})`,
  earliest: (remain: string) => ` · earliest expires in ${remain}`,
  empty: 'All cities: none',
  healAll: 'Heal all',
  abandonAll: 'Abandon all',
  recruitAll: 'Recruit all',
  releaseAll: 'Release all',
  recallAll: 'Recall all',
  dialogTitleRestore: 'Process all cities',
  dialogTitleRelease: 'Abandon in all cities',
  rowHost: (name: string, isMain: boolean) => (isMain ? `${name} (main)` : name),
  rowJoin: ' · ',
  rowFree: 'Free, nothing returned',
  rowSkippedStarving: 'Skipped: starving',
  rowPopulation: (n: number) => `population −${n}`,
  totalCost: (cost: string) => `Total cost: ${cost}`,
  totalFree: 'Total: free, nothing returned',
  totalSkipped: (n: number) => ` (${n} ${n === 1 ? 'city' : 'cities'} starving, skipped)`,
  confirm: 'Process',
  cancel: 'Cancel',
  busy: 'Processing…',
  resultTitle: 'Results',
  resultSuccess: 'Success',
  resultFailed: 'Failed',
  resultSummary: (ok: number, failed: number) => `${ok} succeeded · ${failed} failed`,
  resultAllOk: (ok: number) => `${ok} ${ok === 1 ? 'city' : 'cities'} processed`,
  done: 'Got it',
  offline: 'Disconnected, cannot process',
} satisfies typeof TROOP_POOL_ALL_COPY;
