/** 账号相关确认框（从旧 TopBar 拆出）：切换账号确认 / 重置账号二次确认（不可逆）/ 城池改名。
 *  不可撤销的操作保留确认框（docs 第 7 节）；宽度 ≤ 400px。role 名沿用旧约定，e2e 依赖它们。
 */

import { useState, type FormEvent } from 'react';
import { useCopy } from '../../i18n/bundle';
import { Modal } from '../ui/Modal';
import { AccountSettingsDialog } from '../account/AccountSettingsDialog';

export type AccountDialogMode = 'switch' | 'reset' | 'rename' | 'settings';

interface AccountDialogsProps {
  mode: AccountDialogMode;
  cityName: string | null;
  onClose: () => void;
  onSwitchAccount: () => void;
  onResetAccount: () => Promise<string | null>;
  onRenameCity: (name: string) => Promise<string | null>;
}

export function AccountDialogs({ mode, cityName, onClose, onSwitchAccount, onResetAccount, onRenameCity }: AccountDialogsProps) {
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
  return mode === 'reset' ? (
    <ResetDialog onClose={onClose} onResetAccount={onResetAccount} />
  ) : (
    <RenameDialog cityName={cityName} onClose={onClose} onRenameCity={onRenameCity} />
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
