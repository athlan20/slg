/** 来袭警报上的势力文案（AISLG-240）：警报胶囊和军情摘要共用。不是势力的来袭返回 null，由调用方走原文案。 */

import type { useCopy } from '../../i18n/bundle';
import { getLang } from '../../i18n/lang';
import { tName } from '../../i18n/names';

interface Banner {
  name: string;
  nameEn: string;
}

export function factionAlertText(
  warning: { siege?: { faction: Banner; cityName: string | null } | null; faction?: Banner | null },
  siegeCopy: ReturnType<typeof useCopy>['EXTRA_MAP']['faction']['siege'],
  target: string,
): string | null {
  const label = (banner: Banner): string => (getLang() === 'en' ? banner.nameEn : banner.name);
  if (warning.siege) {
    return siegeCopy.alert(label(warning.siege.faction), warning.siege.cityName ? tName(warning.siege.cityName) : target);
  }
  return warning.faction ? siegeCopy.raidAlert(label(warning.faction), target) : null;
}
