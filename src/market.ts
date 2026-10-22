// WORLD OS Alpha 0.4 · 单机模拟市场
// 玩家买卖材料：真实扣库存/金币，每笔交易生成唯一记录（防重复结算）。
// 价格受供需影响（卖得多降价、买得多涨价），因子限制 0.7~1.3（反刷）。
// 本市场为本地模拟，非真实玩家间交易。

import { newId, type SaveData, type MarketTx } from './save';
import { resDef } from './resources';

export class Market {
  private save: SaveData;
  private canStore: (delta: number) => boolean;

  constructor(save: SaveData, _onCoins: (n: number) => void, _onSave: () => void = () => {}, canStore: (delta: number) => boolean = () => true) {
    this.save = save;
    this.canStore = canStore;
  }

  /** 玩家卖出价（基准 × 供需因子） */
  sellPrice(resId: string): number {
    const d = resDef(resId);
    if (!d) return 1;
    const f = this.save.priceFactor[resId] ?? 1;
    return Math.max(1, Math.round(d.gamePrice * f));
  }

  /** 玩家买入价（卖出价 × 1.2 市场差价） */
  buyPrice(resId: string): number {
    return Math.max(1, Math.round(this.sellPrice(resId) * 1.2));
  }

  /** 玩家卖出 n 个资源 */
  sell(resId: string, n: number): MarketTx | null {
    // 严格数量校验：在修改任何状态之前拒绝非法输入
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
    const have = this.save.inventory[resId] ?? 0;
    if (n > have) return null;
    const unit = this.sellPrice(resId);
    const total = unit * n;
    this.save.inventory[resId] = have - n;
    // 直接修改金币（调用方负责 HUD 和保存，避免内部 queueSave 干扰回滚）
    this.save.coins += total;
    this.bumpFactor(resId, -0.015 * n);
    const tx = this.record('sell', resId, n, unit, total);
    // 保存由调用方负责（统一保存责任，避免重复保存）
    return tx;
  }

  /** 玩家买入 n 个资源 */
  buy(resId: string, n: number): MarketTx | null {
    // 严格数量校验：在修改任何状态之前拒绝非法输入
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
    if (!this.canStore(n)) return null; // 储物容量拦截（调用方 toast 提示）
    const unit = this.buyPrice(resId);
    const total = unit * n;
    if (this.save.coins < total) return null;
    // 直接修改金币（调用方负责 HUD 和保存，避免内部 queueSave 干扰回滚）
    this.save.coins -= total;
    this.save.inventory[resId] = (this.save.inventory[resId] ?? 0) + n;
    this.bumpFactor(resId, 0.015 * n);
    const tx = this.record('buy', resId, n, unit, total);
    // 保存由调用方负责（统一保存责任，避免重复保存）
    return tx;
  }

  bumpFactor(resId: string, delta: number) {
    const f = (this.save.priceFactor[resId] ?? 1) + delta;
    this.save.priceFactor[resId] = Math.min(1.3, Math.max(0.7, Math.round(f * 100) / 100));
  }

  private record(dir: 'buy' | 'sell', resId: string, n: number, unitPrice: number, total: number): MarketTx {
    const tx: MarketTx = {
      id: newId('tx'), time: Date.now(), dir, resId, n, unitPrice, total,
    };
    this.save.marketTx.push(tx);
    if (this.save.marketTx.length > 100) {
      this.save.marketTx = this.save.marketTx.slice(-100);
    }
    return tx;
  }
}
