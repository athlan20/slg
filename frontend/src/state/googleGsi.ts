// Google Identity Services（GSI）脚本加载器（v44，AISLG-127）：登录页与账号设置的绑定块共用。
// 脚本 https://accounts.google.com/gsi/client 在国内直连下加载不出来——加载失败要能落到
// 「改用账号密码」的人读提示，而不是整页白等。加载一次后复用同一个 Promise。

/** GSI 回调给的凭证响应（只用到 credential） */
export interface GsiCredentialResponse {
  credential?: string;
}

/** window.google 的最小类型面（GSI 官方脚本注入，只用到的部分） */
interface GoogleGsi {
  accounts: {
    id: {
      initialize: (config: { client_id: string; callback: (response: GsiCredentialResponse) => void; auto_select?: boolean; cancel_on_tap_outside?: boolean }) => void;
      renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
      disableAutoSelect: () => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleGsi;
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const SCRIPT_ID = 'google-gsi-client';
/** 脚本加载超时：过了这个时间还没 onload 就按「网络不通」处理 */
const LOAD_TIMEOUT_MS = 10_000;

let loadPromise: Promise<GoogleGsi> | null = null;

export function loadGoogleGsi(): Promise<GoogleGsi> {
  loadPromise ??= new Promise<GoogleGsi>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');
    const timer = window.setTimeout(() => {
      script.onload = null;
      script.onerror = null;
      loadPromise = null;
      reject(new Error('Google 脚本加载超时'));
    }, LOAD_TIMEOUT_MS);
    script.onload = () => {
      window.clearTimeout(timer);
      if (window.google) {
        resolve(window.google);
      } else {
        loadPromise = null;
        reject(new Error('Google 脚本已加载但初始化失败'));
      }
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      loadPromise = null;
      reject(new Error('Google 脚本加载失败（需要能访问 Google 的网络）'));
    };
    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
  return loadPromise;
}

/**
 * 在容器里渲染官方样式的 Google 按钮。onCredential 是拿到 ID Token 的回调。
 * initialize / renderButton 前者全局一份（后调的覆盖先调的），登录页与绑定块
 * 不会同时出现，互不干扰。
 */
export async function renderGoogleButton(
  container: HTMLElement,
  clientId: string,
  onCredential: (credential: string) => void,
  options: { text?: string } = {},
): Promise<void> {
  const gsi = await loadGoogleGsi();
  gsi.accounts.id.initialize({
    client_id: clientId,
    callback: (response) => {
      if (response.credential) {
        onCredential(response.credential);
      }
    },
  });
  gsi.accounts.id.renderButton(container, {
    theme: 'outline',
    size: 'large',
    shape: 'rectangular',
    text: options.text ?? 'signin_with',
    logo_alignment: 'left',
  });
}
