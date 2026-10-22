// WORLD OS Alpha 0.4 · 资源数据库（可扩展）
// 每种资源：唯一 ID、来源、用途、单位、参考价格、游戏内价格、更新时间、价格来源

export type ResCategory = 'raw' | 'processed' | 'food' | 'tool' | 'energy' | 'special';

export interface ResourceDef {
  id: string;          // 唯一 ID
  name: string;
  icon: string;
  category: ResCategory;
  source: string;      // 来源说明
  uses: string[];      // 用途（加工/建筑名）
  unit: string;        // 单位
  gamePrice: number;   // 游戏内基准价（金币/单位）
  updatedAt: string;   // 价格更新时间
  priceSource: string; // 价格来源
}

/** 资源总表：向 processed/food/tool/energy 加新行即扩展 */
export const RESOURCES: ResourceDef[] = [
  { id: 'wood', name: '木材', icon: '🪵', category: 'raw', source: '野外采集（发光木堆）', uses: ['木板', '草屋', '木围栏'], unit: '份', gamePrice: 5, updatedAt: '2026-10-12', priceSource: '模拟数据（人工设定）' },
  { id: 'stone', name: '石头', icon: '🪨', category: 'raw', source: '野外采集（灰色石堆）', uses: ['小木屋', '石屋', '石路灯'], unit: '份', gamePrice: 4, updatedAt: '2026-10-12', priceSource: '模拟数据（人工设定）' },
  { id: 'clay', name: '黏土', icon: '🟤', category: 'raw', source: '野外采集（棕色土坑）', uses: ['砖块'], unit: '份', gamePrice: 3, updatedAt: '2026-10-12', priceSource: '模拟数据（人工设定）' },
  { id: 'fiber', name: '植物纤维', icon: '🌾', category: 'raw', source: '野外采集（绿色草丛）', uses: ['草屋', '花坛'], unit: '份', gamePrice: 2, updatedAt: '2026-10-12', priceSource: '模拟数据（人工设定）' },
  { id: 'plank', name: '木板', icon: '🪚', category: 'processed', source: '加工：2 木材 → 3 木板', uses: ['小木屋', '商店', '工坊', '仓库'], unit: '块', gamePrice: 9, updatedAt: '2026-10-12', priceSource: '模拟数据（人工设定）' },
  { id: 'brick', name: '砖块', icon: '🧱', category: 'processed', source: '加工：2 黏土 → 2 砖块', uses: ['石屋', '商店', '高楼'], unit: '块', gamePrice: 7, updatedAt: '2026-10-12', priceSource: '模拟数据（人工设定）' },
  { id: 'stonebrick', name: '石砖', icon: '🪨', category: 'processed', source: '加工：3 石头 → 2 石砖（需石屋）', uses: ['高级建筑'], unit: '块', gamePrice: 12, updatedAt: '2026-10-12', priceSource: '模拟数据（人工设定）' },
];

export function resDef(id: string): ResourceDef | undefined {
  return RESOURCES.find((r) => r.id === id);
}
export function resName(id: string): string {
  const d = resDef(id);
  return d ? `${d.icon}${d.name}` : id;
}

/** 加工配方 */
export interface ProcessRecipe {
  id: string;          // 产出资源 id
  name: string;
  inputs: { id: string; n: number }[];
  outputs: { id: string; n: number }[];
  fee: number;         // 加工手续费（金币/次），拥有工坊则免
  /** 需要拥有的建筑类型（如 'hut'）；拥有同系更高等级建筑也算满足 */
  requireBuilding?: string;
}
/** 加工建筑等级：hut(1) < stonehouse(2) < brickhouse(3)，高等级兼容低等级配方 */
export const PROCESS_BUILDING_TIER: Record<string, number> = {
  hut: 1, stonehouse: 2, brickhouse: 3,
};
export const PROCESS_RECIPES: ProcessRecipe[] = [
  { id: 'plank', name: '木板', inputs: [{ id: 'wood', n: 2 }], outputs: [{ id: 'plank', n: 3 }], fee: 2, requireBuilding: 'hut' },
  { id: 'brick', name: '砖块', inputs: [{ id: 'clay', n: 2 }], outputs: [{ id: 'brick', n: 2 }], fee: 2, requireBuilding: 'hut' },
  // 高级加工（石屋解锁）：石砖，建筑加固材料
  { id: 'stonebrick', name: '石砖', inputs: [{ id: 'stone', n: 3 }], outputs: [{ id: 'stonebrick', n: 2 }], fee: 5, requireBuilding: 'stonehouse' },
];

// ---------- 现实参考价格模块（独立，为未来接入真实数据预留） ----------
// 第一版：人工设定的模拟参考价，明确标注"模拟数据"，不代表实时市场。
// 未来接入真实数据时：替换 source/updatedAt，填写币种/单位/换算规则，
// 并处理汇率、税费、地区差异。现实价格仅作游戏内经济参考基准，
// 不直接等同游戏币，不形成真实现金兑换承诺。
export interface RefPrice {
  resourceId: string;
  cny: number;        // 人民币参考价
  currency: 'CNY';
  unit: string;
  source: string;     // 数据来源（第一版：模拟数据）
  updatedAt: string;  // 更新时间
  rule: string;       // 换算规则说明
}
export const REF_PRICES: RefPrice[] = [
  { resourceId: 'wood', cny: 2.5, currency: 'CNY', unit: '份', source: '模拟数据（人工设定）', updatedAt: '2026-10-12', rule: '1 份≈2kg 原木；游戏币仅为游戏内单位，不与人民币挂钩' },
  { resourceId: 'stone', cny: 1.8, currency: 'CNY', unit: '份', source: '模拟数据（人工设定）', updatedAt: '2026-10-12', rule: '1 份≈5kg 毛石；游戏币仅为游戏内单位，不与人民币挂钩' },
  { resourceId: 'clay', cny: 1.2, currency: 'CNY', unit: '份', source: '模拟数据（人工设定）', updatedAt: '2026-10-12', rule: '1 份≈3kg 黏土；游戏币仅为游戏内单位，不与人民币挂钩' },
  { resourceId: 'fiber', cny: 0.8, currency: 'CNY', unit: '份', source: '模拟数据（人工设定）', updatedAt: '2026-10-12', rule: '1 份≈1kg 植物纤维；游戏币仅为游戏内单位，不与人民币挂钩' },
  { resourceId: 'plank', cny: 4.0, currency: 'CNY', unit: '块', source: '模拟数据（人工设定）', updatedAt: '2026-10-12', rule: '含简易加工费；游戏币仅为游戏内单位，不与人民币挂钩' },
  { resourceId: 'brick', cny: 3.0, currency: 'CNY', unit: '块', source: '模拟数据（人工设定）', updatedAt: '2026-10-12', rule: '含烧制加工费；游戏币仅为游戏内单位，不与人民币挂钩' },
];
export function refPriceOf(resId: string): RefPrice | undefined {
  return REF_PRICES.find((r) => r.resourceId === resId);
}
