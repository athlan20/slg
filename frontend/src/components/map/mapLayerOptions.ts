/** 图层开关的选项表（AISLG-231）：电脑端横排复选框与手机端图层面板共用同一份，
 *  保证两边的顺序、文案和复选框的 role 一致。role 取静态中文包（AISLG-137 约定：role 不随界面语言变），
 *  显示文案随界面语言取（中文用 copy-pages 的 MAPUI_COPY、新增两项在 copy-extra-map 的 layers）。
 */

import { useCopy } from '../../i18n/bundle';
import { MAPUI_COPY as MAPUI_COPY_ZH } from '../../copy-pages';
import { EXTRA_MAP as EXTRA_MAP_ZH } from '../../copy-extra-map';
import type { MapLayers } from '../../state/NavContext';

export interface LayerOption {
  /** NavContext.layers 的键，勾选状态仍由它保存（默认行军开、产出关） */
  key: keyof MapLayers;
  /** 界面上显示的文案（随语言） */
  label: string;
  /** role 里的固定中文（不随语言） */
  roleLabel: string;
}

export function useLayerOptions(): LayerOption[] {
  const { EXTRA_MAP, MAPUI_COPY } = useCopy();
  return [
    { key: 'moving', label: MAPUI_COPY.layerMoving, roleLabel: MAPUI_COPY_ZH.layerMoving },
    { key: 'yt', label: MAPUI_COPY.layerYt, roleLabel: MAPUI_COPY_ZH.layerYt },
    { key: 'territory', label: MAPUI_COPY.layerMine, roleLabel: MAPUI_COPY_ZH.layerMine },
    // 新加两个图层（AISLG-216）：行军默认开、产出默认关（信息多，要的人自己打开）
    { key: 'marches', label: EXTRA_MAP.layers.marches, roleLabel: EXTRA_MAP_ZH.layers.marches },
    { key: 'yield', label: EXTRA_MAP.layers.yield, roleLabel: EXTRA_MAP_ZH.layers.yield },
    // 五方势力的势力范围（v99，AISLG-239）：默认开（地盘是公开信息，开箱就能看到五股力量在长）
    { key: 'faction', label: EXTRA_MAP.faction.layer, roleLabel: EXTRA_MAP_ZH.faction.layer },
  ];
}
