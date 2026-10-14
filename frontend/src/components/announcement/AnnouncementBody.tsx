/** 公告正文渲染（AISLG-162，v60）：只认服务端过滤后的受限 Markdown 子集——段落（空行分隔）、段内换行、**加粗**、
 *  [文字](https 链接)。全部用 React 元素拼出，不走 innerHTML；非 http(s) 链接只渲染文字（双保险，服务端已过滤一次）。
 */

import { Fragment, type ReactNode } from 'react';

/** 行内记号：**加粗** 与 [文字](链接)；链接只认 http(s) */
const INLINE = /\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

function renderInline(line: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of line.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > last) {
      nodes.push(line.slice(last, start));
    }
    const key = `${keyPrefix}-${index}`;
    if (match[1] !== undefined) {
      nodes.push(<strong key={key} className="font-semibold text-fg">{match[1]}</strong>);
    } else {
      nodes.push(
        <a key={key} href={match[3]} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2 hover:text-fg">
          {match[2]}
        </a>,
      );
    }
    last = start + match[0].length;
    index += 1;
  }
  if (last < line.length) {
    nodes.push(line.slice(last));
  }
  return nodes;
}

export function AnnouncementBody({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).filter((paragraph) => paragraph.length > 0);
  return (
    <div role="公告正文" className="flex flex-col gap-2.5 text-[13px] leading-relaxed text-dim">
      {paragraphs.map((paragraph, pIndex) => (
        <p key={pIndex} className="break-words">
          {paragraph.split('\n').map((line, lIndex) => (
            <Fragment key={lIndex}>
              {lIndex > 0 ? <br /> : null}
              {renderInline(line, `${pIndex}-${lIndex}`)}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}
