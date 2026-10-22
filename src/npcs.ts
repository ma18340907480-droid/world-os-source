// WORLD OS Alpha 0.5 · NPC（脚本化对话，非真 AI；低多边形卡通人体，各职业外观区分）
import * as THREE from 'three';
import { NPCS, type NPCDef } from './data';
import { makeHumanoid, type Humanoid, type HumanoidOpts } from './char';
import { showDialog, closeDialog, type ChoiceDef } from './ui';

function makeNameSprite(name: string, title: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const w = ctx.measureText(name).width;
  void w;
  ctx.beginPath();
  ctx.roundRect(28, 8, 200, 72, 14);
  ctx.fill();
  ctx.fillStyle = '#ffd166';
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(name, 128, 44);
  ctx.fillStyle = '#9fb3d9';
  ctx.font = '24px sans-serif';
  ctx.fillText(title, 128, 70);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(2.2, 0.83, 1);
  return sp;
}

export interface NPCHandle { def: NPCDef; group: THREE.Group; pos: THREE.Vector3; body: Humanoid }

/** 各 NPC 职业外观（真人模型：用 tint 换衣服颜色 + 程序化帽子区分） */
const NPC_LOOKS: Record<string, HumanoidOpts> = {
  chief: { hat: 'official', gear: 'stick', scale: 1.06, tintShirt: 0x8c2f2f, tintPants: 0x2a2a3a },
  merchant: { hat: 'cap', hatColor: 0x1f6f5b, gear: 'satchel', tintShirt: 0x2f7a5b, tintPants: 0x4a5b3a },
  craftsman: { hat: 'hood', hatColor: 0x8c4a2b, gear: 'hammer', tintShirt: 0x8c5a2b, tintPants: 0x5b4a3a },
  farmer: { hat: 'straw', hatColor: 0xc9a86a, tintShirt: 0x6b8c3a, tintPants: 0x5b4a35 },
  fisher: { hat: 'straw', hatColor: 0xb89a6a, tintShirt: 0x3a6b8c, tintPants: 0x3a4a5b },
};

export class NPCManager {
  npcs: NPCHandle[] = [];

  constructor(scene: THREE.Scene, spots: Record<string, THREE.Vector3>) {
    for (const def of NPCS) {
      const spot = spots[def.id];
      if (!spot) continue;
      const look = NPC_LOOKS[def.id] ?? {};
      const body = makeHumanoid({
        skin: def.skin, shirt: def.robe, ...look,
      });
      // 工匠加围裙
      if (def.id === 'craftsman' || def.id === 'merchant') {
        const apron = new THREE.Mesh(
          new THREE.BoxGeometry(0.36, 0.55, 0.03),
          new THREE.MeshStandardMaterial({ color: 0x7a5c3e, roughness: 0.95 }),
        );
        apron.position.set(0, 1.05, 0.16);
        body.group.add(apron);
      }
      const label = makeNameSprite(def.name, def.title);
      label.position.y = 2.55;
      body.group.add(label);
      body.group.position.copy(spot);
      scene.add(body.group);
      this.npcs.push({ def, group: body.group, pos: spot.clone(), body });
    }
  }

  update(dt: number) {
    for (const n of this.npcs) {
      n.body.update(dt, false);
      n.group.rotation.y += dt * 0.15;
    }
  }

  /** 小地图用：NPC 位置 */
  positions(): { x: number; z: number; name: string }[] {
    return this.npcs.map((n) => ({ x: n.pos.x, z: n.pos.z, name: n.def.name }));
  }

  nearest(p: THREE.Vector3, maxD = 3.6): NPCHandle | null {    let best: NPCHandle | null = null, bd = maxD;
    for (const n of this.npcs) {
      const d = Math.hypot(p.x - n.pos.x, p.z - n.pos.z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /** 打开对话，action 由 game 层处理 */
  talk(npc: NPCHandle, onAction: (action: string) => void, startNode?: string) {
    const def = npc.def;
    const show = (nodeId: string) => {
      if (nodeId === '__end') { closeDialog(); return; }
      const node = def.dialogue[nodeId];
      if (!node) { closeDialog(); return; }
      const choices: ChoiceDef[] = [];
      if (node.choices) {
        for (const c of node.choices) {
          choices.push({
            label: c.label,
            cb: () => {
              if (c.action) onAction(c.action);
              show(c.next);
            },
          });
        }
      } else if (node.next) {
        choices.push({ label: '继续', cb: () => show(node.next!) });
      } else {
        choices.push({ label: '离开', cb: () => closeDialog() });
      }
      showDialog(def.name, def.title, node.text, choices);
    };
    show(startNode ?? def.start);
  }
}
