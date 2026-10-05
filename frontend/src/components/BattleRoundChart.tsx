/** 战报伤害走势图（SVG 累计双线）：按本账号视角（role 选边）把攻/守伤害换算成我方/敌方，
 *  绘制双方累计伤害曲线；开头双方零伤害的连续区间是「接敌推进」阶段（双方尚未够到对方），
 *  以浅色底纹标出。从 BattleReportModal 拆出以控制单文件行数。
 */

import type { BattleReportView } from '../api/protocol';
import { COPY } from '../copy';

/** SVG 画布（viewBox 固定，随容器宽度整体缩放；描边用 non-scaling-stroke 保持 1px） */
const W = 320;
const H = 110;
const PAD = 8;

interface BattleRoundChartProps {
  report: BattleReportView;
}

export function BattleRoundChart({ report }: BattleRoundChartProps) {
  // 视角换算：roundLog 的 attacker/defender 是绝对攻守身份，我方/敌方按 role 选边
  const mineIsAttacker = report.role === 'attacker';
  let myCum = 0;
  let enemyCum = 0;
  const points = report.roundLog.map((entry) => {
    myCum += mineIsAttacker ? entry.attackerDamage : entry.defenderDamage;
    enemyCum += mineIsAttacker ? entry.defenderDamage : entry.attackerDamage;
    return { round: entry.round, myCum, enemyCum };
  });
  const n = points.length;
  const maxCum = Math.max(1, myCum, enemyCum);
  const x = (index: number) => (n <= 1 ? W / 2 : PAD + (index / (n - 1)) * (W - PAD * 2));
  const y = (value: number) => H - PAD - (value / maxCum) * (H - PAD * 2);
  const line = (key: 'myCum' | 'enemyCum') =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');

  // 接敌推进段：从头起双方累计伤害均为 0 的连续回合（至少 2 回合才有标注意义）
  let approachEnd = 0;
  while (approachEnd < n && points[approachEnd].myCum === 0 && points[approachEnd].enemyCum === 0) {
    approachEnd += 1;
  }
  const showApproach = approachEnd >= 2 && approachEnd < n;

  return (
    <div role="战报弹窗-走势图">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-28 w-full rounded border border-line-soft bg-panel-2"
        role="img"
      >
        {showApproach ? (
          <rect
            x={x(0)}
            y={PAD}
            width={Math.max(2, x(approachEnd - 1) - x(0))}
            height={H - PAD * 2}
            fill="var(--line-soft)"
            opacity={0.5}
          />
        ) : null}
        {/* 零伤害基线 */}
        <line x1={PAD} y1={y(0)} x2={W - PAD} y2={y(0)} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <path d={line('enemyCum')} fill="none" stroke="var(--warn)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <path d={line('myCum')} fill="none" stroke="var(--accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {n > 0 ? (
          <>
            <circle cx={x(n - 1)} cy={y(myCum)} r={2.5} fill="var(--accent)" />
            <circle cx={x(n - 1)} cy={y(enemyCum)} r={2.5} fill="var(--warn)" />
          </>
        ) : null}
        {showApproach ? (
          <text
            x={(x(0) + x(approachEnd - 1)) / 2}
            y={PAD + 9}
            textAnchor="middle"
            fill="var(--text-faint)"
            style={{ fontSize: 10 }}
          >
            {COPY.battleReport.chartApproach}
          </text>
        ) : null}
      </svg>
      <div role="战报弹窗-走势图例" className="mt-1 flex items-center justify-between font-mono text-[12px]">
        <span className="text-accent">
          ▬ {COPY.battleReport.chartMine} {Math.round(myCum)}
        </span>
        <span className="text-warn">
          {COPY.battleReport.chartEnemy} {Math.round(enemyCum)} ▬
        </span>
      </div>
    </div>
  );
}
