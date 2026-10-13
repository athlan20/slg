// 后端下发的专有名词英文名对照（AISLG-137）：武将名、名城名、移动目标、名将来源标签与任务 / 成就 / 活动文案。
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

/**
 * 任务 / 成就 / 活动的标题与描述（backend/common/src/quest.ts、quests.ts 的静态文案）。
 * 按整串中文查表；同一句话在多处复用（如「出征 1 次」）时只登记一次。
 */
const QUEST_NAME_EN: Record<string, string> = {
  // 日常任务
  每日登录: 'Daily Login',
  今日登录游戏: 'Log in to the game today',
  大兴土木: 'Construction Boom',
  '完成 1 次建造或升级': 'Complete 1 build or upgrade',
  招兵买马: 'Recruit Troops',
  '征兵 1 次': 'Recruit troops once',
  '完成 1 次征兵': 'Complete 1 recruitment',
  出征沙场: 'March to Battle',
  '出征 1 次': 'March out once',
  潜心钻研: 'Deep Research',
  '研究科技 1 次': 'Research 1 tech',
  开疆拓土: 'Expand Territory',
  '占领 1 块野地': 'Occupy 1 wilderness tile',
  // 主线
  初入乱世: 'Into the Chaos',
  固本培元: 'Strengthen the Foundation',
  '官府升到 3 级': 'Upgrade Government to Lv 3',
  格物致知: 'Seek Knowledge',
  '研究 1 项科技': 'Research 1 tech',
  初战告捷: 'First Victory',
  礼贤下士: 'Seek Worthy Generals',
  '招募 1 名武将': 'Recruit 1 general',
  威震一方: 'Terror of the Region',
  '官府升到 5 级': 'Upgrade Government to Lv 5',
  深耕细作: 'Diligent Farming',
  '占领 3 块野地': 'Occupy 3 wilderness tiles',
  持之以恒: 'Perseverance',
  '累计签到 3 天': 'Check in 3 days total',
  // 支线
  '累计建造或升级 10 次': 'Build or upgrade 10 times total',
  百家争鸣: 'Hundred Schools of Thought',
  '研究 5 项科技': 'Research 5 techs',
  千军万马: 'Ten Thousand Troops',
  '累计征兵 10 次': 'Recruit troops 10 times total',
  探路先锋: 'Scouting Vanguard',
  '累计出征 5 次': 'March out 5 times total',
  // 成就
  建造大师: 'Master Builder',
  '累计建造 / 升级次数': 'Total builds / upgrades',
  百战之师: 'Veteran Army',
  累计出征次数: 'Total marches',
  拓荒者: 'Pioneer',
  累计占领野地: 'Total wilderness occupied',
  学者: 'Scholar',
  研究科技项数: 'Techs researched',
  将星: 'Star General',
  拥有武将数: 'Generals owned',
  签到达人: 'Check-in Champion',
  累计签到天数: 'Total check-in days',
  // 活动
  开服冲刺: 'Launch Sprint',
  '开服两周内达成里程碑，领取冲刺奖励': 'Reach milestones within two weeks of launch to claim sprint rewards',
  '建造 20 次': 'Build 20 times',
  '出征 20 次': 'March out 20 times',
  '占领 10 块野地': 'Occupy 10 wilderness tiles',
  每日活跃: 'Daily Activity',
  '今日完成日常 / 签到攒活跃点（每完成 1 条日常或签到 +1）': 'Earn activity points today by completing dailies and check-ins (+1 each)',
  '活跃 3 点': '3 activity points',
  '活跃 5 点': '5 activity points',
  '活跃 7 点': '7 activity points',
};

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
 * 后端名词的界面翻译：武将名 / 名城名 / 移动目标标签 / 任务文案按码表翻，未命中原样返回。
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
    QUEST_NAME_EN[text] ??
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
