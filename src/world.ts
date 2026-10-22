// WORLD OS Alpha 0.1 · 程序化新手村场景
import * as THREE from 'three';
import type { Collider } from './player';

export interface WoodSpot {
  group: THREE.Group;
  active: boolean;
  timer: number;
  pos: THREE.Vector3;
}

/** 资源采集点（木/石/黏土/纤维），WoodSpot 保留兼容 */
export interface ResNode {
  id: string;
  kind: 'wood' | 'stone' | 'clay' | 'fiber';
  group: THREE.Group;
  active: boolean;
  timer: number;
  pos: THREE.Vector3;
}

/** 环境摆动件（树冠/草丛，低成本动画） */
export interface SwayItem { obj: THREE.Object3D; phase: number; amp: number }

export interface WorldRefs {
  colliders: Collider[];
  bounds: number;
  npcSpots: Record<string, THREE.Vector3>;
  woodSpots: WoodSpot[];
  resNodes: ResNode[];
  ground: THREE.Mesh;
  clouds: THREE.Group[];
  swayers: SwayItem[];
}

/** 世界环境动画：树冠摆动（game 循环调用） */
export function updateSwayers(refs: WorldRefs, t: number) {
  for (const s of refs.swayers) {
    s.obj.rotation.z = Math.sin(t * 1.3 + s.phase) * s.amp;
    s.obj.rotation.x = Math.cos(t * 0.9 + s.phase) * s.amp * 0.6;
  }
}

// 确定性随机，保证每次打开村庄布局一致
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mat(color: number, opts: Partial<{ roughness: number; emissive: number; ei: number; flat: boolean; map: THREE.Texture; metalness: number }> = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: opts.roughness ?? 0.85,
    emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.ei ?? 1,
    flatShading: opts.flat ?? false,
    map: opts.map, metalness: opts.metalness ?? 0,
  });
}

/* ============ Visual 1.0：程序化纹理（canvas 生成，零外部资源） ============ */
const _texCache = new Map<string, THREE.CanvasTexture>();
function procTex(kind: 'wood' | 'stone' | 'brick' | 'thatch' | 'grass' | 'bark' | 'dirt', base: string, line: string): THREE.CanvasTexture {
  const key = kind + base;
  const hit = _texCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = base; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = line; x.lineWidth = 2;
  // 确定性伪随机（避免每次纹理不同）
  let s = kind.length * 7919 + base.length;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  if (kind === 'wood') {
    for (let i = 0; i < 9; i++) { // 竖向木纹
      const px = 8 + i * 13 + rnd() * 6;
      x.beginPath(); x.moveTo(px, 0);
      x.bezierCurveTo(px + rnd() * 8 - 4, 42, px + rnd() * 8 - 4, 86, px + rnd() * 6 - 3, 128);
      x.stroke();
    }
  } else if (kind === 'stone') {
    for (let r = 0; r < 4; r++) for (let col = 0; col < 3; col++) { // 不规则石块
      const off = (r % 2) * 21;
      x.strokeRect(col * 43 + off - 21 + rnd() * 6, r * 32 + rnd() * 4, 40, 28);
    }
  } else if (kind === 'brick') {
    for (let r = 0; r < 8; r++) for (let col = 0; col < 4; col++) { // 砖缝
      const off = (r % 2) * 16;
      x.strokeRect(col * 32 + off - 16, r * 16, 30, 14);
    }
  } else if (kind === 'grass') {
    // 草地：深浅不一的绿色斑块 + 草叶点
    for (let i = 0; i < 500; i++) {
      const g = 120 + rnd() * 60;
      x.fillStyle = `rgb(${60 + rnd() * 30},${g},${50 + rnd() * 25})`;
      x.globalAlpha = 0.5;
      const px = rnd() * 128, py = rnd() * 128, r = 2 + rnd() * 6;
      x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
    }
    x.globalAlpha = 0.6;
    x.strokeStyle = line; x.lineWidth = 1;
    for (let i = 0; i < 300; i++) { // 草叶
      const px = rnd() * 128, py = rnd() * 128;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + rnd() * 4 - 2, py - 3 - rnd() * 4); x.stroke();
    }
    x.globalAlpha = 1;
  } else if (kind === 'bark') {
    // 树皮：竖向深裂纹
    x.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      const px = 6 + i * 10 + rnd() * 5;
      x.beginPath(); x.moveTo(px, 0);
      x.bezierCurveTo(px + rnd() * 10 - 5, 42, px + rnd() * 10 - 5, 86, px + rnd() * 8 - 4, 128);
      x.stroke();
    }
    x.lineWidth = 1;
    for (let i = 0; i < 40; i++) { // 横向小裂纹
      const px = rnd() * 128, py = rnd() * 128;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + 6 + rnd() * 8, py + rnd() * 4 - 2); x.stroke();
    }
  } else if (kind === 'dirt') {
    // 泥土路：棕色斑块 + 小石子
    for (let i = 0; i < 300; i++) {
      x.fillStyle = `rgb(${120 + rnd() * 40},${90 + rnd() * 30},${60 + rnd() * 20})`;
      x.globalAlpha = 0.4;
      const px = rnd() * 128, py = rnd() * 128, r = 1 + rnd() * 4;
      x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
    }
    x.globalAlpha = 1;
  } else { // thatch：斜向茅草
    x.lineWidth = 1.5;
    for (let i = 0; i < 40; i++) {
      const px = rnd() * 128, py = rnd() * 128;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + rnd() * 10 - 5, py + 14 + rnd() * 8); x.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  _texCache.set(key, t);
  return t;
}
/* ============ Visual 1.0 纹理结束 ============ */

/** 民居：方身 + 四棱锥顶 */
export function makeHouse(bodyColor = 0xe8dcc0, roofColor = 0xa34a2a, w = 4, h = 2.6, d = 3.4): THREE.Group {
  const g = new THREE.Group();
  // 地基
  const found = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.35, d + 0.4), mat(0x8a8f98, { flat: true }));
  found.position.y = 0.17; found.receiveShadow = true; found.castShadow = true;
  // 墙体（Visual 1.0：木纹理）
  const isWood = bodyColor === 0xdcc9a0; // hut 木屋用木纹
  const bodyMat = isWood
    ? mat(0xffffff, { roughness: 0.9, map: procTex('wood', '#dcc9a0', '#b89a6a') })
    : mat(bodyColor);
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
  body.position.y = 0.35 + h / 2; body.castShadow = true; body.receiveShadow = true;
  // 屋檐 + 屋顶
  const eave = new THREE.Mesh(new THREE.BoxGeometry(w + 0.7, 0.18, d + 0.7), mat(0x6b4a2f));
  eave.position.y = 0.35 + h + 0.09; eave.castShadow = true;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 1.8, 4), mat(roofColor, { flat: true }));
  roof.position.y = 0.35 + h + 0.18 + 0.9; roof.rotation.y = Math.PI / 4; roof.castShadow = true;
  // 烟囱
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.5), mat(0x9a8f88, { flat: true }));
  chimney.position.set(w * 0.28, 0.35 + h + 1.1, -d * 0.2); chimney.castShadow = true;
  g.add(found, body, eave, roof, chimney);
  // 门 + 门框
  const doorF = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.12), mat(0x4a3220));
  doorF.position.set(0, 0.35 + 0.95, d / 2 + 0.03);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.7, 0.14), mat(0x6b4423, { roughness: 0.7 }));
  door.position.set(0, 0.35 + 0.85, d / 2 + 0.04);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), mat(0xd9b84a, { roughness: 0.4 }));
  knob.position.set(0.3, 1.2, d / 2 + 0.12);
  g.add(doorF, door, knob);
  // 窗户 + 窗框 + 百叶
  const winF = mat(0xf5f0e0);
  const winG = mat(0xffe9a8, { emissive: 0xffc861, ei: 0.8, roughness: 0.3 });
  for (const sx of [-1, 1]) {
    const fx = sx * w * 0.28;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 0.1), winF);
    frame.position.set(fx, 0.35 + 1.7, d / 2 + 0.03);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.75, 0.12), winG);
    glass.position.set(fx, 0.35 + 1.7, d / 2 + 0.04);
    const cross1 = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.08, 0.13), winF);
    cross1.position.set(fx, 0.35 + 1.7, d / 2 + 0.045);
    const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.13), winF);
    cross2.position.set(fx, 0.35 + 1.7, d / 2 + 0.045);
    // 百叶窗
    for (const ox of [-0.62, 0.62]) {
      const shut = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.95, 0.06), mat(roofColor));
      shut.position.set(fx + ox, 0.35 + 1.7, d / 2 + 0.03);
      g.add(shut);
    }
    g.add(frame, glass, cross1, cross2);
  }
  return g;
}

/** 村长屋·高品质版：瓦片屋顶、石砌地基、精细门窗框、装饰构件 */
export function makeHouseHQ(bodyColor = 0xe8dcc0, _roofColor = 0xa34a2a, w = 4.5, h = 2.8, d = 3.8): THREE.Group {
  const g = new THREE.Group();
  // 地基：石块纹理，两层
  const stoneMat = mat(0xffffff, { roughness: 0.95, map: procTex('stone', '#8a8f98', '#5a5f68') });
  const found = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.25, d + 0.5), stoneMat);
  found.position.y = 0.12; found.receiveShadow = true; found.castShadow = true;
  const found2 = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.2, d + 0.3), stoneMat);
  found2.position.y = 0.32; found2.receiveShadow = true; found2.castShadow = true;
  // 台阶
  for (let i = 0; i < 2; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.6 - i * 0.2, 0.15, 0.5), stoneMat);
    step.position.set(0, 0.1 + i * 0.15, d / 2 + 0.4 + i * 0.25);
    step.receiveShadow = true; step.castShadow = true;
    g.add(step);
  }
  // 墙体：砖纹或木纹
  const isWood = bodyColor === 0xdcc9a0;
  const bodyMat = isWood
    ? mat(0xffffff, { roughness: 0.9, map: procTex('wood', '#dcc9a0', '#b89a6a') })
    : mat(0xffffff, { roughness: 0.9, map: procTex('brick', '#e8dcc0', '#c9b896') });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
  body.position.y = 0.42 + h / 2; body.castShadow = true; body.receiveShadow = true;
  g.add(found, found2, body);
  // 屋檐：双层
  const eaveMat = mat(0xffffff, { roughness: 0.85, map: procTex('wood', '#6b4a2f', '#4a3018') });
  const eave1 = new THREE.Mesh(new THREE.BoxGeometry(w + 0.9, 0.14, d + 0.9), eaveMat);
  eave1.position.y = 0.42 + h + 0.07; eave1.castShadow = true;
  const eave2 = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.12, d + 0.6), eaveMat);
  eave2.position.y = 0.42 + h + 0.2; eave2.castShadow = true;
  g.add(eave1, eave2);
  // 屋顶：瓦片纹理（brick图案模拟瓦片）
  const roofMat = mat(0xffffff, { roughness: 0.85, map: procTex('brick', '#a34a2a', '#7a3520') });
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.8, 2.0, 4), roofMat);
  roof.position.y = 0.42 + h + 0.26 + 1.0; roof.rotation.y = Math.PI / 4; roof.castShadow = true;
  // 屋脊装饰
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, Math.max(w, d) * 0.9), mat(0x7a3520));
  ridge.position.y = 0.42 + h + 0.26 + 2.0; ridge.rotation.y = Math.PI / 4; ridge.castShadow = true;
  g.add(roof, ridge);
  // 烟囱：砖纹
  const chimney = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 1.4, 0.55),
    mat(0xffffff, { roughness: 0.9, map: procTex('brick', '#9a8f88', '#6a5f58') })
  );
  chimney.position.set(w * 0.28, 0.42 + h + 1.2, -d * 0.2); chimney.castShadow = true;
  const chimCap = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.15, 0.75), mat(0x6a5f58));
  chimCap.position.set(w * 0.28, 0.42 + h + 1.95, -d * 0.2); chimCap.castShadow = true;
  g.add(chimney, chimCap);
  // 门：双层门框+门楣
  const frameMat = mat(0xffffff, { roughness: 0.8, map: procTex('wood', '#4a3220', '#2a1a10') });
  const doorF = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.1, 0.14), frameMat);
  doorF.position.set(0, 0.42 + 1.05, d / 2 + 0.03);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.25, 0.2), frameMat);
  lintel.position.set(0, 0.42 + 2.2, d / 2 + 0.05); lintel.castShadow = true;
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 1.9, 0.16),
    mat(0xffffff, { roughness: 0.7, map: procTex('wood', '#6b4423', '#4a2a15') })
  );
  door.position.set(0, 0.42 + 0.95, d / 2 + 0.04);
  // 门环
  for (const sx of [-0.25, 0.25]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 6, 12), mat(0xd9b84a, { roughness: 0.3, metalness: 0.8 }));
    ring.position.set(sx, 1.35, d / 2 + 0.13);
    g.add(ring);
  }
  g.add(doorF, lintel, door);
  // 窗户：精细窗框+窗棂
  const winF = mat(0xf5f0e0);
  const winG = mat(0xffe9a8, { emissive: 0xffc861, ei: 0.8, roughness: 0.3 });
  for (const sx of [-1, 1]) {
    const fx = sx * w * 0.3;
    // 外框
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 0.12), frameMat);
    frame.position.set(fx, 0.42 + 1.8, d / 2 + 0.03); frame.castShadow = true;
    // 内框
    const inner = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.13), winF);
    inner.position.set(fx, 0.42 + 1.8, d / 2 + 0.035);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.78, 0.14), winG);
    glass.position.set(fx, 0.42 + 1.8, d / 2 + 0.04);
    // 窗棂：田字格
    const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.06, 0.145), winF);
    bar1.position.set(fx, 0.42 + 1.8, d / 2 + 0.045);
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.78, 0.145), winF);
    bar2.position.set(fx, 0.42 + 1.8, d / 2 + 0.045);
    // 窗台
    const sill = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.2), frameMat);
    sill.position.set(fx, 0.42 + 1.2, d / 2 + 0.06); sill.castShadow = true;
    g.add(frame, inner, glass, bar1, bar2, sill);
  }
  // 门口灯笼
  for (const sx of [-1, 1]) {
    const lantern = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 10, 8),
      mat(0xff6a3a, { emissive: 0xff4a1a, ei: 0.9, roughness: 0.6 })
    );
    lantern.scale.y = 1.2;
    lantern.position.set(sx * 1.0, 2.6, d / 2 + 0.25);
    const lCap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.08, 8), mat(0x2a1a10));
    lCap.position.set(sx * 1.0, 2.82, d / 2 + 0.25);
    const lString = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6), mat(0x2a1a10));
    lString.position.set(sx * 1.0, 3.0, d / 2 + 0.25);
    g.add(lantern, lCap, lString);
  }
  return g;
}

/** 果树（苹果树）：玩家可建造，保留 */
export function makeTree(withApples = false): THREE.Group {
  const g = new THREE.Group();
  // 树干：树皮纹理 + 微微弯曲
  const barkMat = mat(0xffffff, { roughness: 0.95, map: procTex('bark', '#7a5230', '#4a3018') });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.34, 1.9, 9), barkMat);
  trunk.position.y = 0.95; trunk.castShadow = true;
  trunk.rotation.z = (Math.random() - 0.5) * 0.08;
  // 树枝
  for (let i = 0; i < 3; i++) {
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.9, 6), barkMat);
    const ang = (i / 3) * Math.PI * 2 + 0.5;
    br.position.set(Math.cos(ang) * 0.3, 1.9 + i * 0.25, Math.sin(ang) * 0.3);
    br.rotation.z = Math.cos(ang) * 0.7;
    br.rotation.x = -Math.sin(ang) * 0.7;
    br.castShadow = true;
    g.add(br);
  }
  // 树冠：多层不规则球体，颜色深浅不一，更自然
  const greens = [0x3d7a44, 0x4c9153, 0x5da75f, 0x35703c];
  const blobs: [number, number, number, number, number][] = [
    [0, 2.6, 0, 1.5, 0], [0.8, 2.2, 0.4, 1.0, 1], [-0.75, 2.3, -0.3, 1.05, 2],
    [0.15, 3.2, -0.15, 1.1, 1], [-0.3, 2.0, 0.7, 0.85, 3], [0.5, 2.8, -0.6, 0.9, 0],
  ];
  for (const [x, y, z, r, ci] of blobs) {
    const b = new THREE.Mesh(
      new THREE.IcosahedronGeometry(r, 1),
      mat(greens[ci % greens.length], { roughness: 0.9 })
    );
    b.position.set(x, y, z); b.castShadow = true;
    b.scale.set(1, 0.75 + Math.random() * 0.2, 1);
    b.rotation.y = Math.random() * Math.PI;
    g.add(b);
  }
  g.add(trunk);
  if (withApples) {
    const appleMat = mat(0xe04434, { roughness: 0.5 });
    for (let i = 0; i < 7; i++) {
      const a = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), appleMat);
      const ang = (i / 7) * Math.PI * 2 + 0.4;
      const rr = 0.9 + (i % 3) * 0.25;
      a.position.set(Math.cos(ang) * rr, 2.0 + (i % 3) * 0.45, Math.sin(ang) * rr);
      a.castShadow = true;
      g.add(a);
    }
  }
  return g;
}

/** 松树：三层锥形树冠 */
export function makePine(): THREE.Group {
  const g = new THREE.Group();
  const barkMat = mat(0xffffff, { roughness: 0.95, map: procTex('bark', '#6b4a2f', '#3d2817') });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 2.0, 8), barkMat);
  trunk.position.y = 1.0; trunk.castShadow = true;
  trunk.rotation.z = (Math.random() - 0.5) * 0.06;
  g.add(trunk);
  const greens = [0x2a5f33, 0x2f6b3a, 0x3a7d44, 0x4c9153];
  const tiers: [number, number, number][] = [[1.8, 2.2, 2.2], [1.4, 1.9, 3.4], [1.0, 1.6, 4.4], [0.6, 1.2, 5.2]];
  const canopy = new THREE.Group();
  tiers.forEach(([r, h, y], i) => {
    const c = new THREE.Mesh(
      new THREE.ConeGeometry(r * (0.92 + Math.random() * 0.16), h, 9),
      mat(greens[i % greens.length], { roughness: 0.9 })
    );
    c.position.set((Math.random() - 0.5) * 0.2, y, (Math.random() - 0.5) * 0.2);
    c.castShadow = true;
    canopy.add(c);
  });
  g.add(canopy);
  g.userData.canopy = canopy;
  return g;
}

/** 阔叶树：不规则球形树冠 */
export function makeBroadleaf(): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.36, 2.2, 7), mat(0x7a5230, { flat: true }));
  trunk.position.y = 1.1; trunk.castShadow = true;
  // 主干分叉
  const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.2, 6), mat(0x7a5230, { flat: true }));
  branch.position.set(0.4, 2.2, 0.2); branch.rotation.z = -0.5;
  g.add(trunk, branch);
  const canopy = new THREE.Group();
  const greens = [0x4c9153, 0x5da75f, 0x3e7d44];
  const blobs: [number, number, number, number, number][] = [
    [0, 3.4, 0, 1.6, 0], [1.1, 3.0, 0.4, 1.1, 1], [-1.0, 3.1, -0.3, 1.15, 2],
    [0.3, 4.1, -0.4, 1.0, 1], [-0.3, 2.7, 0.8, 0.9, 0],
  ];
  for (const [x, y, z, r, ci] of blobs) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat(greens[ci], { flat: true }));
    b.position.set(x, y, z); b.castShadow = true;
    canopy.add(b);
  }
  g.add(canopy);
  g.userData.canopy = canopy;
  return g;
}

/** 小树苗 */
export function makeSapling(): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.9, 6), mat(0x7a5230));
  trunk.position.y = 0.45; trunk.castShadow = true;
  const top = new THREE.Mesh(new THREE.IcosahedronGeometry(0.65, 1), mat(0x6bb56a, { flat: true }));
  top.position.y = 1.25; top.castShadow = true;
  g.add(trunk, top);
  g.userData.canopy = top;
  return g;
}

/** 灌木丛 */
export function makeBush(): THREE.Group {
  const g = new THREE.Group();
  const greens = [0x5da75f, 0x4c9153];
  const blobs: [number, number, number][] = [[0, 0.45, 0], [0.45, 0.35, 0.2], [-0.4, 0.38, -0.15]];
  blobs.forEach(([x, y, z], i) => {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 - i * 0.08, 1), mat(greens[i % 2], { flat: true }));
    b.position.set(x, y, z); b.scale.y = 0.75; b.castShadow = true;
    g.add(b);
  });
  return g;
}

export function makeLamp(): THREE.Group {
  const g = new THREE.Group();
  const metal = mat(0x3a3f47, { roughness: 0.5 });
  // 底座
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.35, 10), mat(0x6a6f78, { flat: true }));
  base.position.y = 0.17; base.castShadow = true;
  // 灯杆（带装饰环）
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 2.7, 8), metal);
  pole.position.y = 1.65; pole.castShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 8, 14), mat(0xd9b84a, { roughness: 0.4 }));
  ring.position.y = 2.2; ring.rotation.x = Math.PI / 2;
  // 灯臂 + 灯罩
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.08), metal);
  arm.position.set(0.3, 3.0, 0);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.4, 10), mat(0x2f333a, { roughness: 0.5 }));
  shade.position.set(0.6, 2.95, 0); shade.castShadow = true;
  // 灯泡（暖光）
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10),
    mat(0xffe9a8, { emissive: 0xffc861, ei: 2.2, roughness: 0.3 }));
  bulb.position.set(0.6, 2.78, 0);
  g.add(base, pole, ring, arm, shade, bulb);
  return g;
}

export function makeFence(): THREE.Group {
  const g = new THREE.Group();
  for (let i = -1; i <= 1; i++) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.1, 0.18), mat(0x8a6238));
    post.position.set(i * 1.1, 0.55, 0); post.castShadow = true;
    g.add(post);
  }
  for (const y of [0.45, 0.85]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.12), mat(0x8a6238));
    rail.position.y = y;
    g.add(rail);
  }
  return g;
}

export function makeFlower(): THREE.Group {
  const g = new THREE.Group();
  const bed = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.15, 0.35, 12), mat(0x6b4a2f));
  bed.position.y = 0.17; bed.receiveShadow = true;
  g.add(bed);
  const cols = [0xe86a8a, 0xffd166, 0xffffff, 0xb678e8];
  for (let i = 0; i < 7; i++) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), mat(cols[i % 4]));
    const ang = (i / 7) * Math.PI * 2;
    f.position.set(Math.cos(ang) * 0.55, 0.5, Math.sin(ang) * 0.55);
    g.add(f);
  }
  return g;
}

/** 小商店：柜台 + 条纹遮阳棚 + 招牌 */
export function makeShopStall(): THREE.Group {
  const g = new THREE.Group();
  // 柜台
  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 1.2), mat(0x8c5a2b));
  counter.position.y = 0.5; counter.castShadow = true; counter.receiveShadow = true;
  g.add(counter);
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.12, 1.5), mat(0x6b421e));
  top.position.y = 1.05; top.castShadow = true;
  g.add(top);
  // 货架上的货（小盒子点缀）
  const goodsCols = [0xe86a8a, 0xffd166, 0x7fc8a9, 0xb678e8];
  for (let i = 0; i < 4; i++) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), mat(goodsCols[i]));
    box.position.set(-0.9 + i * 0.6, 1.32, 0);
    box.castShadow = true;
    g.add(box);
  }
  // 棚柱
  for (const sx of [-1.3, 1.3]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.4, 8), mat(0x5b3a1e));
    pole.position.set(sx, 1.2, -0.4); pole.castShadow = true;
    g.add(pole);
  }
  // 条纹遮阳棚
  for (let i = 0; i < 6; i++) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.06, 2.2),
      mat(i % 2 === 0 ? 0xc0392b : 0xf5f0e6),
    );
    stripe.position.set(-1.25 + i * 0.5, 2.45, 0.2);
    stripe.rotation.x = -0.18;
    stripe.castShadow = true;
    g.add(stripe);
  }
  // 招牌
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.08), mat(0x3a2a18));
  sign.position.set(0, 2.0, 0.9);
  g.add(sign);
  return g;
}

/** 建造系统复用的建筑工厂 */
/** 草屋（T1 生存建筑）：土墙 + 草顶 */
/** 建筑通用门面：门框+门+暖光窗（frontZ = 正面 z 坐标） */
function addDoorWin(g: THREE.Group, frontZ: number, opts: { winY?: number; doorW?: number } = {}) {
  const winY = opts.winY ?? 1.5;
  const doorW = opts.doorW ?? 0.8;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.24, 1.75, 0.1), mat(0x4a3220));
  frame.position.set(0, 0.875, frontZ);
  const door = new THREE.Mesh(new THREE.BoxGeometry(doorW, 1.6, 0.12), mat(0x6b4423, { roughness: 0.7 }));
  door.position.set(0, 0.8, frontZ + 0.01);
  const winF = mat(0xf5f0e0);
  const winG = mat(0xffe9a8, { emissive: 0xffc861, ei: 0.9, roughness: 0.3 });
  g.add(frame, door);
  for (const sx of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.08), winF);
    f.position.set(sx * (doorW / 2 + 0.75), winY, frontZ);
    const gl = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.54, 0.1), winG);
    gl.position.set(sx * (doorW / 2 + 0.75), winY, frontZ + 0.01);
    g.add(f, gl);
  }
}

/** 草屋（T1 生存建筑）：简陋原始——歪斜木柱 + 厚茅草顶 + 泥土地基
 *  视觉语言：小、低、糙。体量最小，无精加工，体现"刚活下来" */
export function makeThatch(): THREE.Group {
  const g = new THREE.Group();
  const thatchTex = procTex('thatch', '#c9a24a', '#a8823a');
  // 泥土地基（不规则）
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.25, 2.3), mat(0x8a6f4d, { roughness: 1 }));
  base.position.y = 0.12; base.receiveShadow = true;
  g.add(base);
  // 歪斜木柱（4根，故意不对称）
  const postMat = mat(0x7a5c3a, { roughness: 1 });
  const posts: Array<[number, number, number]> = [[-1.1, -0.9, 0.06], [1.15, -0.95, -0.05], [-1.05, 0.95, -0.04], [1.1, 0.9, 0.07]];
  for (const [px, pz, tilt] of posts) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.7, 0.18), postMat);
    p.position.set(px, 0.25 + 0.85, pz);
    p.rotation.z = tilt; p.castShadow = true;
    g.add(p);
  }
  // 土坯墙（矮，只到一半，上面透风）
  const wall = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.9, 2.1),
    mat(0xa8895c, { roughness: 1, map: procTex('stone', '#a8895c', '#8a6f4a') }));
  wall.position.y = 0.25 + 0.45; wall.castShadow = true;
  g.add(wall);
  // 厚茅草顶：三层叠加，边缘参差
  const roofMat = mat(0xffffff, { roughness: 1, map: thatchTex });
  const layers: Array<[number, number, number]> = [[3.2, 0.9, 1.55], [2.6, 0.85, 2.15], [1.9, 0.8, 2.7]];
  for (const [r, h, y] of layers) {
    const roof = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), roofMat);
    roof.position.y = y; roof.rotation.y = Math.PI / 7;
    roof.castShadow = true;
    g.add(roof);
  }
  // 布帘门（无精加工门）
  const curtain = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.06), mat(0x8a6f5a, { roughness: 1 }));
  curtain.position.set(0, 0.25 + 0.75, 1.06);
  g.add(curtain);
  return g;
}

/** 石屋（T3 实用建筑）：坚固厚重——石砌墙 + 石腰线 + 厚重坡顶 + 石烟囱
 *  视觉语言：方、正、重。体量明显大于木屋，石材质感，一眼看出"结实" */
export function makeStoneHouse(): THREE.Group {
  const g = new THREE.Group();
  const stoneTex = procTex('stone', '#8a8f98', '#6a6f78');
  const W = 4.0, H = 2.8, D = 3.4;
  // 石砌地基（高出地面，防潮）
  const found = new THREE.Mesh(new THREE.BoxGeometry(W + 0.5, 0.5, D + 0.5),
    mat(0x6a6f78, { roughness: 1, map: stoneTex }));
  found.position.y = 0.25; found.receiveShadow = true; found.castShadow = true;
  g.add(found);
  // 石墙主体（程序化石纹理）
  const wallMat = mat(0xffffff, { roughness: 0.95, map: stoneTex });
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wallMat);
  body.position.y = 0.5 + H / 2; body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  // 石砌腰线（上下两道，强调厚重感）
  const trimMat = mat(0x5a5f68, { roughness: 1 });
  for (const ty of [0.75, 0.5 + H - 0.15]) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(W + 0.25, 0.22, D + 0.25), trimMat);
    trim.position.y = ty; trim.castShadow = true;
    g.add(trim);
  }
  // 厚重人字形屋顶（双坡，比木屋更厚实）
  const roofMat = mat(0x4a4e58, { roughness: 0.9, flat: true });
  const roofL = new THREE.Mesh(new THREE.BoxGeometry(W + 0.9, 0.28, D / 2 + 0.7), roofMat);
  roofL.position.set(0, 0.5 + H + 0.55, -D / 4); roofL.rotation.x = 0.5; roofL.castShadow = true;
  const roofR = new THREE.Mesh(new THREE.BoxGeometry(W + 0.9, 0.28, D / 2 + 0.7), roofMat);
  roofR.position.set(0, 0.5 + H + 0.55, D / 4); roofR.rotation.x = -0.5; roofR.castShadow = true;
  g.add(roofL, roofR);
  // 屋脊石
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(W + 0.9, 0.22, 0.4), trimMat);
  ridge.position.set(0, 0.5 + H + 1.05, 0); ridge.castShadow = true;
  g.add(ridge);
  // 石砌烟囱（粗壮）
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.6, 0.7),
    mat(0xffffff, { roughness: 1, map: stoneTex }));
  chimney.position.set(W * 0.3, 0.5 + H + 1.2, -D * 0.2); chimney.castShadow = true;
  g.add(chimney);
  // 石台阶（两级）
  for (let i = 0; i < 2; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.6 - i * 0.3, 0.18, 0.6), trimMat);
    step.position.set(0, 0.09 + i * 0.18, D / 2 + 0.5 - i * 0.25);
    step.receiveShadow = true;
    g.add(step);
  }
  // 石框门窗
  addDoorWin(g, D / 2, { winY: 0.5 + 1.6, doorW: 1.0 });
  return g;
}

/** 砖房（T4 现代住宅）：气派精致——红砖墙 + 白色装饰线 + 多层屋顶 + 门廊 + 院落
 *  视觉语言：大、精、贵。体量最大，细节最多，一眼看出"财富" */
export function makeBrickHouse(): THREE.Group {
  const g = new THREE.Group();
  const brickTex = procTex('brick', '#a0522d', '#7a3a20');
  const W = 4.6, H = 3.2, D = 4.0;
  const brickMat = mat(0xffffff, { roughness: 0.85, map: brickTex });
  const trimMat = mat(0xf0e8d8, { roughness: 0.7 }); // 米白装饰线
  // 地基
  const found = new THREE.Mesh(new THREE.BoxGeometry(W + 0.5, 0.45, D + 0.5), mat(0x8a8f98, { roughness: 1 }));
  found.position.y = 0.22; found.receiveShadow = true; found.castShadow = true;
  g.add(found);
  // 红砖主体
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), brickMat);
  body.position.y = 0.45 + H / 2; body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  // 装饰腰线（三道：底部/中部/顶部，白色）
  for (const ty of [0.7, 0.45 + H * 0.55, 0.45 + H - 0.12]) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, 0.18, D + 0.2), trimMat);
    trim.position.y = ty; trim.castShadow = true;
    g.add(trim);
  }
  // 转角砖柱（四角，白色，强调精致）
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as Array<[number, number]>) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.35, H, 0.35), trimMat);
    col.position.set(sx * (W / 2 - 0.1), 0.45 + H / 2, sz * (D / 2 - 0.1));
    col.castShadow = true;
    g.add(col);
  }
  // 多层屋顶：主坡顶 + 屋檐
  const roofMat = mat(0x3a3e48, { roughness: 0.8, flat: true });
  const roofL = new THREE.Mesh(new THREE.BoxGeometry(W + 1.0, 0.3, D / 2 + 0.8), roofMat);
  roofL.position.set(0, 0.45 + H + 0.6, -D / 4); roofL.rotation.x = 0.48; roofL.castShadow = true;
  const roofR = new THREE.Mesh(new THREE.BoxGeometry(W + 1.0, 0.3, D / 2 + 0.8), roofMat);
  roofR.position.set(0, 0.45 + H + 0.6, D / 4); roofR.rotation.x = -0.48; roofR.castShadow = true;
  g.add(roofL, roofR);
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(W + 1.0, 0.24, 0.45), mat(0x2a2e38, { flat: true }));
  ridge.position.set(0, 0.45 + H + 1.15, 0); ridge.castShadow = true;
  g.add(ridge);
  // 砖砌烟囱（带帽）
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.6), brickMat);
  chimney.position.set(W * 0.3, 0.45 + H + 1.3, -D * 0.2); chimney.castShadow = true;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.18, 0.85), trimMat);
  cap.position.set(W * 0.3, 0.45 + H + 2.25, -D * 0.2); cap.castShadow = true;
  g.add(chimney, cap);
  // 门廊：柱子 + 雨棚 + 台阶
  const porchZ = D / 2 + 0.9;
  for (const sx of [-1, 1]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.2, 0.28), trimMat);
    col.position.set(sx * 1.1, 0.45 + 1.1, porchZ); col.castShadow = true;
    g.add(col);
  }
  const awning = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.16, 1.4), roofMat);
  awning.position.set(0, 0.45 + 2.3, porchZ - 0.2); awning.castShadow = true;
  g.add(awning);
  for (let i = 0; i < 3; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.4 - i * 0.25, 0.16, 0.55), mat(0x9a8f80, { roughness: 1 }));
    step.position.set(0, 0.08 + i * 0.16, porchZ + 0.5 - i * 0.22);
    step.receiveShadow = true;
    g.add(step);
  }
  // 精致门窗（带白色窗框）
  addDoorWin(g, D / 2, { winY: 0.45 + 1.8, doorW: 1.1 });
  // 庭院：矮石墙 + 花坛 + 石板小径（最高级专属）
  const yardMat = mat(0xffffff, { roughness: 0.95, map: procTex('stone', '#9a9aa2', '#6a6a72') });
  // 矮墙（三面，留正面入口）
  const wallH = 0.6, wallT = 0.25, yardW = W + 3, yardD = D + 3;
  for (const [ww, dd, px, pz] of [
    [yardW, wallT, 0, -yardD / 2], [wallT, yardD, -yardW / 2, 0], [wallT, yardD, yardW / 2, 0],
  ] as const) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(ww, wallH, dd), yardMat);
    wall.position.set(px, wallH / 2, pz);
    wall.castShadow = true; wall.receiveShadow = true;
    g.add(wall);
  }
  // 花坛（两侧）
  for (const sx of [-1, 1]) {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 0.8), yardMat);
    bed.position.set(sx * (W / 2 + 1), 0.17, D / 2 + 0.8);
    bed.castShadow = true; bed.receiveShadow = true;
    g.add(bed);
    // 花
    for (let i = 0; i < 4; i++) {
      const flower = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 6, 6),
        mat([0xff6a8a, 0xffd166, 0xff8a5a, 0xc88aff][i % 4], { roughness: 0.7 })
      );
      flower.position.set(sx * (W / 2 + 1) + (Math.random() - 0.5) * 0.9, 0.45, D / 2 + 0.8 + (Math.random() - 0.5) * 0.5);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.25, 5), mat(0x3d7a44));
      stem.position.set(flower.position.x, 0.32, flower.position.z);
      g.add(flower, stem);
    }
  }
  return g;
}

/** 工坊（T2）：大屋 + 烟囱，加工免手续费 */
export function makeWorkshop(): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 2.8), mat(0x9a6b4f));
  base.position.y = 1.1; base.castShadow = true;
  // 木梁装饰
  for (const sx of [-1.2, 1.2]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.2, 0.1), mat(0x5b3a22));
    beam.position.set(sx, 1.1, 1.42);
    g.add(beam);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.8, 1.2, 4), mat(0x6b4a35, { flat: true }));
  roof.position.y = 2.8; roof.rotation.y = Math.PI / 4; roof.castShadow = true;
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 1.8, 8), mat(0x555a63, { flat: true }));
  chimney.position.set(1, 3.4, 0.6); chimney.castShadow = true;
  g.add(base, roof, chimney);
  addDoorWin(g, 1.4, { winY: 1.6, doorW: 1.0 });
  return g;
}

/** 仓库（T3）：大方体 + 大门 */
export function makeWarehouse(): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.6, 3.4), mat(0xa08a6a));
  base.position.y = 1.3; base.castShadow = true;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.35, 3.7), mat(0x6b5a45));
  roof.position.y = 2.75; roof.castShadow = true;
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2, 0.1), mat(0x4a3a28));
  door.position.set(0, 1, 1.72);
  g.add(base, roof, door);
  return g;
}

/** 大仓库（T3 升级）：双层大方体 + 坡顶 + 双开大门，明显大于普通仓库 */
export function makeBigWarehouse(): THREE.Group {
  const g = new THREE.Group();
  // 主体（比普通仓库大一圈）
  const base = new THREE.Mesh(new THREE.BoxGeometry(5.2, 3.2, 4.2), mat(0x9a7f5e, { flat: true }));
  base.position.y = 1.6; base.castShadow = true;
  // 深色腰线
  const trim = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.25, 4.3), mat(0x6b5a45, { flat: true }));
  trim.position.y = 0.5;
  // 坡屋顶
  const roof = new THREE.Mesh(new THREE.ConeGeometry(4.2, 1.5, 4), mat(0x5a4a38, { flat: true }));
  roof.position.y = 3.95; roof.rotation.y = Math.PI / 4; roof.castShadow = true;
  // 双开大门
  for (const sx of [-0.85, 0.85]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.4, 0.12), mat(0x3d2f22, { flat: true }));
    door.position.set(sx, 1.2, 2.12);
    g.add(door);
  }
  // 侧面小窗（暖光）
  for (const sz of [-1.2, 1.2]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 0.7),
      mat(0xffe9a8, { flat: true, emissive: 0x664422 }));
    win.position.set(2.62, 2.2, sz);
    g.add(win);
  }
  g.add(base, trim, roof);
  return g;
}

/** 高楼（T4）：高层 + 窗户条纹 */
export function makeTower(): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(3.6, 9, 3.6), mat(0xb8c4d4));
  base.position.y = 4.5; base.castShadow = true;
  for (let i = 0; i < 4; i++) {
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(3.7, 0.5, 3.7),
      mat(0xffe9a8, { emissive: 0xffd166, ei: 0.5 }),
    );
    win.position.y = 2 + i * 1.8;
    g.add(win);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.4, 3.9), mat(0x5a6a7a));
  roof.position.y = 9.2;
  g.add(base, roof);
  return g;
}

/** 石堆（石头采集点） */
export function makeStonePile(): THREE.Group {
  const g = new THREE.Group();
  const rockMat = mat(0x8a8f98, { emissive: 0x99aabb, ei: 0.45 });
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32 + (i % 2) * 0.14), rockMat);
    s.position.set((i - 1.5) * 0.42, 0.28, (i % 2) * 0.35 - 0.15);
    s.castShadow = true;
    g.add(s);
  }
  return g;
}

/** 黏土坑（黏土采集点） */
export function makeClayPit(): THREE.Group {
  const g = new THREE.Group();
  const mound = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    mat(0x9a6238, { emissive: 0xcc8855, ei: 0.4 }),
  );
  mound.scale.y = 0.55; mound.castShadow = true;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.18, 8, 16), mat(0x7a4a28));
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.1;
  g.add(mound, rim);
  return g;
}

/** 纤维草丛（植物纤维采集点） */
export function makeFiberTuft(): THREE.Group {
  const g = new THREE.Group();
  const bladeMat = mat(0x7fc86a, { emissive: 0x88dd77, ei: 0.45 });
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.9 + (i % 3) * 0.25, 5), bladeMat);
    const ang = (i / 7) * Math.PI * 2;
    b.position.set(Math.cos(ang) * 0.3, 0.45, Math.sin(ang) * 0.3);
    b.rotation.z = Math.cos(ang) * 0.25;
    b.rotation.x = Math.sin(ang) * 0.25;
    g.add(b);
  }
  return g;
}

export function makeBuilding(type: string): THREE.Group | null {  switch (type) {
    case 'hut': return makeHouse(0xdcc9a0, 0x8c4a2b, 3.2, 2.2, 2.8);
    case 'shop': return makeShopStall();
    case 'fence': return makeFence();
    case 'lamp': return makeLamp();
    case 'tree': return makeTree(true);
    case 'flower': return makeFlower();
    case 'thatch': return makeThatch();
    case 'stonehouse': return makeStoneHouse();
    case 'brickhouse': return makeBrickHouse();
    case 'workshop': return makeWorkshop();
    case 'warehouse': return makeWarehouse();
    case 'bigwarehouse': return makeBigWarehouse();
    case 'tower': return makeTower();
    default: return null;
  }
}

function makeWell(): THREE.Group {
  const g = new THREE.Group();
  // 井台：石块纹理，上下两层错缝
  const stoneMat = mat(0xffffff, { roughness: 0.95, map: procTex('stone', '#9a9aa2', '#6a6a72') });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 0.6, 12), stoneMat);
  base.position.y = 0.3; base.castShadow = true; base.receiveShadow = true;
  const base2 = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.2, 0.5, 12), stoneMat);
  base2.position.y = 0.8; base2.castShadow = true; base2.receiveShadow = true;
  // 井口木框
  const woodMat = mat(0xffffff, { roughness: 0.85, map: procTex('wood', '#7a5230', '#4a3018') });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.12, 8, 16), woodMat);
  rim.rotation.x = Math.PI / 2; rim.position.y = 1.08; rim.castShadow = true;
  // 井水（深色反光）
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(0.95, 16),
    new THREE.MeshStandardMaterial({ color: 0x1a3a4a, roughness: 0.1, metalness: 0.6 })
  );
  water.rotation.x = -Math.PI / 2; water.position.y = 0.7;
  g.add(base, base2, rim, water);
  // 木支架
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.4, 0.2), woodMat);
    post.position.set(sx * 1.1, 1.8, 0);
    post.castShadow = true;
    // 斜撑
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.12), woodMat);
    brace.position.set(sx * 0.85, 2.4, 0);
    brace.rotation.z = sx * 0.5;
    brace.castShadow = true;
    g.add(post, brace);
  }
  // 横梁
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.6, 8), woodMat);
  beam.rotation.z = Math.PI / 2; beam.position.y = 2.9; beam.castShadow = true;
  // 绳索
  const rope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 1.4, 6),
    mat(0xc9b98a, { roughness: 1 })
  );
  rope.position.y = 2.1; rope.castShadow = true;
  // 水桶
  const bucket = new THREE.Group();
  const bBody = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.3, 10), woodMat);
  bBody.castShadow = true;
  const bRim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 6, 12), mat(0x4a4a4a, { roughness: 0.5, metalness: 0.7 }));
  bRim.rotation.x = Math.PI / 2; bRim.position.y = 0.15;
  const bHandle = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 12, Math.PI), mat(0x4a4a4a, { roughness: 0.5, metalness: 0.7 }));
  bHandle.position.y = 0.15;
  bucket.add(bBody, bRim, bHandle);
  bucket.position.y = 1.25;
  g.add(beam, rope, bucket);
  // 小屋顶（瓦片纹理）
  const roofMat = mat(0xffffff, { roughness: 0.9, map: procTex('thatch', '#a34a2a', '#7a3520') });
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.1, 4), roofMat);
  roof.position.y = 3.7; roof.rotation.y = Math.PI / 4; roof.castShadow = true;
  // 屋顶装饰：宝顶
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), mat(0xd9b84a, { roughness: 0.4, metalness: 0.6 }));
  finial.position.y = 4.35;
  g.add(roof, finial);
  return g;
}

function makeStall(): THREE.Group {
  const g = new THREE.Group();
  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 1.2), mat(0x8a6238));
  counter.position.y = 0.5; counter.castShadow = true;
  for (const [sx, sz] of [[-1.2, -0.5], [1.2, -0.5], [-1.2, 0.5], [1.2, 0.5]] as const) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.6, 0.14), mat(0x6b4a2f));
    post.position.set(sx, 1.3, sz);
    g.add(post);
  }
  const awn = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 2.0), mat(0xc0392b));
  awn.position.set(0, 2.7, 0); awn.rotation.x = 0.12; awn.castShadow = true;
  // 货架上的箱子
  for (let i = 0; i < 3; i++) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat(0xc9a86a));
    box.position.set(-0.8 + i * 0.8, 1.25, 0);
    g.add(box);
  }
  g.add(counter, awn);
  return g;
}

function makeCloud(): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(1.6 + Math.random(), 10, 8), m);
    s.position.set(i * 2.2 - 3, Math.random() * 0.8, Math.random() * 1.2);
    s.scale.y = 0.55;
    g.add(s);
  }
  return g;
}

export function makeWoodPile(): THREE.Group {
  const g = new THREE.Group();
  const glow = mat(0x8a6238, { emissive: 0xffb340, ei: 0.55 });
  for (let i = 0; i < 3; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.6, 8), glow);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = i * 0.5;
    log.position.y = 0.25 + i * 0.32;
    log.castShadow = true;
    g.add(log);
  }
  return g;
}

export function buildWorld(scene: THREE.Scene): WorldRefs {
  const rand = mulberry32(20261012);
  const colliders: Collider[] = [];
  const swayers: SwayItem[] = [];
  const addCollider = (x: number, z: number, r: number) => colliders.push({ x, z, r });

  // 天空 / 雾 / 灯光
  // 天空：纯色背景（着色器版待排查黑屏问题，先保证可玩）
  scene.background = new THREE.Color(0x87b5e0);
  scene.fog = new THREE.Fog(0xc8dcec, 60, 160);
  // 光照体系：暖阳（低角度金色）+ 天青环境光 + 冷色补光
  const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x7a8a5a, 0.75);
  const sun = new THREE.DirectionalLight(0xffdf9e, 2.2);
  sun.position.set(30, 32, 14); // 更低的角度，拉长阴影更有层次
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
  sun.shadow.camera.near = 5; sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0005; // 防阴影痤疮
  sun.shadow.normalBias = 0.02;
  // 柔和补光（阴影面不死黑，冷色调平衡暖阳）
  const fill = new THREE.DirectionalLight(0xa8c8ff, 0.3);
  fill.position.set(-25, 20, -30);
  scene.add(hemi, sun, fill);

  // 地面：草地纹理
  const grassTex = procTex('grass', '#77b25c', '#5a8f42');
  grassTex.repeat.set(24, 24);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(62, 48),
    new THREE.MeshStandardMaterial({ roughness: 1, map: grassTex })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // 广场石板
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(7, 24), mat(0xb8b0a0));
  plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.02; plaza.receiveShadow = true;
  scene.add(plaza);

  // 小路（广场→四周）：泥土纹理 + 边缘石子
  const dirtTex = procTex('dirt', '#cbb98f', '#a8906a');
  dirtTex.repeat.set(1, 8);
  const edgeStoneMat = mat(0xffffff, { roughness: 0.95, map: procTex('stone', '#9a9aa2', '#6a6a72') });
  for (let i = 0; i < 4; i++) {
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 26),
      new THREE.MeshStandardMaterial({ roughness: 1, map: dirtTex })
    );
    path.rotation.x = -Math.PI / 2;
    path.rotation.z = (i / 4) * Math.PI * 2;
    const ang = (i / 4) * Math.PI * 2;
    const px = Math.sin(ang) * 17;
    const pz = Math.cos(ang) * 17;
    path.position.set(px, 0.015, pz);
    path.receiveShadow = true;
    scene.add(path);
    // 边缘石子：沿路两侧不规则摆放
    for (let s = 0; s < 10; s++) {
      for (const side of [-1, 1]) {
        if (Math.random() < 0.3) continue; // 随机缺失，自然感
        const stone = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.12 + Math.random() * 0.1, 0),
          edgeStoneMat
        );
        const t = 6 + s * 2.2 + Math.random() * 0.8; // 沿路距离
        const offX = Math.sin(ang) * t + Math.cos(ang) * side * (1.7 + Math.random() * 0.3);
        const offZ = Math.cos(ang) * t - Math.sin(ang) * side * (1.7 + Math.random() * 0.3);
        stone.position.set(offX, 0.08, offZ);
        stone.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        stone.castShadow = true; stone.receiveShadow = true;
        scene.add(stone);
      }
    }
  }

  // 水井（广场中央）
  const well = makeWell();
  well.position.set(0, 0, 0);
  scene.add(well); addCollider(0, 0, 1.8);

  // 民居环绕
  const houseDefs: [number, number, number][] = [
    [16, 0.5, 0], [-15, 2.4, 1], [4, -17, 2], [-9, -14, 3], [14, -9, 4], [-4, 17, 5],
  ];
  const palette: [number, number][] = [
    [0xe8dcc0, 0xa34a2a], [0xdcc9a0, 0x7a5a3a], [0xf0e6d2, 0x8c4a2b],
    [0xe0d0b0, 0x5b7a8c], [0xeadfc8, 0x94402a], [0xd8c49a, 0x6a4a8c],
  ];
  houseDefs.forEach(([x, z], i) => {
    const [bc, rc] = palette[i % palette.length];
    // 第一栋（村长屋）：高品质版
    const h = i === 0 ? makeHouseHQ(bc, rc) : makeHouse(bc, rc);
    h.position.set(x, 0, z);
    h.rotation.y = Math.atan2(-x, -z);
    scene.add(h); addCollider(x, z, 3.2);
  });

  // 商店摊位（东侧）
  const stall = makeStall();
  stall.position.set(11, 0, 3); stall.rotation.y = -Math.PI / 2;
  scene.add(stall); addCollider(11, 3, 2.4);

  // 树木：松树/阔叶树/小树/灌木混合，高矮错落
  const treeMakers = [makePine, makePine, makeBroadleaf, makeBroadleaf, makeSapling, makeBush];
  for (let i = 0; i < 26; i++) {
    const ang = rand() * Math.PI * 2;
    const r = 24 + rand() * 28;
    const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
    if (Math.hypot(x - 11, z - 3) < 6) continue;
    const maker = treeMakers[Math.floor(rand() * treeMakers.length)];
    const t = maker();
    t.position.set(x, 0, z);
    t.rotation.y = rand() * Math.PI * 2;
    const s = 0.75 + rand() * 0.7;
    t.scale.setScalar(s);
    scene.add(t); addCollider(x, z, 0.7);
    if (t.userData.canopy) swayers.push({ obj: t.userData.canopy, phase: rand() * 10, amp: 0.03 });
  }

  // 路灯沿路
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + 0.26;
    const x = Math.sin(ang) * 10.5, z = Math.cos(ang) * 10.5;
    const l = makeLamp();
    l.position.set(x, 0, z);
    scene.add(l); addCollider(x, z, 0.4);
  }

  // 泥土路：中心广场 + 通往各 NPC 的小径（扁圆片拼接，有自然边缘）
  const dirtMat = mat(0xa8895c, { roughness: 1 });
  const dirtEdge = mat(0x8a6f45, { roughness: 1 });
  const addDirtDisc = (x: number, z: number, r: number) => {
    const edge = new THREE.Mesh(new THREE.CircleGeometry(r + 0.25, 18), dirtEdge);
    edge.rotation.x = -Math.PI / 2; edge.position.set(x, 0.015, z); edge.receiveShadow = true;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 18), dirtMat);
    disc.rotation.x = -Math.PI / 2; disc.position.set(x, 0.03, z); disc.receiveShadow = true;
    scene.add(edge, disc);
  };
  addDirtDisc(0, 0, 4.5); // 中心广场
  const roadTo = (tx: number, tz: number) => {
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // 轻微弯曲
      const x = tx * t + Math.sin(t * 3.1) * 1.0;
      const z = tz * t + Math.cos(t * 2.3) * 1.0;
      addDirtDisc(x, z, 1.25 - t * 0.25);
    }
  };
  roadTo(-8, -6); roadTo(9, -7); roadTo(-7, 8); roadTo(11, 3);

  // 环境装饰：草丛/石头/野花（无碰撞、无阴影，低成本）
  const grassMat = mat(0x5da75f, { flat: true });
  const stoneMat = mat(0x9a9fa8, { flat: true });
  const flowerCols = [0xe86a8a, 0xffd166, 0xffffff, 0xb678e8];
  for (let i = 0; i < 46; i++) {
    const ang = rand() * Math.PI * 2;
    const r = 8 + rand() * 44;
    const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
    if (Math.hypot(x, z) < 7) continue;
    const kind = rand();
    const dg = new THREE.Group();
    if (kind < 0.5) {
      // 草丛：3-5 片锥叶
      const n = 3 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const blade = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.5 + rand() * 0.3, 5), grassMat);
        const a = (k / n) * Math.PI * 2;
        blade.position.set(Math.cos(a) * 0.15, 0.25, Math.sin(a) * 0.15);
        blade.rotation.z = (rand() - 0.5) * 0.4;
        dg.add(blade);
      }
      swayers.push({ obj: dg, phase: rand() * 10, amp: 0.05 });
    } else if (kind < 0.8) {
      // 石头
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25 + rand() * 0.3, 0), stoneMat);
      st.position.y = 0.15; st.rotation.set(rand() * 3, rand() * 3, 0);
      dg.add(st);
    } else {
      // 野花
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 5), grassMat);
      stem.position.y = 0.2;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 7, 7), mat(flowerCols[Math.floor(rand() * 4)], { roughness: 0.6 }));
      head.position.y = 0.45;
      dg.add(stem, head);
    }
    dg.position.set(x, 0, z);
    const s = 0.7 + rand() * 0.7;
    dg.scale.setScalar(s);
    scene.add(dg);
  }

  // 围栏装饰
  for (let i = 0; i < 5; i++) {
    const f = makeFence();
    const ang = rand() * Math.PI * 2, r = 20 + rand() * 8;
    f.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
    f.rotation.y = rand() * Math.PI;
    scene.add(f);
  }

  // 云
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 5; i++) {
    const c = makeCloud();
    c.position.set((rand() - 0.5) * 120, 26 + rand() * 8, (rand() - 0.5) * 120);
    scene.add(c); clouds.push(c);
  }

  // 资源采集点：木 8 / 石 6 / 黏土 5 / 纤维 6（woodSpots 保留兼容旧逻辑）
  const woodSpots: WoodSpot[] = [];
  const resNodes: ResNode[] = [];
  const spawnNode = (g: THREE.Group, x: number, z: number) => {
    g.position.set(x, 0, z);
    scene.add(g);
  };
  const nodeKinds: { kind: ResNode['kind']; n: number; make: () => THREE.Group }[] = [
    { kind: 'wood', n: 8, make: makeWoodPile },
    { kind: 'stone', n: 6, make: makeStonePile },
    { kind: 'clay', n: 5, make: makeClayPit },
    { kind: 'fiber', n: 6, make: makeFiberTuft },
  ];
  let nodeSeq = 0;
  for (const nk of nodeKinds) {
    for (let i = 0; i < nk.n; i++) {
      const ang = (i / nk.n) * Math.PI * 2 + rand() * 0.5 + nodeSeq;
      const r = 24 + rand() * 18;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      const g = nk.make();
      spawnNode(g, x, z);
      const node: ResNode = {
        id: `node-${nodeSeq++}`, kind: nk.kind, group: g,
        active: true, timer: 0, pos: new THREE.Vector3(x, 0, z),
      };
      resNodes.push(node);
      if (nk.kind === 'wood') {
        woodSpots.push({ group: g, active: true, timer: 0, pos: node.pos });
      }
    }
  }

  const npcSpots: Record<string, THREE.Vector3> = {
    chief: new THREE.Vector3(3.2, 0, 2.2),
    merchant: new THREE.Vector3(11, 0, 5.6),
    craftsman: new THREE.Vector3(-11, 0, 9),
  };

  return { colliders, bounds: 55, npcSpots, woodSpots, resNodes, ground, clouds, swayers };
}

/** 资源点重生位置（木材重生保留兼容） */
export function respawnResNode(node: ResNode, rand: () => number = Math.random) {
  const ang = rand() * Math.PI * 2;
  const r = 24 + rand() * 18;
  node.pos.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
  node.group.position.copy(node.pos);
  node.group.visible = true;
  node.active = true;
}

/** 木材重生位置（兼容旧调用） */
export function respawnWoodSpot(spot: WoodSpot, rand: () => number = Math.random) {
  const ang = rand() * Math.PI * 2;
  const r = 26 + rand() * 18;
  spot.pos.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
  spot.group.position.copy(spot.pos);
  spot.group.visible = true;
  spot.active = true;
}
