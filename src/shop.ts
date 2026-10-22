// WORLD OS Alpha 0.1 · 商店（虚拟金币买卖，Alpha 内测经济，非真实交易）
import { SHOP_ITEMS, ITEM_NAMES } from './data';
import { openPanel, closePanel, el, toast } from './ui';
import type { SaveData } from './save';

export class Shop {
  private save: SaveData;
  private onSell: () => void;
  private refreshHUD: () => void;
  private canStore: (delta: number) => boolean;
  private onSave: () => Promise<boolean>;

  constructor(
    save: SaveData,
    _onCoins: (n: number) => void,
    onSell: () => void,
    refreshHUD: () => void,
    canStore: (delta: number) => boolean = () => true,
    onSave: () => Promise<boolean> = async () => true,
  ) {
    this.save = save;
    this.onSell = onSell;
    this.refreshHUD = refreshHUD;
    this.canStore = canStore;
    this.onSave = onSave;
  }

  open() {
    const body = openPanel('🛒 金满的商店');
    body.appendChild(el('div', '', '<span style="color:#9fb3d9;font-size:12px">※ Alpha 内测：虚拟金币交易，非真实货币</span>'));
    const tabs = el('div', 'shop-tabs');
    const buyBtn = el('button', 'btn small', '买入') as HTMLButtonElement;
    const sellBtn = el('button', 'btn small ghost', '卖出') as HTMLButtonElement;
    tabs.append(buyBtn, sellBtn);
    body.appendChild(tabs);
    const list = el('div');
    body.appendChild(list);

    const renderBuy = () => {
      buyBtn.className = 'btn small'; sellBtn.className = 'btn small ghost';
      list.innerHTML = '';
      for (const it of SHOP_ITEMS) {
        const row = el('div', 'shop-item');
        const have = this.save.inventory[it.id] ?? 0;
        row.innerHTML = `<div class="icon">${it.icon}</div>
          <div class="info"><div class="nm">${it.name} <span style="color:#9fb3d9;font-size:12px">×${have}</span></div>
          <div class="ds">${it.desc}</div></div>
          <div class="pr">🪙${it.buyPrice}</div>`;
        const b = el('button', 'btn small', '购买') as HTMLButtonElement;
        // 批量购买：数量输入
        const qtyInput = el('input', '') as HTMLInputElement;
        qtyInput.type = 'number';
        qtyInput.min = '1';
        qtyInput.value = '1';
        qtyInput.style.width = '52px';
        qtyInput.style.padding = '4px';
        // 防连点：异步交易期间禁用按钮
        let buying = false;
        const doBuy = async (n: number) => {
          if (buying) return;
          if (!Number.isInteger(n) || n < 1) { toast('数量至少为 1'); return; }
          // 每次读取最新状态，不使用渲染时捕获的旧值
          const curHave = this.save.inventory[it.id] ?? 0;
          const total = it.buyPrice * n;
          if (this.save.coins < total) { toast('金币不足！'); return; }
          if (!this.canStore(n)) { toast(`📦 储物已满，升级房屋扩容`); return; }
          buying = true;
          b.disabled = true;
          const coinsBefore = this.save.coins;
          try {
            // 先扣币加库存，再等待保存完成（P0 修复：确保落盘才提示成功）
            this.save.coins -= total;
            this.save.inventory[it.id] = curHave + n;
            const saved = await this.onSave();
            if (!saved) {
              // 保存失败：精确回滚本次交易
              this.save.coins = coinsBefore;
              this.save.inventory[it.id] = curHave;
              toast('⚠️ 保存失败，购买已取消，请重试');
              this.refreshHUD(); renderBuy();
              return;
            }
            toast(`✅ 购买成功：${it.name}×${n}`);
            this.refreshHUD(); renderBuy();
          } finally {
            buying = false;
            b.disabled = false;
          }
        };
        b.onclick = () => {
          const n = Math.floor(Number(qtyInput.value)) || 1;
          void doBuy(n);
        };
        const qtyWrap = el('div', '');
        qtyWrap.style.display = 'flex';
        qtyWrap.style.gap = '4px';
        qtyWrap.style.alignItems = 'center';
        const minusB = el('button', 'btn small ghost', '−') as HTMLButtonElement;
        minusB.onclick = () => {
          const v = Math.max(1, (Math.floor(Number(qtyInput.value)) || 1) - 1);
          qtyInput.value = String(v);
        };
        const plusB = el('button', 'btn small ghost', '+') as HTMLButtonElement;
        plusB.onclick = () => {
          const v = (Math.floor(Number(qtyInput.value)) || 0) + 1;
          qtyInput.value = String(v);
        };
        qtyWrap.append(minusB, qtyInput, plusB, b);
        row.appendChild(qtyWrap);
        list.appendChild(row);
      }
    };
    const renderSell = () => {
      sellBtn.className = 'btn small'; buyBtn.className = 'btn small ghost';
      list.innerHTML = '';
      const owned = SHOP_ITEMS.filter((it) => (this.save.inventory[it.id] ?? 0) > 0);
      if (owned.length === 0) {
        list.appendChild(el('div', '', '<p style="color:#9fb3d9">背包空空如也，去收集或购买一些物品吧。</p>'));
        return;
      }
      for (const it of owned) {
        const have = this.save.inventory[it.id] ?? 0;
        const row = el('div', 'shop-item');
        row.innerHTML = `<div class="icon">${it.icon}</div>
          <div class="info"><div class="nm">${it.name} <span style="color:#9fb3d9;font-size:12px">×${have}</span></div>
          <div class="ds">售价 🪙${it.sellPrice}/个</div></div>`;
        const b = el('button', 'btn small', '卖出') as HTMLButtonElement;
        // 批量卖出：数量输入
        const qtyInput = el('input', '') as HTMLInputElement;
        qtyInput.type = 'number';
        qtyInput.min = '1';
        qtyInput.value = '1';
        qtyInput.style.width = '52px';
        qtyInput.style.padding = '4px';
        let selling = false;
        b.onclick = async () => {
          if (selling) return;
          const n = Math.floor(Number(qtyInput.value)) || 1;
          if (!Number.isInteger(n) || n < 1) { toast('数量至少为 1'); return; }
          const curHave = this.save.inventory[it.id] ?? 0;
          if (n > curHave) { toast(`库存不足（持有 ${curHave}）`); return; }
          selling = true;
          b.disabled = true;
          const coinsBefore = this.save.coins;
          try {
            const total = it.sellPrice * n;
            this.save.inventory[it.id] = curHave - n;
            this.save.coins += total;
            const saved = await this.onSave();
            if (!saved) {
              this.save.inventory[it.id] = curHave;
              this.save.coins = coinsBefore;
              toast('⚠️ 保存失败，出售已取消，请重试');
              this.refreshHUD(); renderSell();
              return;
            }
            toast(`✅ 卖出成功：${it.name}×${n}，金币+${total}`);
            this.onSell();
            this.refreshHUD(); renderSell();
          } finally {
            selling = false;
            b.disabled = false;
          }
        };
        const qtyWrap = el('div', '');
        qtyWrap.style.display = 'flex';
        qtyWrap.style.gap = '4px';
        qtyWrap.style.alignItems = 'center';
        const minusB = el('button', 'btn small ghost', '−') as HTMLButtonElement;
        minusB.onclick = () => {
          const v = Math.max(1, (Math.floor(Number(qtyInput.value)) || 1) - 1);
          qtyInput.value = String(v);
        };
        const plusB = el('button', 'btn small ghost', '+') as HTMLButtonElement;
        plusB.onclick = () => {
          const v = (Math.floor(Number(qtyInput.value)) || 0) + 1;
          qtyInput.value = String(v);
        };
        qtyWrap.append(minusB, qtyInput, plusB, b);
        row.appendChild(qtyWrap);
        list.appendChild(row);
      }
    };
    buyBtn.onclick = renderBuy;
    sellBtn.onclick = renderSell;
    renderBuy();
  }

  close() { closePanel(); }
}

export function itemName(id: string): string { return ITEM_NAMES[id] ?? id; }
