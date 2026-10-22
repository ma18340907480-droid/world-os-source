// WORLD OS Alpha 0.5 · 玩家角色（低多边形卡通小人）+ 移动与碰撞
import * as THREE from 'three';
import { makeHumanoid, type Humanoid } from './char';

export interface Collider { x: number; z: number; r: number }

export class Player {
  group = new THREE.Group();
  vel = new THREE.Vector3();
  private body: Humanoid;
  private heading = 0;
  private colliders: Collider[];
  private bounds: number;

  constructor(scene: THREE.Scene, colliders: Collider[], bounds: number) {
    this.colliders = colliders;
    this.bounds = bounds;
    // 蓝色新手装：斗笠 + 背包，保持辨识度
    this.body = makeHumanoid({
      skin: 0xf2c89b, shirt: 0x4f7cff, pants: 0x3a4a6b, shoes: 0x5b3a1e,
      hair: 0x3a2a1a, hat: 'straw', hatColor: 0xc9a86a, gear: 'pack',
    });
    this.group.add(this.body.group);
    scene.add(this.group);
  }

  get pos(): THREE.Vector3 { return this.group.position; }

  setPosition(x: number, z: number) {
    this.group.position.set(x, 0, z);
  }

  update(dt: number, f: number, s: number, camYaw: number) {
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = -fz, rz = fx;
    let mx = fx * f + rx * s;
    let mz = fz * f + rz * s;
    const len = Math.hypot(mx, mz);
    const speed = 6;
    const moving = len > 0.01;
    if (moving) {
      if (len > 1) { mx /= len; mz /= len; }
      const nx = this.pos.x + mx * speed * dt;
      const nz = this.pos.z + mz * speed * dt;
      const resolved = this.resolve(nx, nz);
      this.group.position.x = resolved.x;
      this.group.position.z = resolved.z;
      // 朝向移动方向
      const targetH = Math.atan2(mx, mz);
      let d = targetH - this.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.heading += d * Math.min(1, dt * 12);
      this.group.rotation.y = this.heading;
    }
    this.body.update(dt, moving);
  }

  private resolve(x: number, z: number): { x: number; z: number } {
    // 世界边界
    const r = Math.hypot(x, z);
    if (r > this.bounds) { x = x / r * this.bounds; z = z / r * this.bounds; }
    // 碰撞体推出
    for (const c of this.colliders) {
      const dx = x - c.x, dz = z - c.z;
      const d = Math.hypot(dx, dz), min = c.r + 0.45;
      if (d < min && d > 0.001) {
        x = c.x + dx / d * min;
        z = c.z + dz / d * min;
      }
    }
    return { x, z };
  }
}
