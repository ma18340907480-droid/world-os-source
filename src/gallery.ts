// WORLD OS Alpha 0.2 · 作品展示（创作者经济数据基础）
// 记录：作品名称 / 作者 / 创建时间 / 点赞数 / 模拟交易次数
import { openPanel, el, toast } from './ui';
import { BUILDABLE_NAMES, COMMUNITY_WORKS } from './data';
import { newId, type SaveData, type WorkRec } from './save';

const ICONS: Record<string, string> = {
  hut: '🏠', shop: '🏪', fence: '🪧', lamp: '💡', tree: '🍎', flower: '🌸',
  thatch: '🛖', stonehouse: '🧱', workshop: '⚒️', warehouse: '📦', tower: '🏢',
};

export function iconOf(type: string): string { return ICONS[type] ?? '🏗️'; }

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export class Gallery {
  private save: SaveData;
  private queueSave: () => void;
  private onValuation: (w: WorkRec) => number;

  constructor(save: SaveData, queueSave: () => void, onValuation: (w: WorkRec) => number = () => 0) {
    this.save = save;
    this.queueSave = queueSave;
    this.onValuation = onValuation;
  }

  open(onFocus: (x: number, z: number) => void) {
    const body = openPanel('🌟 作品展示');
    body.appendChild(el('div', '',
      '<span style="color:#9fb3d9;font-size:12px">※ 点赞/访客为本地模拟，非真实玩家互动</span>'));

    const mine = this.save.works.filter((w) => !w.simulated);
    const totalLikes = mine.reduce((s, w) => s + w.likes, 0);
    const totalTrades = mine.reduce((s, w) => s + w.trades, 0);
    const grid = el('div', 'stat-grid');
    grid.innerHTML = `
      <div class="stat-box"><div class="v">${mine.length}</div><div class="k">我的作品</div></div>
      <div class="stat-box"><div class="v">❤️${totalLikes}</div><div class="k">获赞</div></div>
      <div class="stat-box"><div class="v">🔁${totalTrades}</div><div class="k">成交</div></div>
      <div class="stat-box"><div class="v">🪙${this.save.totalEarned}</div><div class="k">累计赚取</div></div>`;
    body.appendChild(grid);

    body.appendChild(el('div', 'sec-title', '🧱 我的作品'));
    if (mine.length === 0) {
      body.appendChild(el('div', '',
        '<p style="color:#9fb3d9">还没有作品。去建造吧，每栋建筑都会自动成为你的作品！</p>'));
    }
    // 按创建时间倒序
    [...mine].sort((a, b) => b.createdAt - a.createdAt).forEach((w) => {
      const row = el('div', 'shop-item');
      const val = this.onValuation(w);
      const costLine = w.costBasis > 0
        ? ` · 💰造价 🪙${w.costBasis}${val > 0 ? ` · 📊估值 🪙${val}` : ''}`
        : '';
      row.innerHTML = `<div class="icon">${iconOf(w.type)}</div>
        <div class="info"><div class="nm">${w.name}${w.demolished ? ' <span style="color:#9fb3d9;font-size:12px">（已拆除）</span>' : ''}</div>
        <div class="ds">👤 ${w.author} · 📅 ${fmtDate(w.createdAt)} · ❤️ ${w.likes} · 🔁 交易 ${w.trades}${costLine}</div></div>`;
      if (!w.demolished) {
        const b = this.save.buildings.find((x) => x.id === w.buildingId);
        if (b) {
          const go = el('button', 'btn small', '前往') as HTMLButtonElement;
          go.onclick = () => onFocus(b.x, b.z);
          row.appendChild(go);
        }
      }
      body.appendChild(row);
    });

    body.appendChild(el('div', 'sec-title', '🌍 社区作品 <span style="font-size:11px;color:#9fb3d9">（模拟）</span>'));
    for (const c of COMMUNITY_WORKS) {
      const wid = `community_${c.name}`;
      const liked = this.save.likedWorks.includes(wid);
      // 社区作品的点赞数 = 基础 + 玩家点的那 1 个
      const likes = c.likes + (liked ? 1 : 0);
      const row = el('div', 'shop-item');
      row.innerHTML = `<div class="icon">${iconOf(c.type)}</div>
        <div class="info"><div class="nm">${c.name}</div>
        <div class="ds">👤 ${c.author} · ❤️ ${likes} · 🔁 交易 ${c.trades}</div></div>`;
      const likeBtn = el('button', `btn small${liked ? ' ghost' : ''}`, liked ? '已赞' : '❤️ 点赞') as HTMLButtonElement;
      likeBtn.onclick = () => {
        if (liked) { toast('已经点过赞了'); return; }
        this.save.likedWorks.push(wid);
        toast(`给「${c.name}」点了赞 ❤️`);
        this.queueSave();
        likeBtn.textContent = '已赞';
        likeBtn.className = 'btn small ghost';
      };
      row.appendChild(likeBtn);
      body.appendChild(row);
    }

    body.appendChild(el('div', '',
      '<p style="color:#6b7d9f;font-size:12px;margin-top:8px">※ Alpha 0.2：作品仅保存在本地。未来版本可扩展为作品授权、创作者分成与共享世界。</p>'));
  }

  /** 建造时自动登记作品 */
  registerWork(type: string, buildingId: string, costBasis = 0): WorkRec {
    const name = `${this.save.playerName}的${BUILDABLE_NAMES[type] ?? type}`;
    const w: WorkRec = {
      id: newId('w'), name, author: this.save.playerName, type,
      createdAt: Date.now(), likes: 0, trades: 0, costBasis, buildingId,
    };
    this.save.works.push(w);
    this.queueSave();
    return w;
  }

  /** 模拟访客点赞：随机给一件玩家作品 +1 */
  simulateLike(): boolean {
    const mine = this.save.works.filter((w) => !w.simulated && !w.demolished);
    if (mine.length === 0 || Math.random() > 0.3) return false;
    const w = mine[Math.floor(Math.random() * mine.length)];
    w.likes += 1;
    this.queueSave();
    toast(`❤️ 有访客给你的「${w.name}」点了赞！`);
    return true;
  }
}
