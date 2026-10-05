/** 页面网格外壳：桌面按页面固定网格（见 styles/shell.css 的 .p-*）同时摆出各区块；
 *  < 1024 每页只显示一个区块，顶部分段条切换（地图页 / 城池页还可由「选中目标 / 建筑」强制切到详情块）。
 */

import { useState, type ReactNode } from 'react';

export interface PageBlock {
  key: string;
  /** 手机分段条上的名字 */
  label: string;
  node: ReactNode;
  /** 对应 shell.css 的 grid-area 类（a-map / a-ctx / a-lanes 等） */
  areaClass?: string;
  /** 1024–1279 两栏时隐藏（三栏页的第三块） */
  hideMd?: boolean;
  /** 手机上也常驻显示（不参与分段切换，按内容高度） */
  always?: boolean;
  /** 按内容高度（定高块，不均分剩余空间） */
  fit?: boolean;
}

interface PageGridProps {
  role: string;
  /** shell.css 里的页面网格类：p-overview / p-map / ... */
  layout: string;
  blocks: PageBlock[];
  /** 手机上强制显示的区块 key（如地图页选中地块后显示详情）；null = 由分段条决定 */
  forceTab?: string | null;
  /** 手机上不显示分段条（页面自己提供返回按钮，如地图页的 ✕） */
  hideTabs?: boolean;
  /** 手机上默认显示的区块 key（缺省第一块） */
  defaultTab?: string;
}

export function PageGrid({ role, layout, blocks, forceTab = null, hideTabs = false, defaultTab }: PageGridProps) {
  const tabbable = blocks.filter((block) => !block.always);
  const [tab, setTab] = useState(defaultTab ?? tabbable[0].key);
  const active = forceTab ?? (tabbable.some((block) => block.key === tab) ? tab : tabbable[0].key);

  return (
    <div role={role} className={`work ${layout}`}>
      {tabbable.length > 1 && !hideTabs ? (
        <div role={`${role}-分段条`} className="mobile-tabs">
          {tabbable.map((block) => (
            <button
              key={block.key}
              type="button"
              role={`${role}-分段-${block.label}`}
              className={active === block.key ? 'on' : ''}
              onClick={() => setTab(block.key)}
            >
              {block.label}
            </button>
          ))}
        </div>
      ) : null}
      {blocks.map((block) => (
        <div
          key={block.key}
          className={`block ${block.areaClass ?? ''} ${block.hideMd ? 'hide-md' : ''} ${block.always ? 'always' : ''} ${block.fit ? 'fit' : ''} ${active === block.key ? 'on' : ''}`}
        >
          {block.node}
        </div>
      ))}
    </div>
  );
}
