// 后端下发的专有名词英文名对照（AISLG-137）：武将名、名城名、移动目标与名将来源标签。
// 协议不改（协议里就是这些中文字符串），英文界面在前端按码表翻译；zh 下原样返回。
//
// 依据 backend/common/src/hero.ts：
// - 普通将名 = SURNAMES × GIVEN 各取一字（两字名），按同样的池子做拼音镜像即可确定性覆盖；
// - 名将名固定（颜良 / 徐晃 / 吕布 / 马超 / 张飞 / 甘宁 / 黄忠 / 张郃 / 张角 / 张宝 / 张梁）；
// - 名将来源标签三种模板：首占名城「X」/ 黄巾老巢首杀 / 黄巾之乱贡献榜第 N 名。
// 名城名依据 backend/common/src/famous-city.ts 的 FAMOUS_CITY_NAMES（八座固定）；
// 移动目标 label 依据 backend/common/src/moving-target.ts 的 MOVING_KIND_INFO（两种固定）。

import { getLang } from './lang';

/** 名将等固定武将名：通行译法，不用字面拼音直译 */
const HERO_NAME_EN: Record<string, string> = {
  颜良: 'Yan Liang',
  徐晃: 'Xu Huang',
  吕布: 'Lü Bu',
  马超: 'Ma Chao',
  张飞: 'Zhang Fei',
  甘宁: 'Gan Ning',
  黄忠: 'Huang Zhong',
  张郃: 'Zhang He',
  张角: 'Zhang Jiao',
  张宝: 'Zhang Bao',
  张梁: 'Zhang Liang',
};

/** 普通将姓池的拼音镜像（与 backend/common/src/hero.ts SURNAMES 一致） */
const SURNAME_EN: Record<string, string> = {
  赵: 'Zhao', 钱: 'Qian', 孙: 'Sun', 李: 'Li', 周: 'Zhou', 吴: 'Wu', 郑: 'Zheng', 王: 'Wang',
  冯: 'Feng', 陈: 'Chen', 卫: 'Wei', 蒋: 'Jiang', 沈: 'Shen', 韩: 'Han', 杨: 'Yang', 朱: 'Zhu',
  秦: 'Qin', 许: 'Xu', 何: 'He', 吕: 'Lü', 施: 'Shi', 张: 'Zhang', 孔: 'Kong', 曹: 'Cao',
  严: 'Yan', 华: 'Hua', 金: 'Jin', 魏: 'Wei', 陶: 'Tao', 姜: 'Jiang',
};

/** 普通将名池的拼音镜像（与 backend/common/src/hero.ts GIVEN 一致，单字） */
const GIVEN_EN: Record<string, string> = {
  云: 'Yun', 长: 'Chang', 翼: 'Yi', 德: 'De', 子: 'Zi', 龙: 'Long', 孟: 'Meng', 起: 'Qi',
  汉: 'Han', 升: 'Sheng', 文: 'Wen', 远: 'Yuan', 丑: 'Chou', 公: 'Gong', 瑾: 'Jin', 敬: 'Jing',
  伯: 'Bo', 符: 'Fu', 仲: 'Zhong', 谋: 'Mou', 玄: 'Xuan', 颖: 'Ying', 奉: 'Feng', 先: 'Xian',
  圭: 'Gui',
};

/** 名城名（FAMOUS_CITY_NAMES）：通行拼写，长安按惯例带撇号 */
const CITY_NAME_EN: Record<string, string> = {
  官渡: 'Guandu',
  许昌: 'Xuchang',
  洛阳: 'Luoyang',
  长安: "Chang'an",
  成都: 'Chengdu',
  建业: 'Jianye',
  襄阳: 'Xiangyang',
  邺城: 'Ye',
};

/** 移动目标 label（MOVING_KIND_INFO.label） */
const MOVING_LABEL_EN: Record<string, string> = {
  运粮商队: 'Grain Caravan',
  流寇: 'Bandits',
};

/** 黄巾营地档位 label（backend/common/src/yellow-turban.ts YT_TIER_INFO），与 copy-yt-en 的 tierLabel 保持一致 */
const YT_LABEL_EN: Record<string, string> = {
  '黄巾营地（小）': 'Small Camp',
  '黄巾营地（中）': 'Medium Camp',
  '黄巾营地（大）': 'Large Camp',
  张角老巢: "Zhang Jiao's Stronghold",
};

/** 黄巾之乱名次奖励档位 label（YT_REWARD_TIERS）与「参与奖」 */
function ytRewardLabelEn(label: string): string | null {
  const rank = label.match(/^第 ([\d–-]+) 名$/);
  if (rank) {
    return `Rank #${rank[1]}`;
  }
  if (label === '参与奖') {
    return 'Participation';
  }
  return null;
}

/** 战报等场景由后端拼好的对手名 / 默认城名（backend battle 与 city 命名） */
const SERVER_LABEL_EN: Record<string, string> = {
  主城: 'Main City',
  NPC袭击部队: 'NPC raiding force',
  'NPC 袭击部队': 'NPC raiding force',
};

/** 战报对手名「野地 Lv2（森林）」这类后端拼装格式 */
function serverComposedNameEn(text: string): string | null {
  const wild = text.match(/^野地 Lv(\d+)（(.+)）$/);
  if (wild) {
    const terrain = CITY_NAME_EN[wild[2]] ?? MOVING_LABEL_EN[wild[2]] ?? TERRAIN_EN[wild[2]] ?? wild[2];
    return `Wilderness Lv${wild[1]} (${terrain})`;
  }
  return null;
}

/** 地形名（镜像 backend/common/src/world.ts TERRAIN_INFO.label，与 copy-en.ts 的 TERRAIN_LABEL_EN 一致） */
const TERRAIN_EN: Record<string, string> = {
  平原: 'Plains',
  草原: 'Grassland',
  森林: 'Forest',
  丘陵: 'Hills',
  荒漠: 'Desert',
  沼泽: 'Marsh',
  湖泊: 'Lake',
  金矿: 'Gold Mine',
};

/** 名将来源标签（famousSourceLabel 的三种模板） */
function heroSourceEn(source: string): string {
  const city = source.match(/^首占名城「(.+)」$/);
  if (city) {
    return `First to hold ${CITY_NAME_EN[city[1]] ?? city[1]}`;
  }
  if (source === '黄巾老巢首杀') {
    return 'First to break the Yellow Turban stronghold';
  }
  const rank = source.match(/^黄巾之乱贡献榜第 (\d+) 名$/);
  if (rank) {
    return `Yellow Turban contribution rank #${rank[1]}`;
  }
  return source;
}

/**
 * 后端名词的界面翻译：武将名 / 名城名 / 移动目标标签按码表翻，未命中原样返回。
 * 玩家自起的城名等用户内容不在此列（未命中即原文，天然不误伤）。
 */
export function tName(text: string): string {
  if (getLang() !== 'en' || text === '') {
    return text;
  }
  return (
    HERO_NAME_EN[text] ??
    CITY_NAME_EN[text] ??
    MOVING_LABEL_EN[text] ??
    YT_LABEL_EN[text] ??
    SERVER_LABEL_EN[text] ??
    serverComposedNameEn(text) ??
    ytRewardLabelEn(text) ??
    // 两字普通将名：姓 + 名各查拼音池（与后端 rollHeroName 的构词一致）
    (text.length === 2 && SURNAME_EN[text[0]] && GIVEN_EN[text[1]]
      ? `${SURNAME_EN[text[0]]} ${GIVEN_EN[text[1]]}`
      : text)
  );
}

/** 名将来源标签的翻译（播报 / 事件 / 名将面板共用） */
export function tHeroSource(source: string): string {
  if (getLang() !== 'en') {
    return source;
  }
  return heroSourceEn(source);
}
