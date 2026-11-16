// 微应用传输层适配器：将 sdk.webSocket 包装成 ApiClient 所需的 TransportSocket 接口。
// 重连时重新调用 connect，平台会自动附带最新签发的平台 JWT 令牌。

import type { MiniAppSDK, MiniAppSocket } from './types';
import type { TransportFactory, TransportSocket } from '../api/client';

export function createMappTransportFactory(sdk: MiniAppSDK, endpoint = 'game'): TransportFactory {
  return async (_url: string): Promise<TransportSocket> => {
    const socket = await sdk.webSocket.connect(endpoint, {
      textMode: 'text',
      // 平台默认不设总超时：网关不可达时会一直转圈。给个上限，超时走「连接失败」提示
      timeoutMs: 20_000,
    });
    return new SdkTransportSocket(socket);
  };
}

class SdkTransportSocket implements TransportSocket {
  private readonly socket: MiniAppSocket;
  private offMessage: (() => void) | null = null;
  private offClose: (() => void) | null = null;
  private offError: (() => void) | null = null;

  onopen: (() => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  constructor(socket: MiniAppSocket) {
    this.socket = socket;
    this.offMessage = socket.on('message', (data: unknown) => {
      if (this.onmessage) {
        const text = typeof data === 'string' ? data : JSON.stringify(data);
        this.onmessage({ data: text });
      }
    });
    this.offClose = socket.on('close', ({ code, reason }: { code: number; reason?: string }) => {
      this.cleanup();
      this.onclose?.({ code, reason: reason ?? '' });
    });
    this.offError = socket.on('error', ({ code }: { code: string }) => {
      this.cleanup();
      this.onclose?.({ code: 1006, reason: code });
    });
  }

  get readyState(): number {
    switch (this.socket.readyState) {
      case 'open':
        return 1;
      case 'closing':
        return 2;
      case 'closed':
        return 3;
      default:
        return 3;
    }
  }

  send(data: string): void {
    void this.socket.sendText(data).catch(() => {});
  }

  close(code?: number, reason?: string): void {
    this.cleanup();
    void this.socket.close(code, reason).catch(() => {});
  }

  private cleanup(): void {
    this.offMessage?.();
    this.offClose?.();
    this.offError?.();
    this.offMessage = null;
    this.offClose = null;
    this.offError = null;
  }
}
