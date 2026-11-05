// 迁城确认框（v91，AISLG-220）：打开即走 MOVE_CITY preview，展示消耗、新位置、距离与旧格去向；确认后带 confirm 执行。
// 预览不满足时只显示服务端原因（不给确认按钮），令不足时给「去商店购买」入口。

import { useEffect, useState } from 'react';
import { useCopy } from '../../i18n/bundle';
import type { MoveCityMode, MoveCityPreviewData } from '../../api/protocol';
import type { MoveCitySession, MoveTarget } from '../../state/moveCitySession';
import { Modal } from '../ui/Modal';

type Load =
  | { status: 'loading' }
  | { status: 'ready'; data: MoveCityPreviewData }
  | { status: 'error'; message: string; code: string | undefined };

interface MoveCityConfirmProps {
  cityId: string;
  mode: MoveCityMode;
  target: MoveTarget | null;
  moveCity: MoveCitySession;
  /** 取消（回到上一层） */
  onCancel: () => void;
  /** 迁城成功（整个流程结束） */
  onDone: () => void;
  onBuyItems: () => void;
}

export function MoveCityConfirm({ cityId, mode, target, moveCity, onCancel, onDone, onBuyItems }: MoveCityConfirmProps) {
  const { MOVE_CITY_COPY: C, ITEM_COPY } = useCopy();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const targetX = target?.x ?? null;
  const targetY = target?.y ?? null;

  useEffect(() => {
    let alive = true;
    setLoad({ status: 'loading' });
    void moveCity.preview(cityId, mode, target).then((out) => {
      if (!alive) {
        return;
      }
      setLoad(out.ok ? { status: 'ready', data: out.data } : { status: 'error', message: out.message, code: out.code });
    });
    return () => {
      alive = false;
    };
    // 预览只依赖城、方式与坐标；moveCity 每次渲染都是新对象，不作为依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId, mode, targetX, targetY]);

  const submit = async () => {
    setBusy(true);
    setSubmitError(null);
    const out = await moveCity.execute(cityId, mode, target);
    setBusy(false);
    if (out.ok) {
      onDone();
    } else {
      setSubmitError(out.message);
    }
  };

  return (
    <Modal role="迁城确认框" title={C.confirmTitle} size="sm" accent="warn" onClose={onCancel}>
      {load.status === 'loading' ? <p role="迁城确认-加载" className="text-[13px] text-faint">{C.loading}</p> : null}
      {load.status === 'error' ? (
        <div role="迁城确认-不能迁" className="flex flex-col gap-2">
          <p className="break-words text-[13px] text-st-error">{load.message || C.previewFailed}</p>
          {load.code === 'INSUFFICIENT_ITEM' ? (
            <button type="button" role="迁城确认-去商店按钮" className="btn self-start" onClick={() => { onCancel(); onBuyItems(); }}>
              {C.buyItem}
            </button>
          ) : null}
        </div>
      ) : null}
      {load.status === 'ready' ? (
        <div role="迁城确认-明细" className="flex flex-col gap-1 text-[13px] text-dim">
          <p role="迁城确认-消耗" className="break-words">{C.willConsume(ITEM_COPY.names[load.data.itemId], load.data.count)}</p>
          {load.data.to ? (
            <p role="迁城确认-新位置" className="break-words">{C.target(load.data.to.x, load.data.to.y)}</p>
          ) : (
            <p role="迁城确认-随机选址" className="break-words">{C.randomNote}</p>
          )}
          {load.data.distance !== null ? <p role="迁城确认-距离" className="break-words">{C.distance(load.data.distance)}</p> : null}
          <p role="迁城确认-旧位置" className="break-words">{load.data.oldTile === 'wilderness' ? C.oldMain : C.oldBranch}</p>
          {load.data.attackLockSeconds !== null ? <p role="迁城确认-出征限制" className="break-words text-warn">{C.lockNote}</p> : null}
        </div>
      ) : null}
      {submitError ? <p role="迁城确认-提交错误" className="break-words text-[12px] text-st-error">{submitError}</p> : null}
      <div role="迁城确认-操作区" className="flex justify-end gap-2 pt-1">
        <button type="button" role="迁城确认-取消按钮" className="btn" onClick={onCancel}>
          {C.cancel}
        </button>
        <button
          type="button"
          role="迁城确认-确认按钮"
          className="btn px-3"
          disabled={load.status !== 'ready' || busy}
          onClick={() => void submit()}
        >
          {busy ? C.submitting : C.submit}
        </button>
      </div>
    </Modal>
  );
}
