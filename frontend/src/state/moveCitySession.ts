// 城池迁移切片（v91，AISLG-220）：指定坐标迁的选点状态、迁城预览（MOVE_CITY preview）与执行（MOVE_CITY confirm）。
// 选点只存在于前端：点「去地图选点」后，地图上点选的空野地才会出现「迁城到这里」；预览与执行都以服务端为准。

import { useCallback, useState } from 'react';
import type { ApiClient } from '../api/client';
import { Op, type MoveCityMode, type MoveCityPreviewData, type MoveCityResponseData } from '../api/protocol';
import { moveCityErrorText } from '../api/moveCityText';
import { getCopy } from '../i18n/bundle';

export interface MoveTarget {
  x: number;
  y: number;
}

export type MoveCityOutcome<T> = { ok: true; data: T } | { ok: false; code: string | undefined; message: string; data?: Record<string, unknown> };

export interface MoveCitySession {
  /** 选点中的城池 id（指定坐标迁）；null = 未在选点 */
  pickCityId: string | null;
  startPick: (cityId: string) => void;
  cancelPick: () => void;
  preview: (cityId: string, mode: MoveCityMode, target: MoveTarget | null) => Promise<MoveCityOutcome<MoveCityPreviewData>>;
  execute: (cityId: string, mode: MoveCityMode, target: MoveTarget | null) => Promise<MoveCityOutcome<MoveCityResponseData>>;
}

export function useMoveCitySession(clientRef: { current: ApiClient | null }, options: { onMoved: () => void }): MoveCitySession {
  const { onMoved } = options;
  const [pickCityId, setPickCityId] = useState<string | null>(null);

  const request = useCallback(
    async <T,>(cityId: string, mode: MoveCityMode, target: MoveTarget | null, extra: Record<string, unknown>): Promise<MoveCityOutcome<T>> => {
      const { MOVE_CITY_COPY } = getCopy();
      const client = clientRef.current;
      if (!client?.connected) {
        return { ok: false, code: undefined, message: MOVE_CITY_COPY.fallback };
      }
      try {
        const data: Record<string, unknown> = { cityId, mode, ...extra };
        if (mode === 'pointing' && target) {
          data.x = target.x;
          data.y = target.y;
        }
        const res = await client.request(Op.MOVE_CITY, data);
        if (res.ok) {
          return { ok: true, data: res.data as unknown as T };
        }
        return {
          ok: false,
          code: res.error?.code,
          message: moveCityErrorText(res.error?.code, res.error?.message),
          data: res.data as Record<string, unknown> | undefined,
        };
      } catch (err) {
        return { ok: false, code: undefined, message: err instanceof Error ? err.message : MOVE_CITY_COPY.fallback };
      }
    },
    [clientRef],
  );

  const preview = useCallback(
    (cityId: string, mode: MoveCityMode, target: MoveTarget | null) =>
      request<MoveCityPreviewData>(cityId, mode, target, { preview: true }),
    [request],
  );

  const execute = useCallback(
    async (cityId: string, mode: MoveCityMode, target: MoveTarget | null) => {
      const outcome = await request<MoveCityResponseData>(cityId, mode, target, { confirm: true });
      if (outcome.ok) {
        setPickCityId(null);
        onMoved();
      }
      return outcome;
    },
    [request, onMoved],
  );

  const startPick = useCallback((cityId: string) => setPickCityId(cityId), []);
  const cancelPick = useCallback(() => setPickCityId(null), []);

  return { pickCityId, startPick, cancelPick, preview, execute };
}
