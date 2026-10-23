// 日志节流（AISLG-173）：同一 key 在时间窗口内只放行一行，被合并的条数在下一次放行时附带。
// 风暴（上千条同类失败）时靠它把日志量压在固定上限内；时钟可注入，便于测试。

/** key 数量上限：超过即清空重算，防止异常 key 无限增长占用内存（正常使用远低于此） */
const MAX_KEYS = 1000;

export class LogThrottle {
  private readonly entries = new Map<string, { at: number; suppressed: number }>();

  constructor(private readonly clock: () => number = Date.now) {}

  /**
   * 判定本次是否输出：窗口内返回 null（合并，不输出）；放行时返回自上次放行以来被合并的条数（0 表示没有合并）。
   */
  take(key: string, windowMs: number): number | null {
    const now = this.clock();
    const entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= MAX_KEYS) {
        this.entries.clear();
      }
      this.entries.set(key, { at: now, suppressed: 0 });
      return 0;
    }
    if (now - entry.at < windowMs) {
      entry.suppressed += 1;
      return null;
    }
    const suppressed = entry.suppressed;
    entry.at = now;
    entry.suppressed = 0;
    return suppressed;
  }
}
