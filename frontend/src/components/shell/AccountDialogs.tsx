/** 账号相关确认框（从旧 TopBar 拆出）：切换账号确认 / 重置账号二次确认（不可逆）/ 城池改名。
 *  不可撤销的操作保留确认框（docs 第 7 节）；宽度 ≤ 400px。role 名沿用旧约定，e2e 依赖它们。
 */

import { useState, type FormEvent } from 'react';
import { useCopy } from '../../i18n/bundle';
import { tName } from '../../i18n/names';
import type { CityList } from '../../state/useCityList';
import { Modal } from '../ui/Modal';
import { AccountSettingsDialog } from '../account/AccountSettingsDialog';

export type AccountDialogMode = 'switch' | 'reset' | 'rename' | 'settings' | 'discard' | 'capital';

/** 设为主城的冷却基准（v82，AISLG-205）：24 小时，随全局时间缩放换算；与后端 common/src/capital-swap.ts 同口径 */
const CAPITAL_SWAP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

interface AccountDialogsProps {
  mode: AccountDialogMode;
  cityName: string | null;
  onClose: () => void;
  onSwitchAccount: () => void;
  onResetAccount: () => Promise<string | null>;
  onRenameCity: (name: string) => Promise<string | null>;
  /** 放弃当前选中的分城（v57，AISLG-153）；成功返回 null */
  onDiscardCity: () => Promise<string | null>;
  /** 设为主城（v82，AISLG-205）的目标：当前选中的城（分城）、账号城池列表与全局时间缩放 */
  cityId: string | null;
  cityList: CityList;
  timeScale: number;
  /** 设为主城（v82）；成功返回 null，失败返回人读错误 */
  onSetCapital: (cityId: string) => Promise<string | null>;
}

export function AccountDialogs({
  mode,
  cityName,
  onClose,
  onSwitchAccount,
  onResetAccount,
  onRenameCity,
  onDiscardCity,
  cityId,
  cityList,
  timeScale,
  onSetCapital,
}: AccountDialogsProps) {
  const copy = useCopy();
  const { COPY } = copy;
  if (mode === 'switch') {
    return (
      <Modal role="切换账号确认框" title={COPY.topbar.switchAccount} size="sm" accent="none" onClose={onClose}>
        <p className="text-[13px] text-dim">{COPY.topbar.switchConfirmBody}</p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" role="切换账号-取消按钮" className="btn" onClick={onClose}>
            {COPY.topbar.switchCancel}
          </button>
          <button
            type="button"
            role="切换账号-确认按钮"
            className="btn px-3"
            onClick={() => {
              onClose();
              onSwitchAccount();
            }}
          >
            {COPY.topbar.switchConfirm}
          </button>
        </div>
      </Modal>
    );
  }
  if (mode === 'settings') {
    return <AccountSettingsDialog onClose={onClose} />;
  }
  if (mode === 'discard') {
    return <DiscardDialog onClose={onClose} onDiscardCity={onDiscardCity} />;
  }
  if (mode === 'capital') {
    return <SetCapitalDialog onClose={onClose} cityId={cityId} cityList={cityList} timeScale={timeScale} onSetCapital={onSetCapital} />;
  }
  return mode === 'reset' ? (
    <ResetDialog onClose={onClose} onResetAccount={onResetAccount} />
  ) : (
    <RenameDialog cityName={cityName} onClose={onClose} onRenameCity={onRenameCity} />
  );
}

/**
 * 设为主城二次确认（v82，AISLG-205）：必须点「确认」才发请求（带 confirm: true）；确认框写清四点：谁成为主城 / 谁变为分城、
 * 原主城可被占领、24 小时内不能再换（并给出具体可再换时刻）、分城数上限的变化。不可设的原因在框内说明并置灰确认按钮。
 * 没有表单，回车不会触发确认；取消 / 关闭不发请求。宽度 ≤ 400px。
 */
function SetCapitalDialog({
  onClose,
  cityId,
  cityList,
  timeScale,
  onSetCapital,
}: Pick<AccountDialogsProps, 'onClose' | 'cityId' | 'cityList' | 'timeScale' | 'onSetCapital'>) {
  const copy = useCopy();
  const { COPY } = copy;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 确认框打开时刻算出的可再换时刻：现在 + 24 小时（按全局时间缩放换算），与服务端冷却截止口径一致
  const [nextAt] = useState(() => new Date(Date.now() + Math.max(1000, Math.floor(CAPITAL_SWAP_COOLDOWN_MS / Math.max(1, timeScale)))).toISOString());

  const target = cityList.cities.find((item) => item.id === cityId) ?? null;
  const former = cityList.cities.find((item) => item.isMain) ?? null;
  const swap = cityList.capitalSwap;
  const oldLimit = cityList.branch?.limit ?? 0;
  const branchCount = cityList.branch?.count ?? 0;
  const newLimit = target ? Math.floor(target.level / 2) : 0;
  const coolingUntil = swap?.cooldownUntil && Date.parse(swap.cooldownUntil) > Date.now() ? swap.cooldownUntil : null;
  // 不可设原因，顺序与服务端一致：名城 → 冷却 → 来袭 → 城防未满 → 分城数超新上限
  const blockedCode = target && swap ? swap.blocked[target.id] : undefined;
  let reason: string | null = null;
  if (target === null) {
    reason = COPY.topbar.capitalFallback;
  } else if (target.isMain) {
    reason = COPY.topbar.capitalNoCapital;
  } else if (blockedCode === 'FAMOUS_CITY_NOT_CAPITAL') {
    reason = COPY.topbar.capitalBlockedFamous;
  } else if (coolingUntil) {
    reason = COPY.topbar.capitalBlockedCooldown(COPY.topbar.capitalTime(coolingUntil));
  } else if (swap?.underAttack) {
    reason = COPY.topbar.capitalBlockedAttack;
  } else if (blockedCode === 'CAPITAL_SWAP_DURABILITY_LOW') {
    reason = COPY.topbar.capitalBlockedDurability;
  } else if (blockedCode === 'BRANCH_LIMIT_EXCEEDED') {
    reason = COPY.topbar.capitalBlockedLimit(newLimit, branchCount);
  }

  async function submit() {
    if (busy || reason !== null || cityId === null) {
      return;
    }
    setBusy(true);
    const failure = await onSetCapital(cityId);
    setBusy(false);
    if (failure === null) {
      onClose();
    } else {
      setError(failure);
    }
  }

  return (
    <Modal role="设为主城确认框" title={COPY.topbar.capitalTitle} size="sm" accent="none" onClose={onClose}>
      {target && former ? (
        <>
          <p className="text-[13px] text-dim">{COPY.topbar.capitalLine1(tName(target.name), tName(former.name))}</p>
          <p className="text-[13px] text-dim">{COPY.topbar.capitalLine2}</p>
          <p className="text-[13px] text-dim">{COPY.topbar.capitalLine3(COPY.topbar.capitalTime(nextAt))}</p>
          <p className="text-[13px] text-dim">{COPY.topbar.capitalLine4(oldLimit, newLimit, branchCount)}</p>
        </>
      ) : null}
      {reason ? (
        <p role="设为主城-原因" className="rounded border border-line-soft bg-panel-2 px-2 py-1.5 text-[12px] text-dim">
          {reason}
        </p>
      ) : null}
      {error ? (
        <p role="设为主城-错误" className="truncate rounded border border-line-soft bg-panel-2 px-2 py-1.5 text-[12px] text-dim" title={error}>
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" role="设为主城-返回按钮" className="btn" onClick={onClose}>
          {COPY.topbar.capitalCancel}
        </button>
        <button type="button" role="设为主城-确认按钮" className="btn px-3" disabled={busy || reason !== null} onClick={() => void submit()}>
          {busy ? COPY.topbar.capitalBusy : COPY.topbar.capitalSubmit}
        </button>
      </div>
    </Modal>
  );
}

/** 放弃分城二次确认（v57，AISLG-153）：不可撤销，宽度 ≤ 400px，role 名沿用中文约定 */
function DiscardDialog({ onClose, onDiscardCity }: Pick<AccountDialogsProps, 'onClose' | 'onDiscardCity'>) {
  const copy = useCopy();
  const { COPY } = copy;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) {
      return;
    }
    setBusy(true);
    const failure = await onDiscardCity();
    setBusy(false);
    if (failure === null) {
      onClose();
    } else {
      setError(failure);
    }
  }

  return (
    <Modal role="放弃分城确认框" title={COPY.topbar.discardTitle} size="sm" accent="warn" onClose={onClose}>
      <p className="text-[13px] text-dim">{COPY.topbar.discardBody}</p>
      <p className="text-[12px] text-faint">{COPY.topbar.discardPrecheck}</p>
      {error ? (
        <p role="放弃分城-错误" className="truncate rounded border border-line-soft bg-panel-2 px-2 py-1.5 text-[12px] text-dim" title={error}>
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" role="放弃分城-返回按钮" className="btn" onClick={onClose}>
          {COPY.topbar.discardCancel}
        </button>
        <button type="button" role="放弃分城-确认按钮" className="btn px-3" disabled={busy} onClick={() => void submit()}>
          {busy ? COPY.topbar.discardBusy : COPY.topbar.discardSubmit}
        </button>
      </div>
    </Modal>
  );
}

function ResetDialog({ onClose, onResetAccount }: Pick<AccountDialogsProps, 'onClose' | 'onResetAccount'>) {
  const copy = useCopy();
  const { COPY } = copy;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) {
      return;
    }
    setBusy(true);
    const failure = await onResetAccount();
    setBusy(false);
    if (failure === null) {
      onClose();
    } else {
      setError(failure);
    }
  }

  return (
    <Modal role="重置账号确认框" title={COPY.topbar.resetTitle} size="sm" accent="warn" onClose={onClose}>
      <p className="text-[13px] text-dim">{COPY.topbar.resetBody}</p>
      {error ? (
        <p role="重置账号-错误" className="truncate rounded border border-line-soft bg-panel-2 px-2 py-1.5 text-[12px] text-dim" title={error}>
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" role="重置账号-返回按钮" className="btn" onClick={onClose}>
          {COPY.topbar.resetBack}
        </button>
        <button type="button" role="重置账号-确认按钮" className="btn px-3" disabled={busy} onClick={() => void submit()}>
          {busy ? COPY.topbar.resetBusy : COPY.topbar.resetSubmit}
        </button>
      </div>
    </Modal>
  );
}

function RenameDialog({ cityName, onClose, onRenameCity }: Pick<AccountDialogsProps, 'cityName' | 'onClose' | 'onRenameCity'>) {
  const copy = useCopy();
  const { COPY } = copy;
  const [value, setValue] = useState(cityName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = value.trim();
    if (busy) {
      return;
    }
    if (name.length === 0) {
      setError(COPY.topbar.renameEmpty);
      return;
    }
    setBusy(true);
    const failure = await onRenameCity(name);
    setBusy(false);
    if (failure === null) {
      onClose();
    } else {
      setError(failure);
    }
  }

  return (
    <Modal role="城池改名弹窗" title={COPY.topbar.renameTitle} size="sm" accent="none" onClose={onClose}>
      <form className="flex flex-col gap-2" onSubmit={(event) => void submit(event)}>
        <input
          role="城池改名弹窗-输入框"
          className="rounded border border-line-soft bg-panel-2 px-2 py-1.5 text-[14px] outline-none focus:border-accent-dim"
          value={value}
          maxLength={24}
          autoFocus
          placeholder={COPY.topbar.renamePlaceholder}
          onChange={(event) => setValue(event.target.value)}
        />
        {error ? (
          <p role="城池改名弹窗-错误" className="truncate rounded border border-line-soft bg-panel-2 px-2 py-1.5 text-[12px] text-dim" title={error}>
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" role="城池改名弹窗-取消按钮" className="btn" onClick={onClose}>
            {COPY.topbar.renameCancel}
          </button>
          <button type="submit" role="城池改名弹窗-确认按钮" className="btn px-3" disabled={busy}>
            {busy ? COPY.topbar.renameBusy : COPY.topbar.renameSubmit}
          </button>
        </div>
      </form>
    </Modal>
  );
}
