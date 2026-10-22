// WORLD OS Alpha 0.6 · 真人角色工厂（.glb 加载 + AnimationMixer）
// MakeHuman 生成的写实人体模型，带骨骼走路动画

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

export interface HumanoidOpts {
  skin?: number;
  shirt?: number;
  pants?: number;
  shoes?: number;
  hair?: number;
  hat?: 'straw' | 'cap' | 'hood' | 'official' | 'none';
  hatColor?: number;
  gear?: 'pack' | 'stick' | 'hammer' | 'satchel' | 'apron' | 'none';
  scale?: number;
  female?: boolean;
  /** 衣服颜色覆盖（NPC 差异化） */
  tintShirt?: number;
  tintPants?: number;
}

export interface Humanoid {
  group: THREE.Group;
  lArm: THREE.Group;
  rArm: THREE.Group;
  lLeg: THREE.Group;
  rLeg: THREE.Group;
  head: THREE.Group;
  torso: THREE.Mesh;
  /** 行走/待机动画 */
  update: (dt: number, moving: boolean) => void;
}

// ---- 模型缓存（启动时预加载一次） ----
let _template: THREE.Group | null = null;
let _walkClip: THREE.AnimationClip | null = null;
let _loadPromise: Promise<void> | null = null;

export function preloadCharacter(): Promise<void> {
  if (_loadPromise) return _loadPromise;
  _loadPromise = new Promise((resolve) => {
    // 8秒超时：模型加载失败不阻塞游戏启动，用胶囊保底
    const timer = setTimeout(() => {
      console.warn('[char] player.glb 加载超时，使用占位胶囊');
      resolve();
    }, 8000);
    new GLTFLoader().load(
      'models/player.glb',
      (gltf) => {
        clearTimeout(timer);
        _template = gltf.scene;
        // 找走路动画
        _walkClip = gltf.animations.find((c) => c.name.toLowerCase().includes('walk')) ?? gltf.animations[0] ?? null;
        // 启用阴影
        _template.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true;
            o.receiveShadow = false;
          }
        });
        resolve();
      },
      undefined,
      () => resolve() // 加载失败也不阻塞
    );
  });
  return _loadPromise;
}

function M(color: number, roughness = 0.85): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

/** 占位胶囊：.glb 加载失败或克隆无 mesh 时的保底，保证人物永远可见 */
function addFallbackCapsule(group: THREE.Group): void {
  const fallback = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.3, 0.9, 4, 12),
    M(0x4f7cff, 0.8)
  );
  fallback.position.y = 0.9;
  fallback.castShadow = true;
  group.add(fallback);
}

// ---- 程序化帽子（戴在真人头上） ----
function makeHat(kind: string, color: number): THREE.Group | null {
  const g = new THREE.Group();
  if (kind === 'none') return null;
  if (kind === 'straw') {
    // 斗笠
    const brim = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.18, 12), M(color, 0.9));
    brim.position.y = 0.16;
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), M(color, 0.9));
    top.position.y = 0.24;
    g.add(brim, top);
  } else if (kind === 'official') {
    // 乌纱帽
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.22, 10), M(0x1a1a1a, 0.7));
    base.position.y = 0.18;
    const wing1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.08), M(0x1a1a1a, 0.7));
    wing1.position.set(0, 0.22, -0.2);
    wing1.rotation.x = 0.3;
    const wing2 = wing1.clone();
    wing2.position.z = 0.2;
    wing2.rotation.x = -0.3;
    g.add(base, wing1, wing2);
  } else if (kind === 'cap') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), M(color, 0.8));
    cap.position.y = 0.1;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 10), M(color, 0.8));
    brim.position.set(0, 0.12, 0.18);
    brim.scale.z = 0.6;
    g.add(cap, brim);
  } else if (kind === 'hood') {
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), M(color, 0.9));
    hood.position.y = 0.12;
    hood.scale.set(1, 1.1, 1);
    g.add(hood);
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return g;
}

/** 从 .glb 克隆真人角色 */
export function makeHumanoid(o: HumanoidOpts = {}): Humanoid {
  const group = new THREE.Group();
  const dummy = new THREE.Group(); // 占位 limb（接口兼容）
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), M(0xffffff));
  torso.visible = false;

  let mixer: THREE.AnimationMixer | null = null;
  let walkAction: THREE.AnimationAction | null = null;
  let headBone: THREE.Object3D | null = null;

  if (_template) {
    // SkinnedMesh 必须用 SkeletonUtils.clone，否则骨骼绑定会断
    const model = skeletonClone(_template);
    // 安全检查：克隆后必须有可见 mesh，否则用占位
    let hasMesh = false;
    model.traverse((c) => { if ((c as THREE.Mesh).isMesh) hasMesh = true; });
    if (!hasMesh) {
      addFallbackCapsule(group);
    } else {
      group.add(model);
    }
    // NPC 衣服变色
    if (o.tintShirt !== undefined || o.tintPants !== undefined) {
      model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const m = mesh.material as THREE.MeshStandardMaterial;
        if (!m || !m.color) return;
        // 蓝色衬衫 → tintShirt，深色裤子 → tintPants（按原色相近度判断）
        const c = m.color;
        const isBlue = c.b > c.r * 1.2 && c.b > 0.3;
        const isDark = c.r < 0.35 && c.g < 0.35 && c.b < 0.45;
        if (isBlue && o.tintShirt !== undefined) {
          mesh.material = m.clone();
          (mesh.material as THREE.MeshStandardMaterial).color.setHex(o.tintShirt);
        } else if (isDark && o.tintPants !== undefined) {
          mesh.material = m.clone();
          (mesh.material as THREE.MeshStandardMaterial).color.setHex(o.tintPants);
        }
      });
    }
    // 找头骨挂帽子
    model.traverse((child) => {
      if (child.name.toLowerCase().includes('head') && !headBone) headBone = child;
    });
    if (o.hat && o.hat !== 'none') {
      const hat = makeHat(o.hat, o.hatColor ?? 0xc9a86a);
      if (hat) {
        if (headBone) {
          hat.position.set(0, 0.12, 0);
          (headBone as THREE.Object3D).add(hat);
        } else {
          hat.position.y = 1.62;
          model.add(hat);
        }
      }
    }
    // 动画混合器
    mixer = new THREE.AnimationMixer(model);
    if (_walkClip) {
      walkAction = mixer.clipAction(_walkClip);
      walkAction.play();
      walkAction.paused = true; // 待机时暂停
    }
    // 模型缩放：MakeHuman 1.75m → 游戏比例
    const s = o.scale ?? 1;
    model.scale.setScalar(s);
  } else {
    // .glb 未加载成功：保底胶囊，绝不隐身
    addFallbackCapsule(group);
  }

  let moving = false;
  const update = (dt: number, isMoving: boolean) => {
    moving = isMoving;
    if (mixer && walkAction) {
      walkAction.paused = !moving;
      if (moving) mixer.update(dt);
    }
  };

  return { group, lArm: dummy, rArm: dummy, lLeg: dummy, rLeg: dummy, head: dummy, torso, update };
}
