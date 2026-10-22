// WORLD OS Alpha 0.4 · 本地存档（localForage → IndexedDB，自动降级 localStorage）
// v4 新增：市场交易记录、价格因子、上次维护结算时间；作品加建造成本

/** 市场交易记录（防重复结算：每笔有唯一 id） */
export interface MarketTx {
  id: string; time: number;
  dir: 'buy' | 'sell';
  resId: string; n: number;
  unitPrice: number; total: number;
}

export interface BuildingRec {
  id: string; type: string; x: number; z: number; rot: number;
  /** 建筑等级（升级提升，默认 1） */
  level?: number;
}

/** 上架商品（库存 = 背包数量，不另设账本） */
export interface ListingRec { itemId: string; price: number }

/** 玩家自营商店 */
export interface MyShopRec {
  buildingId: string;
  name: string;
  listings: ListingRec[];
  earned: number;   // 累计赚取（金币）
  trades: number;   // 累计成交笔数
}

/** 作品（创作者经济数据基础：名称/作者/时间/点赞/模拟交易数） */
export interface WorkRec {
  id: string;
  name: string;
  author: string;
  type: string;        // 建筑类型
  createdAt: number;   // 时间戳
  likes: number;
  trades: number;      // 模拟交易次数
  costBasis: number;   // 建造成本（材料按市价+人工费），与估值分开
  buildingId?: string; // 关联的建筑（删除后保留记录）
  demolished?: boolean;
  simulated?: boolean; // 社区模拟作品（非玩家建造）
}

export interface SaveData {
  version: 4;
  coins: number;
  playerName: string;
  xp: number;
  level: number;
  inventory: Record<string, number>;
  quests: Record<string, 'active' | 'done'>;
  progress: Record<string, number>;
  buildings: BuildingRec[];
  works: WorkRec[];
  myShops: MyShopRec[];
  likedWorks: string[];
  totalEarned: number; // 累计赚取（经营+任务奖励都算，用于解锁）
  marketTx: MarketTx[]; // 市场交易记录
  priceFactor: Record<string, number>; // 资源价格因子（供需影响，0.7~1.3）
  lastMaint: number; // 上次维护/经营结算时间戳
  px: number;
  pz: number;
}

const KEY = 'worldos-alpha01-save';

let localforage: typeof import('localforage') | null = null;
async function lf() {
  if (!localforage) {
    localforage = (await import('localforage')).default;
    localforage.config({ name: 'worldos', storeName: 'saves' });
  }
  return localforage;
}

let idSeq = 0;
export function newId(prefix: string): string {
  idSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${idSeq}`;
}

export function defaultSave(): SaveData {
  return {
    version: 4,
    coins: 100,
    playerName: '旅行者',
    xp: 0,
    level: 1,
    inventory: {},
    quests: { q1: 'active' },
    progress: {},
    buildings: [],
    works: [],
    myShops: [],
    likedWorks: [],
    totalEarned: 0,
    marketTx: [],
    priceFactor: {},
    lastMaint: Date.now(),
    px: 5, pz: 8,
  };
}

/** v1 → v2 迁移：建筑补 id，旧建筑生成作品记录 */
function migrateV1(d: Record<string, unknown>): SaveData {
  const s = defaultSave();
  const v1 = d as unknown as {
    coins: number; inventory: Record<string, number>;
    quests: Record<string, 'active' | 'done'>; progress: Record<string, number>;
    buildings: { type: string; x: number; z: number; rot: number }[];
    px: number; pz: number;
  };
  s.coins = v1.coins ?? 100;
  s.inventory = v1.inventory ?? {};
  s.quests = v1.quests ?? { q1: 'active' };
  s.progress = v1.progress ?? {};
  s.px = v1.px ?? 5; s.pz = v1.pz ?? 8;
  const now = Date.now();
  s.buildings = (v1.buildings ?? []).map((b) => ({ ...b, id: newId('b') }));
  s.works = s.buildings.map((b, i) => ({
    id: newId('w'),
    name: `${s.playerName}的${b.type}`,
    author: s.playerName,
    type: b.type,
    createdAt: now - (s.buildings.length - i) * 60000,
    likes: 0, trades: 0, costBasis: 0,
    buildingId: b.id,
  }));
  return s;
}

/** v3 → v4：补市场/维护字段；作品补建造成本 */
function migrateV3(d: Record<string, unknown>): SaveData {
  const s = d as unknown as SaveData;
  s.version = 4;
  s.marketTx = s.marketTx ?? [];
  s.priceFactor = s.priceFactor ?? {};
  s.lastMaint = s.lastMaint ?? Date.now();
  for (const w of s.works ?? []) {
    if (w.costBasis === undefined) w.costBasis = 0;
  }
  return s;
}

/** v2 → v3：补经验等级（再经 migrateV3 升到 v4） */
function migrateV2(d: Record<string, unknown>): SaveData {
  const s = d as unknown as SaveData;
  s.xp = s.xp ?? 0;
  s.level = s.level ?? 1;
  return migrateV3(s as unknown as Record<string, unknown>);
}

export async function loadSave(): Promise<SaveData | null> {
  try {
    const store = await lf();
    const d = await store.getItem<Record<string, unknown>>(KEY);
    if (!d) return null;
    const v = (d as { version: number }).version;
    if (v === 4) return d as unknown as SaveData;
    if (v === 3) {
      const m = migrateV3(d);
      await store.setItem(KEY, m);
      return m;
    }
    if (v === 2) {
      const m = migrateV2(d);
      await store.setItem(KEY, m);
      return m;
    }
    if (v === 1) {
      const m = migrateV1(d);
      m.xp = 0; m.level = 1;
      const m4 = migrateV3(m as unknown as Record<string, unknown>);
      await store.setItem(KEY, m4);
      return m4;
    }
    return null;
  } catch {
    return null;
  }
}

/** 等待所有排队的存档写入完成（测试/页面卸载前用） */
let saveChain: Promise<void> = Promise.resolve();

/** 测试用：模拟下一次严格保存失败 */
let failNextStrictSave = false;
export function simulateSaveFailureOnce(): void {
  failNextStrictSave = true;
}
export function flushSaves(): Promise<void> {
  return saveChain.catch(() => {});
}
export async function storeSave(d: SaveData, strict = false): Promise<boolean> {
  let snapshot: SaveData;
  try {
    snapshot = JSON.parse(JSON.stringify(d)) as SaveData;
  } catch {
    if (strict) throw new Error('存档序列化失败');
    return false;
  }
  // 测试用：模拟保存失败
  const shouldFail = strict && failNextStrictSave;
  if (shouldFail) failNextStrictSave = false;
  const task = saveChain.then(async () => {
    try {
      if (shouldFail) throw new Error('模拟的保存失败（测试）');
      await (await lf()).setItem(KEY, snapshot);
    } catch (e) {
      if (strict) throw e;
      /* 非严格模式：忽略存档失败（保持原有行为） */
    }
  });
  saveChain = task.catch(() => {});
  try {
    await task;
    return true;
  } catch {
    return false;
  }
}

export async function clearSave(): Promise<void> {
  try { await (await lf()).removeItem(KEY); } catch { /* ignore */ }
}
