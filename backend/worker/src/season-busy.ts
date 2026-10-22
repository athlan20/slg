// Worker 进程内的换季协调（AISLG-134，docs/season-system.md §2.5）：
// - 换季进行中（resetting）时，NPC 袭击定时器、排行榜定时刷新等旁路任务不再发起新工作；
// - 换季开始前已在途的旁路任务登记在册，换季先 drain 等它们结束再动数据，避免写到已清空的世界。
// 主循环 tick 本身由 index.ts 保证不重叠（换季在 tick 内串行执行），这里只管 tick 之外的定时器。

const inFlight = new Set<Promise<unknown>>();
let resetting = false;

/** 换季是否正在本进程内进行 */
export function isSeasonResetting(): boolean {
  return resetting;
}

export function setSeasonResetting(value: boolean): void {
  resetting = value;
}

/** 登记一个旁路任务（返回原 promise，调用方照常 .catch / .finally） */
export function trackWorkerJob<T>(job: Promise<T>): Promise<T> {
  inFlight.add(job);
  const done = (): void => {
    inFlight.delete(job);
  };
  job.then(done, done);
  return job;
}

/** 等待当前登记在册的旁路任务全部结束（换季动数据之前调用） */
export async function drainWorkerJobs(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight]);
  }
}
