// 战报详情弹窗的全局宿主：Provider 挂在 App 根部，任意组件经 useBattleReportModal()
// 拿到打开句柄即可弹出同一份战报弹窗（展示组件见 components/BattleReportModal）。
// 两种打开形态（docs/battle-report-api.md 第 6 节「战报入口盘点」）：
// - openBattleReport(report)：手里已有完整战报（列表 / 推送），直接按引用快照展示；
// - openBattleReportById(reportId)：事件流等只有 reportId 的入口，经注入的
//   fetchReportById 反查（期间弹窗显示加载 / 失败态）。

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BattleReportCommentView, BattleReportView } from '../api/protocol';
import { BattleReportModal } from '../components/BattleReportModal';
import { useCopy } from '../i18n/bundle';

/** 战报点评的模块级事件总线（v23 AISLG-53）：推送到达时 emit，Provider 若正开着
 *  同一份战报就地把点评补进弹窗（不依赖重新打开）。 */
const commentEventTarget = new EventTarget();

export function emitBattleCommentPatched(reportId: number, comment: BattleReportCommentView): void {
  commentEventTarget.dispatchEvent(new CustomEvent('comment', { detail: { reportId, comment } }));
}

export interface BattleReportModalApi {
  /** 弹出指定战报的详情弹窗（重复打开新战报会替换当前弹窗）；shareable 默认 true（本人战报可分享到聊天，聊天里打开的别人的战报不可） */
  openBattleReport: (report: BattleReportView, options?: { shareable?: boolean }) => void;
  /** 只有战报 id 的入口（事件流 detail.reportId）：反查成功后弹出，失败给提示态 */
  openBattleReportById: (reportId: number) => void;
  closeBattleReport: () => void;
}

type ModalState =
  | { status: 'ready'; report: BattleReportView; shareable: boolean }
  | { status: 'loading' | 'error'; reportId: number };

interface BattleReportModalProviderProps {
  children: ReactNode;
  /** 按 id 反查单份战报（worldSession.fetchBattleReportById；查不到返回 null） */
  fetchReportById: (reportId: number) => Promise<BattleReportView | null>;
  /** 点「分享」：把这份战报放进聊天输入框（AISLG-138；缺省则弹窗不显示分享按钮） */
  onShareReport?: (report: BattleReportView) => void;
}

const BattleReportModalContext = createContext<BattleReportModalApi | null>(null);

export function BattleReportModalProvider({ children, fetchReportById, onShareReport }: BattleReportModalProviderProps) {
  const copy = useCopy();
  const { COPY } = copy;
  const [state, setState] = useState<ModalState | null>(null);
  /** 反查请求序号：关闭或被新打开取代后，迟到的响应直接丢弃 */
  const requestSeqRef = useRef(0);

  // 战报点评推送（v23 AISLG-53）：正开着同一份战报时，就地补进弹窗快照
  useEffect(() => {
    const onComment = (event: Event) => {
      const detail = (event as CustomEvent<{ reportId: number; comment: BattleReportCommentView }>).detail;
      setState((prev) =>
        prev && prev.status === 'ready' && prev.report.id === detail.reportId
          ? { ...prev, report: { ...prev.report, comment: detail.comment } }
          : prev,
      );
    };
    commentEventTarget.addEventListener('comment', onComment);
    return () => commentEventTarget.removeEventListener('comment', onComment);
  }, []);

  const openBattleReport = useCallback((report: BattleReportView, options?: { shareable?: boolean }) => {
    requestSeqRef.current += 1;
    setState({ status: 'ready', report, shareable: options?.shareable ?? true });
  }, []);

  const openBattleReportById = useCallback(
    (reportId: number) => {
      const seq = ++requestSeqRef.current;
      setState({ status: 'loading', reportId });
      fetchReportById(reportId)
        .then((report) => {
          if (requestSeqRef.current === seq) {
            setState(report ? { status: 'ready', report, shareable: true } : { status: 'error', reportId });
          }
        })
        .catch(() => {
          if (requestSeqRef.current === seq) {
            setState({ status: 'error', reportId });
          }
        });
    },
    [fetchReportById],
  );

  const closeBattleReport = useCallback(() => {
    requestSeqRef.current += 1;
    setState(null);
  }, []);

  const api = useMemo(
    () => ({ openBattleReport, openBattleReportById, closeBattleReport }),
    [openBattleReport, openBattleReportById, closeBattleReport],
  );

  return (
    <BattleReportModalContext.Provider value={api}>
      {children}
      {state?.status === 'ready' ? (
        <BattleReportModal
          report={state.report}
          onClose={closeBattleReport}
          onShare={state.shareable && onShareReport ? () => onShareReport(state.report) : undefined}
        />
      ) : state ? (
        <div
          role="战报弹窗-加载态"
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={closeBattleReport}
        >
          <div className="panel flex w-72 flex-col items-center gap-2 p-4" onClick={(event) => event.stopPropagation()}>
            <p className={`text-[13px] ${state.status === 'error' ? 'text-warn' : 'text-dim'}`}>
              {state.status === 'loading' ? COPY.battleReport.loading : COPY.battleReport.loadFailed}
            </p>
            <button type="button" role="战报弹窗-加载态关闭按钮" className="btn px-3" onClick={closeBattleReport}>
              {COPY.battleReport.close}
            </button>
          </div>
        </div>
      ) : null}
    </BattleReportModalContext.Provider>
  );
}

/** 取战报弹窗的打开 / 关闭句柄（需在 BattleReportModalProvider 内） */
export function useBattleReportModal(): BattleReportModalApi {
  const api = useContext(BattleReportModalContext);
  if (!api) {
    throw new Error('useBattleReportModal 需在 BattleReportModalProvider 内使用');
  }
  return api;
}
