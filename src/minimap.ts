// WORLD OS Alpha 0.3 · 小地图（玩家/NPC/木堆/建筑全显示）
import { el } from './ui';

export interface MapDot { x: number; z: number; label?: string }

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private size = 132;
  private range = 60; // 显示半径（米）

  constructor() {
    this.canvas = el('canvas', '') as HTMLCanvasElement;
    this.canvas.id = 'minimap';
    this.canvas.width = this.size * 2;
    this.canvas.height = this.size * 2;
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
    document.getElementById('ui')!.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  show() { this.canvas.style.display = 'block'; }
  hide() { this.canvas.style.display = 'none'; }

  draw(
    px: number, pz: number, yaw: number,
    npcs: MapDot[], nodes: { x: number; z: number; kind: string }[],
    buildings: { x: number; z: number; type: string }[],
  ) {
    const c = this.ctx, S = this.size * 2, R = this.size;
    const k = R / this.range; // 米 → 像素（2x）
    c.clearRect(0, 0, S, S);

    // 底盘
    c.beginPath();
    c.arc(R, R, R - 2, 0, Math.PI * 2);
    c.fillStyle = 'rgba(8,12,26,.72)';
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,.25)';
    c.lineWidth = 2;
    c.stroke();
    c.save();
    c.beginPath();
    c.arc(R, R, R - 2, 0, Math.PI * 2);
    c.clip();

    const dot = (x: number, z: number, color: string, r: number) => {
      const dx = (x - px) * k, dz = (z - pz) * k;
      if (dx * dx + dz * dz > (R - 6) * (R - 6)) return; // 出界不画
      c.beginPath();
      c.arc(R + dx, R + dz, r, 0, Math.PI * 2);
      c.fillStyle = color;
      c.fill();
    };

    // 资源点：木绿 / 石灰 / 黏土棕 / 纤维浅绿
    const NODE_COLORS: Record<string, string> = {
      wood: '#7fc8a9', stone: '#9aa2b1', clay: '#c98a5a', fiber: '#b8e986',
    };
    for (const w of nodes) dot(w.x, w.z, NODE_COLORS[w.kind] ?? '#7fc8a9', 4);
    // 建筑（灰），商店（橙）
    for (const b of buildings) {
      dot(b.x, b.z, b.type === 'shop' ? '#ff9f43' : '#9fb3d9', 5);
    }
    // NPC（金）
    for (const n of npcs) dot(n.x, n.z, '#ffd166', 6);
    // 玩家（白 + 朝向）
    c.beginPath();
    c.arc(R, R, 7, 0, Math.PI * 2);
    c.fillStyle = '#ffffff';
    c.fill();
    c.strokeStyle = '#0b1020';
    c.lineWidth = 2;
    c.stroke();
    const hx = R + Math.sin(yaw) * 14, hz = R + Math.cos(yaw) * 14;
    c.beginPath();
    c.moveTo(R, R);
    c.lineTo(hx, hz);
    c.strokeStyle = '#ffffff';
    c.lineWidth = 3;
    c.stroke();

    c.restore();
    // 北
    c.fillStyle = 'rgba(255,255,255,.7)';
    c.font = 'bold 16px sans-serif';
    c.textAlign = 'center';
    c.fillText('北', R, 20);
  }
}
