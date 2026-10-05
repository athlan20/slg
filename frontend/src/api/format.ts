// 时间与时长的人读格式化（从 api/mapping.ts 拆出）：只做「值 → 文案格式」，
// 不依赖协议类型与全局文案（copy.ts），供事件文字、错误提示与各面板倒计时共用。

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour12: false });
}

/** 战报时间（列表 / 详情用）：当天只显示时刻，跨天补月日 */
export function formatReportTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const clock = date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
  return sameDay ? clock : `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`;
}

/** 秒数的人读时长（顶栏免战倒计时、资源缺口攒够预估等共用）：<1 分钟给秒，<1 小时给分秒，再往上给时分 */
export function formatDurationText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) {
    return `${s} 秒`;
  }
  if (s < 3600) {
    const m = Math.floor(s / 60);
    return m >= 10 || s % 60 === 0 ? `${m} 分` : `${m} 分 ${s % 60} 秒`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h} 小时 ${m} 分`;
}

/** 紧凑数字（顶栏资源格等窄位置）：< 1 万原样带千分位，≥ 1 万折成 k / m（1 位小数，整数去掉小数） */
export function compactNumber(value: number): string {
  const n = Math.floor(value);
  const abs = Math.abs(n);
  if (abs < 10_000) {
    return n.toLocaleString('en-US');
  }
  const [divisor, unit] = abs >= 1_000_000 ? [1_000_000, 'm'] : [1_000, 'k'];
  const scaled = n / divisor;
  return `${scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10}${unit}`;
}
