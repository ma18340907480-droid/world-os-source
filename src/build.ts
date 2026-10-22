// WORLD OS Alpha 0.4 · 建造模式（中文图纸，点选空地放置；含解锁与拆除；配方真实扣料）
import * as THREE from 'three';
import { BUILDABLES, BUILDABLE_NAMES, TIER_NAMES, unlockText, type BuildableDef } from './data';
import { makeBuilding } from './world';
import { resDef } from './resources';
import { el, toast } from './ui';
import { newId, type SaveData, type BuildingRec } from './save';
import type { Collider } from './player';

export interface PlacedBuilding { rec: BuildingRec; group: THREE.Group }

/** 配方检查：材料是否够、人工费是否够 */
export function recipeStatus(save: SaveData, def: BuildableDef): {
  ok: boolean;
  missing: { id: string; need: number; have: number }[];
  feeOk: boolean;
} {
  const missing = (def.recipe ?? []).map((r) => ({
    id: r.id, need: r.n, have: save.inventory[r.id] ?? 0,
  })).filter((m) => m.have < m.need);
  const feeOk = save.coins >= (def.laborFee ?? 0);
  return { ok: missing.length === 0 && feeOk, missing, feeOk };
}

/** 配方简写：🪵12 🌾6 +🪙20 */
export function recipeShort(def: BuildableDef): string {
  const mats = (def.recipe ?? []).map((r) => {
    const d = resDef(r.id);
    return `${d?.icon ?? ''}${r.n}`;
  }).join(' ');
  return `${mats} +🪙${def.laborFee ?? 0}`;
}

export class BuildMode {
  active = false;
  mode: 'build' | 'demolish' = 'build';
  private selected: BuildableDef | null = null;
  private ghost: THREE.Group | null = null;
  private ghostPos: THREE.Vector3 | null = null;
  private rotY = 0;
  private ray = new THREE.Raycaster();
  private bar: HTMLElement | null = null;
  private pendingDemolish: PlacedBuilding | null = null;
  private pendingTimer = 0;

  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private ground: THREE.Mesh;
  private save: SaveData;
  private colliders: Collider[];
  private bounds: number;
  private onPlaced: (rec: BuildingRec, group: THREE.Group) => void;
  private onDemolish: (rec: BuildingRec) => void;
  private getPlaced: () => PlacedBuilding[];
  private isUnlocked: (b: BuildableDef) => { ok: boolean; reason: string };
  private findAutoSpot: () => { x: number; z: number } | null;
  private onExit: () => void;
  private getDemolishWarn: (rec: BuildingRec) => string | null;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    ground: THREE.Mesh,
    save: SaveData,
    colliders: Collider[],
    bounds: number,
    onPlaced: (rec: BuildingRec, group: THREE.Group) => void,
    onDemolish: (rec: BuildingRec) => void,
    getPlaced: () => PlacedBuilding[],
    isUnlocked: (b: BuildableDef) => { ok: boolean; reason: string },
    findAutoSpot: () => { x: number; z: number } | null = () => null,
    onExit: () => void = () => {},
    getDemolishWarn: (rec: BuildingRec) => string | null = () => null,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.ground = ground;
    this.save = save;
    this.colliders = colliders;
    this.bounds = bounds;
    this.onPlaced = onPlaced;
    this.onDemolish = onDemolish;
    this.getPlaced = getPlaced;
    this.isUnlocked = isUnlocked;
    this.findAutoSpot = findAutoSpot;
    this.onExit = onExit;
    this.getDemolishWarn = getDemolishWarn;
  }

  get unlocked(): boolean { return true; }

  enter() {
    this.active = true;
    this.mode = 'build';
    this.renderBar();
    toast('建造模式：点空地选择位置');
  }

  private renderBar() {
    this.bar?.remove();
    const ui = document.getElementById('ui')!;
    const bar = el('div');
    bar.id = 'buildbar';
    bar.style.display = 'block';
    if (this.mode === 'build') {
      bar.appendChild(el('div', 'hint', '选图纸自动找空位 → 直接点放置（也可点地面微调位置）'));
      // 按等级分组（upgradeOnly 的只走升级，不在建造菜单显示）
      for (let tier = 1; tier <= 4; tier++) {
        const defs = BUILDABLES.filter((b) => (b.tier ?? 1) === tier && !b.upgradeOnly);
        if (!defs.length) continue;
        bar.appendChild(el('div', 'sec-title', `—— ${TIER_NAMES[tier]} ——`));
        const row = el('div', 'row');
        for (const b of defs) {
          const u = this.isUnlocked(b);
          const lockHtml = u.ok ? '' : `<div class="bp">🔒</div>`;
          const it = el('div', `build-item${u.ok ? '' : ' locked'}`,
            `<div class="bi">${u.ok ? b.icon : '🔒'}</div><div>${b.name}</div><div class="bp">${u.ok ? recipeShort(b) : (unlockText(b) ?? '')}</div>${lockHtml}`);
          it.onclick = () => {
            const uu = this.isUnlocked(b);
            if (!uu.ok) { toast(`🔒 ${uu.reason}`); return; }
            this.select(b);
            bar.querySelectorAll('.build-item').forEach((x) => x.classList.remove('selected'));
            it.classList.add('selected');
          };
          row.appendChild(it);
        }
        bar.appendChild(row);
      }
      const ops = el('div', 'ops');
      const rotB = el('button', 'btn ghost', '🔄 旋转') as HTMLButtonElement;
      rotB.onclick = () => this.rotate();
      const okB = el('button', 'btn', '✅ 放置') as HTMLButtonElement;
      okB.onclick = () => this.place();
      const demB = el('button', 'btn ghost', '🗑️ 拆除') as HTMLButtonElement;
      demB.onclick = () => { this.mode = 'demolish'; this.clearGhost(); this.renderBar(); toast('拆除模式：点一栋建筑，再点一次确认（返还 50%）'); };
      const cancelB = el('button', 'btn ghost', '取消') as HTMLButtonElement;
      cancelB.onclick = () => this.exit();
      ops.append(rotB, okB, demB, cancelB);
      bar.appendChild(ops);
      ui.appendChild(bar);
      this.bar = bar;
      const first = BUILDABLES.find((b) => this.isUnlocked(b).ok);
      if (first) {
        this.select(first);
        bar.querySelector(`.build-item.selected`)?.classList.remove('selected');
        const items = bar.querySelectorAll('.build-item');
        const idx = BUILDABLES.filter((b) => (b.tier ?? 1) === (first.tier ?? 1)).indexOf(first);
        // 简单起见：给第一个可用图纸加 selected（按渲染顺序找对应 icon）
        for (const it of Array.from(items)) {
          if ((it as HTMLElement).textContent?.includes(first.name)) {
            (it as HTMLElement).classList.add('selected');
            break;
          }
        }
        void idx;
      }
    } else {
      bar.appendChild(el('div', 'hint', '🗑️ 拆除模式：点一栋建筑，再点一次确认拆除（返还 50% 造价）'));
      const ops = el('div', 'ops');
      const backB = el('button', 'btn', '🔨 返回建造') as HTMLButtonElement;
      backB.onclick = () => { this.mode = 'build'; this.pendingDemolish = null; this.renderBar(); };
      const cancelB = el('button', 'btn ghost', '取消') as HTMLButtonElement;
      cancelB.onclick = () => this.exit();
      ops.append(backB, cancelB);
      bar.appendChild(ops);
      ui.appendChild(bar);
      this.bar = bar;
    }
  }

  exit() {
    this.active = false;
    this.clearGhost();
    this.bar?.remove();
    this.bar = null;
    this.selected = null;
    this.pendingDemolish = null;
    this.onExit();
  }

  private select(b: BuildableDef) {
    this.selected = b;
    this.clearGhost();
    const g = makeBuilding(b.type);
    if (!g) return;
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = (m.material as THREE.Material).clone();
        (m.material as THREE.MeshStandardMaterial).transparent = true;
        (m.material as THREE.MeshStandardMaterial).opacity = 0.55;
        m.castShadow = false;
      }
    });
    this.ghost = g;
    this.ghost.visible = false;
    this.scene.add(g);
    // 自动在玩家附近找空位放幽灵，点放置即可建造（也可再点地面微调）
    const spot = this.findAutoSpot();
    if (spot) {
      this.ghostPos = new THREE.Vector3(spot.x, 0, spot.z);
      this.ghost.position.copy(this.ghostPos);
      this.ghost.visible = true;
    }
  }

  private clearGhost() {
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    this.ghostPos = null;
  }

  private rotate() {
    this.rotY += Math.PI / 4;
    if (this.ghost) this.ghost.rotation.y = this.rotY;
  }

  /** 屏幕点击 → 地面 raycast（建造）或建筑 raycast（拆除） */
  handleTap(nx: number, ny: number) {
    if (!this.active || !this.camera) return;
    this.ray.setFromCamera(new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)), this.camera);
    if (this.mode === 'demolish') { this.handleDemolishTap(); return; }
    if (!this.selected || !this.ghost) return;
    const hit = this.ray.intersectObject(this.ground, false)[0];
    if (!hit) return;
    const p = hit.point;
    if (Math.hypot(p.x, p.z) > this.bounds - 3) { toast('超出村庄范围'); return; }
    this.ghostPos = new THREE.Vector3(p.x, 0, p.z);
    this.ghost.position.copy(this.ghostPos);
    this.ghost.rotation.y = this.rotY;
    this.ghost.visible = true;
  }

  private handleDemolishTap() {
    const groups = this.getPlaced().map((p) => p.group);
    const hit = this.ray.intersectObjects(groups, true)[0];
    if (!hit) { this.pendingDemolish = null; return; }
    let g: THREE.Object3D | null = hit.object;
    while (g && !groups.includes(g as THREE.Group)) g = g.parent;
    const placed = this.getPlaced().find((p) => p.group === g);
    if (!placed) return;
    const now = performance.now();
    if (this.pendingDemolish?.rec.id === placed.rec.id && now - this.pendingTimer < 6000) {
      // 确认拆除
      this.onDemolish(placed.rec);
      this.pendingDemolish = null;
    } else {
      this.pendingDemolish = placed;
      this.pendingTimer = now;
      const def = BUILDABLES.find((b) => b.type === placed.rec.type);
      const refund = Math.floor((def?.cost ?? 0) / 2);
      const warn = this.getDemolishWarn(placed.rec);
      toast(`再点一次确认拆除${BUILDABLE_NAMES[placed.rec.type] ?? ''}（返还 🪙${refund}）${warn ? `\n${warn}` : ''}`);
    }
  }

  private place() {
    if (!this.selected) return;
    if (!this.ghostPos || !this.ghost?.visible) { toast('先点一块空地'); return; }
    for (const c of this.colliders) {
      if (Math.hypot(this.ghostPos.x - c.x, this.ghostPos.z - c.z) < c.r + 1.6) {
        toast('这里太挤了，换个地方'); return;
      }
    }
    // 建筑数量上限（手机性能）
    if (this.getPlaced().length >= 30) { toast('村里建筑太多了（30 栋上限），先拆除一些吧'); return; }
    // 真实检查并扣除：材料 + 人工费
    const st = recipeStatus(this.save, this.selected);
    if (!st.ok) {
      if (st.missing.length) {
        const miss = st.missing.map((m) => {
          const d = resDef(m.id);
          return `${d?.icon ?? ''}${d?.name ?? m.id}×${m.need - m.have}`;
        }).join('、');
        toast(`材料不足，还缺：${miss}\n去野外采集、加工或去市场购买`);
      } else {
        toast(`人工费不够，还差 🪙${(this.selected.laborFee ?? 0) - this.save.coins}`);
      }
      return;
    }
    for (const r of this.selected.recipe ?? []) {
      this.save.inventory[r.id] = (this.save.inventory[r.id] ?? 0) - r.n;
    }
    this.save.coins -= this.selected.laborFee ?? 0;
    const rec: BuildingRec = {
      id: newId('b'),
      type: this.selected.type,
      x: Math.round(this.ghostPos.x * 10) / 10,
      z: Math.round(this.ghostPos.z * 10) / 10,
      rot: this.rotY,
    };
    const g = makeBuilding(rec.type)!;
    g.position.set(rec.x, 0, rec.z);
    g.rotation.y = rec.rot;
    this.scene.add(g);
    this.onPlaced(rec, g);
    toast(`建好了${BUILDABLE_NAMES[rec.type]}！${recipeShort(this.selected)}`);
    // 放置成功后退出建造模式，让玩家看到成果（含落成动画）
    this.exit();
  }
}
