// WORLD OS Alpha 0.1 · 全部中文内容数据（NPC / 任务 / 商店 / 建造）
// 注意：NPC 对话为脚本化台词（非真 AI），UI 中会标注。

export interface DialogueChoice { label: string; next: string; action?: string }
export interface DialogueNode { text: string; next?: string; choices?: DialogueChoice[] }
export interface NPCDef {
  id: string; name: string; title: string; robe: number; skin: number;
  start: string; dialogue: Record<string, DialogueNode>;
}

export const NPCS: NPCDef[] = [
  {
    id: 'chief', name: '石岩', title: '村长', robe: 0x5b3a8c, skin: 0xf2c89b,
    start: 'hello',
    dialogue: {
      hello: {
        text: '欢迎来到新手村，旅行者！我是村长石岩。\n\n村子百废待兴，正需要你这样有闯劲的人。先熟悉一下村子吧——和村民们聊聊，去周围转转。',
        choices: [
          { label: '我能做点什么？', next: 'quest1', action: 'complete_q1' },
          { label: '先随便逛逛', next: '__end' },
        ],
      },
      quest1: {
        text: '好！有志气。\n\n村外的空地上散落着不少木材，你去收集 5 份木材回来，村里正好拿来修缮房屋。\n\n（新任务：收集木材）',
        next: '__end',
      },
      after: {
        text: '村子在你的帮助下越来越好了。继续加油，旅行者！',
        next: '__end',
      },
    },
  },
  {
    id: 'merchant', name: '金满', title: '商人', robe: 0x1f6f5b, skin: 0xe8b98a,
    start: 'hello',
    dialogue: {
      hello: {
        text: '哟，客人！我是行商金满，整个新手村就我这儿东西最全。\n\n买进卖出，童叟无欺。想看看货吗？',
        choices: [
          { label: '看看商店', next: '__end', action: 'open_shop' },
          { label: '下次再来', next: '__end' },
        ],
      },
    },
  },
  {
    id: 'craftsman', name: '鲁大', title: '工匠', robe: 0x8c4a2b, skin: 0xd9a06b,
    start: 'hello',
    dialogue: {
      hello: {
        text: '我是工匠鲁大，村里的房子大半出自我手。\n\n等你收集够木材、帮村子出份力，我就教你建造的手艺——到时候你也能亲手盖房子、点路灯，把村子打扮成你喜欢的样子。',
        next: '__end',
      },
      unlocked: {
        text: '哈哈，你已经是村里认可的建造者了！点右下角的「建造」按钮，选好图纸，点空地就能放。\n\n好建筑能让村子更有生气，去试试吧！',
        next: '__end',
      },
    },
  },
];

export interface QuestDef {
  id: string; name: string; desc: string; target: number;
  rewardCoins: number; rewardText: string;
}

export const QUESTS: QuestDef[] = [
  {
    id: 'q1', name: '初到新手村', desc: '和村长石岩对话，领取你的第一个任务。',
    target: 1, rewardCoins: 50, rewardText: '金币+50',
  },
  {
    id: 'q2', name: '收集木材', desc: '在村庄周围收集 5 份木材（走近发光的木堆，点「收集」）。',
    target: 5, rewardCoins: 80, rewardText: '金币+80，解锁建造功能',
  },
  {
    id: 'q3', name: '开张大吉', desc: '在商店卖出 1 件物品，体验当老板的感觉。',
    target: 1, rewardCoins: 100, rewardText: '金币+100，解锁小商店图纸',
  },
  {
    id: 'q4', name: '我的第一家店', desc: '建造一座小商店，开始你的经营之路。',
    target: 1, rewardCoins: 120, rewardText: '金币+120',
  },
  {
    id: 'q5', name: '第一桶金', desc: '通过自己的商店赚到 100 金币（顾客会自动上门购买上架的商品）。',
    target: 100, rewardCoins: 150, rewardText: '金币+150',
  },
];

export interface ShopItem {
  id: string; name: string; icon: string; desc: string;
  buyPrice: number; sellPrice: number;
}

export const SHOP_ITEMS: ShopItem[] = [
  { id: 'wood', name: '木材', icon: '🪵', desc: '建造和修理的基本材料', buyPrice: 10, sellPrice: 6 },
  { id: 'stone', name: '石料', icon: '🪨', desc: '坚固的建筑材料', buyPrice: 15, sellPrice: 9 },
  { id: 'seed', name: '花种', icon: '🌱', desc: '种出漂亮的花', buyPrice: 5, sellPrice: 3 },
  { id: 'lantern', name: '灯笼', icon: '🏮', desc: '夜晚的村庄更温暖', buyPrice: 25, sellPrice: 15 },
  { id: 'sapling', name: '小树苗', icon: '🌳', desc: '种下希望', buyPrice: 30, sellPrice: 18 },
];

/** 材料配方项 */
export interface RecipeItem { id: string; n: number; }

export interface BuildableDef {
  type: string; name: string; icon: string; cost: number; desc: string;
  /** 建筑等级 1 生存 / 2 实用 / 3 现代 / 4 大型 */
  tier: number;
  /** 材料配方（建造时真实扣除） */
  recipe: RecipeItem[];
  /** 人工费（金币，建造时扣除） */
  laborFee: number;
  /** 耐久度 */
  durability: number;
  /** 维护成本（金币/天） */
  maintenance: number;
  /** 经营收入（金币/天，0 = 无） */
  incomePerDay: number;
  /** 解锁条件：完成指定任务 / 累计赚取达到金币数 / 等级达到 */
  unlockQuest?: string;
  unlockEarned?: number;
  unlockLevel?: number;
  /** 升级到（建筑类型），如 thatch → hut */
  upgradeTo?: string;
  /** 升级配方（材料，升级时真实扣除） */
  upgradeRecipe?: RecipeItem[];
  /** 升级人工费（金币） */
  upgradeFee?: number;
  /** 仅可通过升级获得，不在建造菜单显示 */
  upgradeOnly?: boolean;
  /** 储物容量（拥有该建筑时贡献，取所有房屋中的最大值） */
  storageCap?: number;
}

export const BUILDABLES: BuildableDef[] = [
  { type: 'thatch', name: '草屋', icon: '🛖', cost: 40, tier: 1, recipe: [{ id: 'wood', n: 12 }, { id: 'fiber', n: 6 }], laborFee: 20, durability: 100, maintenance: 1, incomePerDay: 0, desc: '生存建筑：遮风避雨的起点', upgradeTo: 'hut', upgradeRecipe: [{ id: 'plank', n: 8 }, { id: 'stone', n: 4 }], upgradeFee: 30, storageCap: 50 },
  { type: 'tree', name: '苹果树', icon: '🍎', cost: 30, tier: 1, recipe: [{ id: 'wood', n: 3 }], laborFee: 10, durability: 200, maintenance: 0, incomePerDay: 0, desc: '会结果的树' },
  { type: 'fence', name: '木围栏', icon: '🪧', cost: 20, tier: 1, recipe: [{ id: 'wood', n: 4 }], laborFee: 5, durability: 150, maintenance: 0, incomePerDay: 0, desc: '圈出一片小院' },
  { type: 'flower', name: '花坛', icon: '🌸', cost: 15, tier: 1, recipe: [{ id: 'fiber', n: 4 }], laborFee: 5, durability: 120, maintenance: 0, incomePerDay: 0, desc: '点缀村庄', unlockLevel: 2 },
  { type: 'hut', name: '小木屋', icon: '🏠', cost: 200, tier: 2, recipe: [{ id: 'plank', n: 10 }, { id: 'stone', n: 6 }], laborFee: 50, durability: 300, maintenance: 2, incomePerDay: 0, desc: '温馨的小屋', unlockEarned: 200, upgradeTo: 'stonehouse', upgradeRecipe: [{ id: 'stone', n: 12 }, { id: 'brick', n: 8 }], upgradeFee: 50, storageCap: 150 },
  { type: 'stonehouse', name: '石屋', icon: '🧱', cost: 260, tier: 2, recipe: [{ id: 'stone', n: 16 }, { id: 'brick', n: 10 }], laborFee: 80, durability: 500, maintenance: 3, incomePerDay: 0, desc: '实用建筑：冬暖夏凉', upgradeTo: 'brickhouse', upgradeRecipe: [{ id: 'brick', n: 20 }, { id: 'plank', n: 10 }], upgradeFee: 120, storageCap: 400 },
  { type: 'workshop', name: '工坊', icon: '⚒️', cost: 320, tier: 2, recipe: [{ id: 'plank', n: 15 }, { id: 'stone', n: 8 }], laborFee: 100, durability: 400, maintenance: 4, incomePerDay: 0, desc: '实用建筑：加工免手续费' },
  { type: 'lamp', name: '石路灯', icon: '💡', cost: 50, tier: 2, recipe: [{ id: 'stone', n: 4 }, { id: 'wood', n: 2 }], laborFee: 15, durability: 200, maintenance: 1, incomePerDay: 0, desc: '照亮夜晚的路' },
  { type: 'shop', name: '小商店', icon: '🏪', cost: 150, tier: 3, recipe: [{ id: 'plank', n: 12 }, { id: 'brick', n: 8 }], laborFee: 60, durability: 350, maintenance: 5, incomePerDay: 0, desc: '开店赚钱，顾客自动上门', unlockQuest: 'q3' },
  { type: 'warehouse', name: '仓库', icon: '📦', cost: 400, tier: 3, recipe: [{ id: 'plank', n: 20 }, { id: 'stone', n: 10 }], laborFee: 150, durability: 450, maintenance: 6, incomePerDay: 20, desc: '现代建筑：储物+200，每日仓储费+20', upgradeTo: 'bigwarehouse', upgradeRecipe: [{ id: 'plank', n: 15 }, { id: 'brick', n: 10 }], upgradeFee: 100, storageCap: 200 },
  { type: 'bigwarehouse', name: '大仓库', icon: '🏚️', cost: 900, tier: 3, recipe: [{ id: 'plank', n: 30 }, { id: 'brick', n: 20 }], laborFee: 250, durability: 800, maintenance: 10, incomePerDay: 40, desc: '大型仓储：储物+500，每日仓储费+40', upgradeOnly: true, storageCap: 500 },
  { type: 'tower', name: '高楼', icon: '🏢', cost: 1200, tier: 4, recipe: [{ id: 'brick', n: 40 }, { id: 'plank', n: 20 }, { id: 'stone', n: 20 }], laborFee: 500, durability: 1000, maintenance: 20, incomePerDay: 80, desc: '大型项目：每日租金+80', unlockEarned: 2000 },
  { type: 'brickhouse', name: '砖房', icon: '🏡', cost: 600, tier: 3, recipe: [{ id: 'brick', n: 30 }, { id: 'plank', n: 15 }], laborFee: 150, durability: 800, maintenance: 5, incomePerDay: 0, desc: '现代住宅：升级终点，冬暖夏凉', upgradeOnly: true, storageCap: 1000 },
];

/** 按等级分组（建造栏用） */
export const TIER_NAMES = ['', '生存建筑', '实用建筑', '现代建筑', '大型项目'];

export const ITEM_NAMES: Record<string, string> = {
  wood: '木材', stone: '石料', seed: '花种', lantern: '灯笼', sapling: '小树苗',
};

export const BUILDABLE_NAMES: Record<string, string> = {
  hut: '小木屋', shop: '小商店', fence: '木围栏', lamp: '石路灯', tree: '苹果树', flower: '花坛',
  thatch: '草屋', stonehouse: '石屋', workshop: '工坊', warehouse: '仓库', tower: '高楼', brickhouse: '砖房',
  bigwarehouse: '大仓库',
};

/** 模拟顾客名（本地模拟，非真实玩家） */
export const CUSTOMER_NAMES = [
  '路过的旅人', '隔壁村的阿婆', '赶集的大叔', '好奇的小孩',
  '行脚商人', '村里的铁匠', '采药的姑娘', '钓鱼的老伯',
];

/** 社区模拟作品（本地模拟数据，非真实玩家作品） */
export interface CommunityWork { name: string; author: string; type: string; likes: number; trades: number }
export const COMMUNITY_WORKS: CommunityWork[] = [
  { name: '望舒灯塔', author: '云村长', type: 'lamp', likes: 128, trades: 12 },
  { name: '果园小筑', author: '阿果', type: 'tree', likes: 96, trades: 8 },
  { name: '花语小院', author: '小蕊', type: 'flower', likes: 210, trades: 23 },
];

/** 解锁条件文案 */
export function unlockText(b: BuildableDef): string | null {
  if (b.unlockQuest) {
    const q = QUESTS.find((x) => x.id === b.unlockQuest);
    return `完成任务「${q?.name ?? b.unlockQuest}」后解锁`;
  }
  if (b.unlockEarned) return `累计赚取 🪙${b.unlockEarned} 后解锁`;
  if (b.unlockLevel) return `达到 Lv.${b.unlockLevel} 后解锁`;
  return null;
}

/** 等级阈值：index+1 = 等级 */
export const LEVEL_XP = [0, 100, 250, 500, 900, 1400, 2100];
export function levelForXp(xp: number): number {
  let lv = 1;
  for (let i = 0; i < LEVEL_XP.length; i++) {
    if (xp >= LEVEL_XP[i]) lv = i + 1;
  }
  return lv;
}
