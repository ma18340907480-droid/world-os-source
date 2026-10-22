// WORLD OS Alpha 0.2 · 玩家自营商店（本地模拟经营，非真实交易）
import { SHOP_ITEMS, CUSTOMER_NAMES } from './data';
import { openPanel, el, toast } from './ui';
import type { SaveData, MyShopRec } from './save';

export class MyShopManager {
  private save: SaveData;
  private onCoins: (n: number) => void;
  private onTrade: (shop: MyShopRec, itemId: string, price: number) => void;
  private queueSave: () => void;

  constructor(
    save: SaveData,
    onCoins: (n: number) => void,
    onTrade: (shop: MyShopRec, itemId: string, price: number) => void,
    queueSave: () => void,
  ) {
    this.save = save;
    this.onCoins = onCoins;
    this.onTrade = onTrade;
    this.queueSave = queueSave;
  }

  /** 商店管理面板 */
  open(shop: MyShopRec) {
    const body = openPanel(`🏪 ${shop.name}`);
    body.appendChild(el('div', '',
      '<span style="color:#9fb3d9;font-size:12px">※ 本地模拟经营：顾客为模拟数据，非真实交易</span>'));

    const stats = el('div', 'stat-grid');
    const renderStats = () => {
      stats.innerHTML = `
        <div class="stat-box"><div class="v">🪙${shop.earned}</div><div class="k">累计赚取</div></div>
        <div class="stat-box"><div class="v">${shop.trades}</div><div class="k">成交笔数</div></div>
        <div class="stat-box"><div class="v">${shop.listings.length}</div><div class="k">在售商品</div></div>`;
    };
    renderStats();
    body.appendChild(stats);

    // 改店名
    const nameRow = el('div', 'shop-item');
    nameRow.innerHTML = `<div class="info"><div class="nm">店名</div></div>`;
    const nameInput = el('input', 'price-input wide') as HTMLInputElement;
    nameInput.value = shop.name;
    nameInput.maxLength = 12;
    const nameBtn = el('button', 'btn small', '改名') as HTMLButtonElement;
    nameBtn.onclick = () => {
      const v = nameInput.value.trim();
      if (!v) { toast('店名不能为空'); return; }
      shop.name = v;
      toast(`店名改为「${v}」`);
      this.queueSave();
    };
    nameRow.append(nameInput, nameBtn);
    body.appendChild(nameRow);

    // 在售列表
    body.appendChild(el('div', 'sec-title', '📦 在售商品'));
    const listBox = el('div');
    body.appendChild(listBox);

    const renderList = () => {
      listBox.innerHTML = '';
      if (shop.listings.length === 0) {
        listBox.appendChild(el('div', '',
          '<p style="color:#9fb3d9">还没上架商品。从下面的背包里选一件定价上架吧。</p>'));
      }
      for (const l of shop.listings) {
        const item = SHOP_ITEMS.find((i) => i.id === l.itemId)!;
        const have = this.save.inventory[l.itemId] ?? 0;
        const row = el('div', 'shop-item');
        row.innerHTML = `<div class="icon">${item.icon}</div>
          <div class="info"><div class="nm">${item.name} <span style="color:#9fb3d9;font-size:12px">库存×${have}</span></div>
          <div class="ds">收购参考价 🪙${item.sellPrice}（定太贵会滞销）</div></div>`;
        const priceInput = el('input', 'price-input') as HTMLInputElement;
        priceInput.type = 'number';
        priceInput.value = String(l.price);
        priceInput.min = '1'; priceInput.max = '999';
        const okBtn = el('button', 'btn small', '改价') as HTMLButtonElement;
        okBtn.onclick = () => {
          const v = Math.max(1, Math.min(999, parseInt(priceInput.value) || l.price));
          l.price = v;
          toast(`${item.name}定价改为 🪙${v}`);
          this.queueSave(); renderList();
        };
        const offBtn = el('button', 'btn small ghost', '下架') as HTMLButtonElement;
        offBtn.onclick = () => {
          shop.listings = shop.listings.filter((x) => x !== l);
          toast(`${item.name}已下架`);
          this.queueSave(); renderList(); renderStats(); renderStock();
        };
        row.append(priceInput, okBtn, offBtn);
        listBox.appendChild(row);
      }
    };

    // 背包可上架
    body.appendChild(el('div', 'sec-title', '🎒 背包（点上架）'));
    const stockBox = el('div');
    body.appendChild(stockBox);
    const renderStock = () => {
      stockBox.innerHTML = '';
      const listed = new Set(shop.listings.map((l) => l.itemId));
      const avail = SHOP_ITEMS.filter((it) => (this.save.inventory[it.id] ?? 0) > 0 && !listed.has(it.id));
      if (avail.length === 0) {
        stockBox.appendChild(el('div', '',
          '<p style="color:#9fb3d9">背包里没有可上架的物品，去收集一些吧。</p>'));
        return;
      }
      for (const it of avail) {
        const have = this.save.inventory[it.id] ?? 0;
        const row = el('div', 'shop-item');
        row.innerHTML = `<div class="icon">${it.icon}</div>
          <div class="info"><div class="nm">${it.name} <span style="color:#9fb3d9;font-size:12px">×${have}</span></div>
          <div class="ds">建议价 🪙${it.sellPrice} 左右</div></div>`;
        const priceInput = el('input', 'price-input') as HTMLInputElement;
        priceInput.type = 'number';
        priceInput.value = String(it.sellPrice);
        priceInput.min = '1'; priceInput.max = '999';
        const b = el('button', 'btn small', '上架') as HTMLButtonElement;
        b.onclick = () => {
          const v = Math.max(1, Math.min(999, parseInt(priceInput.value) || it.sellPrice));
          shop.listings.push({ itemId: it.id, price: v });
          toast(`${it.name}上架了，定价 🪙${v}`);
          this.queueSave(); renderList(); renderStats(); renderStock();
        };
        row.append(priceInput, b);
        stockBox.appendChild(row);
      }
    };

    renderList();
    renderStock();
  }

  /** 模拟顾客 tick：game loop 每 ~18 秒调一次 */
  tick() {
    let sold = false;
    for (const shop of this.save.myShops) {
      if (this.trySale(shop)) sold = true;
    }
    if (sold) this.queueSave();
  }

  /** 一家店一次购买机会；返回是否成交 */
  private trySale(shop: MyShopRec): boolean {
    const avail = shop.listings.filter((l) => (this.save.inventory[l.itemId] ?? 0) > 0);
    if (avail.length === 0) return false;
    const l = avail[Math.floor(Math.random() * avail.length)];
    const item = SHOP_ITEMS.find((i) => i.id === l.itemId)!;
    const ratio = l.price / Math.max(1, item.sellPrice);
    let chance: number;
    if (ratio <= 1) chance = 0.8;
    else if (ratio <= 1.5) chance = 0.5;
    else if (ratio <= 2) chance = 0.22;
    else chance = 0.07;
    const customer = CUSTOMER_NAMES[Math.floor(Math.random() * CUSTOMER_NAMES.length)];
    if (Math.random() < chance) {
      this.save.inventory[l.itemId] -= 1;
      this.onCoins(l.price);
      shop.earned += l.price;
      shop.trades += 1;
      this.save.totalEarned += l.price;
      toast(`🛎️ ${customer}买走了${item.name}，金币+${l.price}`);
      this.onTrade(shop, l.itemId, l.price);
      return true;
    }
    if (ratio > 1.5 && Math.random() < 0.45) {
      toast(`💬 ${customer}看了看${item.name}：太贵了，走了…`);
    }
    return false;
  }
}
