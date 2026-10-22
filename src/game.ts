// WORLD OS Alpha 0.1 · 游戏主控
import * as THREE from 'three';
import { buildWorld, respawnResNode, makeBuilding, updateSwayers, type WorldRefs } from './world';
import { RESOURCES, PROCESS_RECIPES, PROCESS_BUILDING_TIER, resDef, resName, refPriceOf, type ProcessRecipe } from './resources';
import { Market } from './market';
import { Player } from './player';
import { Input } from './input';
import { NPCManager, type NPCHandle } from './npcs';
import { QuestManager } from './quests';
import { Shop } from './shop';
import { MyShopManager } from './mystore';
import { BuildMode, recipeStatus, recipeShort } from './build';
import { Gallery } from './gallery';
import { Minimap } from './minimap';
import { parseCommand, COMMAND_EXAMPLES } from './command';
import { loadSave, storeSave, clearSave, defaultSave, newId, flushSaves, simulateSaveFailureOnce, type SaveData, type BuildingRec, type MyShopRec } from './save';
import {
  el, toast, setCoins, openPanel, closePanel, closeDialog, showDialog,
} from './ui';
import { QUESTS, BUILDABLES, BUILDABLE_NAMES, levelForXp, LEVEL_XP, type BuildableDef } from './data';

type Screen = 'title' | 'select' | 'play';

/** 操作历史（撤销/恢复） */
type HistOp =
  | { kind: 'build'; rec: BuildingRec }
  | { kind: 'demolish'; rec: BuildingRec; coinRefund: number; matRefund: { id: string; n: number }[]; shop?: MyShopRec };

const BUILD_RADIUS: Record<string, number> = {
  hut: 2.6, shop: 2.2, fence: 1.2, lamp: 0.5, tree: 0.8, flower: 1.0,
  thatch: 2.2, stonehouse: 2.6, workshop: 2.8, warehouse: 3.4, tower: 3.0,
  brickhouse: 2.8, bigwarehouse: 4.2,
};

/** 仓库类建筑（容量累加，不与房屋重复计算） */
const WAREHOUSE_TYPES = ['warehouse', 'bigwarehouse'];

export class Game {
  private screen: Screen = 'title';
  private save: SaveData = defaultSave();
  private hasSave = false;
  /** 展示模式：?showroom，仅用于建筑视觉验收，不读写玩家存档 */
  private isShowroom = false;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private world: WorldRefs | null = null;
  private player: Player | null = null;
  private input: Input | null = null;
  private npcMgr: NPCManager | null = null;
  private quests!: QuestManager;
  private shop!: Shop;
  private myShops!: MyShopManager;
  private market!: Market;
  private build!: BuildMode;
  private gallery!: Gallery;
  private minimap: Minimap | null = null;
  /** 已放置建筑：buildingId → 3D group（支持删除/查找） */
  private placed = new Map<string, THREE.Group>();
  /** 升级中防连点 */
  private upgrading = new Set<string>();
  private undoStack: HistOp[] = [];
  private redoStack: HistOp[] = [];
  private mapTimer = 0;

  private camYaw = 0; private camPitch = 0.52; // 阶段3：默认俯角调高，人物占比更大
  private clock = new THREE.Clock();
  private elapsed = 0;
  private popAnims: { g: THREE.Group; t: number }[] = [];
  private saveTimer = 0;
  private shopTimer = 10; // 开局 8 秒后第一次顾客上门（演示节奏）
  private likeTimer = 20;
  private focusPos: THREE.Vector3 | null = null;
  private focusUntil = 0;
  private ctxBtn: HTMLElement | null = null;

  private app: HTMLElement;
  private ui: HTMLElement;

  constructor(app: HTMLElement, ui: HTMLElement) {
    this.app = app;
    this.ui = ui;
    // 页面关闭/切换时尽力把排队的存档写完
    window.addEventListener('pagehide', () => { void flushSaves(); });
  }

  async start() {
    // 预加载真人角色模型（.glb）
    const { preloadCharacter } = await import('./char');
    await preloadCharacter();
    // 展示模式：?showroom 并排展示四级建筑（视觉验收用，不碰玩家存档）
    this.isShowroom = new URLSearchParams(location.search).has('showroom');
    if (this.isShowroom) {
      this.save = defaultSave(); // 纯内存存档，不读不写 localforage
      this.hasSave = false;
    } else {
      this.save = (await loadSave()) ?? defaultSave();
      this.hasSave = !!(await loadSave());
    }
    // 体验模式：URL 加 ?cheat 拉满资源（用户要求体验流程用）
    // 只在无存档时生效，避免刷新覆盖已有进度
    if (!this.hasSave && new URLSearchParams(location.search).has('cheat')) {
      this.save.coins = 999999;
      this.save.totalEarned = 999999;
      for (const r of ['wood', 'stone', 'clay', 'fiber', 'plank', 'brick']) {
        this.save.inventory[r] = 999;
      }
      for (const q of ['q1', 'q2', 'q3', 'q4', 'q5']) {
        this.save.quests[q] = 'done';
      }
      this.save.level = 5;
      setTimeout(() => toast('🎮 体验模式：资源已拉满，任务全开'), 1500);
      this.queueSave();
    }
    // 测试句柄（文档化：自动化测试用，玩家无感知）
    (window as unknown as { __worldos: unknown }).__worldos = {
      save: () => this.save,
      teleport: (x: number, z: number) => this.player?.setPosition(x, z),
      addItem: (id: string, n: number) => {
        this.save.inventory[id] = (this.save.inventory[id] ?? 0) + n;
        this.queueSave();
      },
      addCoins: (n: number) => this.addCoins(n),
      shopTick: () => this.myShops?.tick(),
      likeTick: () => this.gallery?.simulateLike(),
      enterPlay: () => this.enterPlay(),
      playerPos: () => this.player ? { x: this.player.pos.x, z: this.player.pos.z } : null,
      myShops: () => this.save.myShops,
      works: () => this.save.works,
      /** 测试用：建筑世界坐标 → 屏幕坐标 */
      buildingScreenPos: (id: string) => {
        const g = this.placed.get(id);
        if (!g || !this.camera) return null;
        const v = g.position.clone(); v.y = 1.2;
        v.project(this.camera);
        return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
      },
      /** 测试用：直接触发建造点选 */
      buildTap: (nx: number, ny: number) => this.build.handleTap(nx, ny),
      /** 测试用：直接触发世界点选（建筑详情） */
      worldTap: (nx: number, ny: number) => this.handleWorldTap(nx, ny),
      /** 测试用：Input 内部状态 */
      inputState: () => {
        const inp = this.input as unknown as { joyId: number | null; lookId: number | null; onTap: unknown } | null;
        return inp ? { joyId: inp.joyId, lookId: inp.lookId, hasOnTap: !!inp.onTap } : null;
      },
      /** 测试用：等待存档写完 */
      flushSave: () => flushSaves(),
      // 故障注入仅限测试环境（file:// 本地测试），生产环境（https://）不暴露
      ...(location.protocol === 'file:' ? {
        /** 测试用：模拟下一次严格保存失败 */
        simulateSaveFailure: () => simulateSaveFailureOnce(),
      } : {}),
      woodSpots: () => this.world?.resNodes.filter((w) => w.kind === 'wood').map((w) => ({ x: w.pos.x, z: w.pos.z, active: w.active })) ?? [],
      /** 测试用：资源点位置 */
      resNodes: () => this.world?.resNodes.map((w) => ({ kind: w.kind, x: w.pos.x, z: w.pos.z, active: w.active })) ?? [],
      /** 测试用：执行中文指令 */
      cmd: (text: string) => this.executeCommand(text),
      /** 测试用：撤销/恢复 */
      undo: () => this.undo(),
      redo: () => this.redo(),
      /** 测试用：经济（加工/市场/结算） */
      econ: {
        process: (id: string) => this.doProcess(id),
        buy: (id: string, n: number) => this.market.buy(id, n),
        sell: (id: string, n: number) => this.market.sell(id, n),
        buyPrice: (id: string) => this.market.buyPrice(id),
        sellPrice: (id: string) => this.market.sellPrice(id),
        settle: () => this.settleDaily(),
        valuation: (buildingId: string) => {
          const w = this.save.works.find((x) => x.buildingId === buildingId && !x.simulated);
          const b = this.save.buildings.find((x) => x.id === buildingId);
          return w && b ? this.valuationOf(w, b.x, b.z) : 0;
        },
      },
      buildState: () => {
        const b = this.build as unknown as { active: boolean; mode: string; ghost: unknown; selected: unknown };
        return { active: b.active, mode: b.mode, hasGhost: !!b.ghost, hasSelected: !!b.selected };
      },
    };
    // 展示模式直接进入游戏并摆好四栋建筑
    if (this.isShowroom) { this.enterPlay(); this.setupShowroom(); return; }
    this.showTitle();
  }

  /** 展示模式：在出生点附近并排摆放四级建筑（真实 makeBuilding 模型） */
  private setupShowroom() {
    if (!this.scene || !this.world) return;
    const types = ['thatch', 'hut', 'stonehouse', 'brickhouse'];
    const spacing = 9; // 间距，保证不穿插
    const startX = -spacing * 1.5;
    types.forEach((t, i) => {
      const g = makeBuilding(t);
      if (!g) return;
      g.position.set(startX + i * spacing, 0, 8);
      g.rotation.y = 0; // 统一朝向（门朝南）
      this.scene!.add(g);
      this.world!.colliders.push({ x: g.position.x, z: g.position.z, r: 3 });
    });
    // 把玩家传送到展示区前方
    this.player?.setPosition(0, 16);
    setTimeout(() => toast('🏠 展示模式：四级建筑并排展示（T1→T4 从左到右）'), 800);
  }

  // ---------------- 标题 / 选世界 ----------------
  private clearUI() {
    this.ui.innerHTML = '';
    closeDialog(); closePanel();
  }

  private showTitle() {
    this.screen = 'title';
    this.clearUI();
    const s = el('div', 'screen');
    s.innerHTML = `
      <div class="game-title">WORLD OS</div>
      <div class="game-sub">新 手 村 · 开 放 世 界</div>
      <div class="ver-tag">Alpha 0.4 内测版</div>`;
    const menu = el('div', 'menu');
    const start = el('button', 'btn', this.hasSave ? '🎮 继续上次的村庄' : '🎮 开始游戏') as HTMLButtonElement;
    start.onclick = () => this.showSelect();
    menu.appendChild(start);
    if (this.hasSave) {
      const fresh = el('button', 'btn ghost', '🆕 重新开始') as HTMLButtonElement;
      fresh.onclick = () => {
        showDialog('系统', '', '确定要清除本地存档、重新开始吗？', [
          { label: '确定清除', cb: async () => { await clearSave(); this.save = defaultSave(); this.hasSave = false; closeDialog(); this.showTitle(); } },
          { label: '取消', cb: () => closeDialog() },
        ]);
      };
      menu.appendChild(fresh);
    }
    s.appendChild(menu);
    s.appendChild(el('div', 'tip', '左手摇杆走路 · 右手滑动转视角<br>靠近村民点「对话」· 发光木堆点「收集」'));
    this.ui.appendChild(s);
  }

  private showSelect() {
    this.screen = 'select';
    this.clearUI();
    const s = el('div', 'screen');
    s.innerHTML = `<div class="game-title" style="font-size:32px">选择世界</div><div style="height:18px"></div>`;

    const my = el('div', 'world-card');
    const doneCount = QUESTS.filter((q) => this.save.quests[q.id] === 'done').length;
    my.innerHTML = `<h3>🏡 我的世界</h3>
      <p>你的私人村庄，存档保存在本机。<br>建造、任务、商店全部可玩。</p>
      <div class="meta">建筑 ${this.save.buildings.length} · 任务 ${doneCount}/${QUESTS.length} · 金币 🪙${this.save.coins}</div>`;
    const goBtn = el('button', 'btn', this.hasSave ? '进入我的世界' : '创建我的世界') as HTMLButtonElement;
    goBtn.onclick = () => {
      if (this.hasSave) { this.enterPlay(); return; }
      this.askPlayerName();
    };
    my.appendChild(goBtn);

    const main = el('div', 'world-card');
    main.innerHTML = `<h3>🌐 共享主世界 <span class="badge-sim">模拟数据·尚未真正实现</span></h3>
      <p>未来的多人在线世界：和其他玩家交易、参观作品、经营商店。</p>
      <div class="meta">在线玩家 1,024 · 今日交易 3,412 笔（以上为示例数字，非真实数据）</div>`;
    const mainBtn = el('button', 'btn', '进入主世界') as HTMLButtonElement;
    mainBtn.disabled = true;
    mainBtn.onclick = () => toast('主世界还在开发中，敬请期待');
    main.appendChild(mainBtn);

    const back = el('button', 'btn ghost', '← 返回') as HTMLButtonElement;
    back.style.maxWidth = '340px';
    back.onclick = () => this.showTitle();

    s.append(my, main, back);
    this.ui.appendChild(s);
  }

  /** 首次创建世界：给玩家取名 */
  private askPlayerName() {
    const body = openPanel('🏡 创建我的世界');
    body.appendChild(el('div', '', '<p style="color:#9fb3d9">给你的旅行者起个名字吧，它会出现在你的作品署名里。</p>'));
    const input = el('input', 'price-input') as HTMLInputElement;
    input.value = '旅行者';
    input.maxLength = 10;
    input.style.width = '100%';
    input.style.marginBottom = '12px';
    body.appendChild(input);
    const ok = el('button', 'btn', '出发 → 新手村') as HTMLButtonElement;
    ok.onclick = () => {
      const v = input.value.trim() || '旅行者';
      this.save.playerName = v;
      closePanel();
      this.enterPlay();
    };
    body.appendChild(ok);
  }

  // ---------------- 进入游戏 ----------------
  private enterPlay() {
    this.screen = 'play';
    this.clearUI();
    this.buildHUD(); // 先建 HUD（含摇杆 DOM），Input 构造时要抓它
    if (!this.renderer) this.initThree();
    // 正常模式点选建筑 → 建筑详情面板
    if (this.input) this.input.onTap = (nx, ny) => this.handleWorldTap(nx, ny);
    this.settleDaily(); // 每日维护费 / 经营收入结算
    this.quests.refreshHUD();
    toast(this.hasSave ? '欢迎回来，旅行者！' : '欢迎来到新手村！先找村长聊聊吧');
  }

  /** 每日结算：建筑维护费扣除 + 经营收入 */
  private settleDaily() {
    const now = Date.now();
    const days = Math.floor((now - (this.save.lastMaint ?? now)) / 86400000);
    if (days < 1) return;
    this.save.lastMaint = now;
    let maint = 0, income = 0;
    for (const b of this.save.buildings) {
      const def = BUILDABLES.find((d) => d.type === b.type);
      if (!def) continue;
      maint += (def.maintenance ?? 0) * days;
      income += (def.incomePerDay ?? 0) * days;
    }
    const parts: string[] = [];
    if (income > 0) {
      this.addCoins(income); // 含 totalEarned
      parts.push(`经营收入 +🪙${income}`);
    }
    if (maint > 0) {
      const pay = Math.min(this.save.coins, maint);
      this.save.coins -= pay;
      setCoins(this.save.coins);
      parts.push(pay >= maint ? `维护费 -🪙${maint}` : `维护费欠费（应付${maint}，实付${pay}）`);
    }
    if (parts.length) toast(`📅 ${days} 天结算：${parts.join('，')}`);
    this.queueSave();
  }

  private initThree() {
    try {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // 色彩管理：先用默认（ACES待黑屏排查后恢复）
    // renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.app.appendChild(renderer.domElement);
    renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera = camera;

    const world = buildWorld(scene);
    this.world = world;

    // 恢复已建造建筑
    for (const rec of this.save.buildings) {
      const g = makeBuilding(rec.type);
      if (!g) continue;
      g.position.set(rec.x, 0, rec.z);
      g.rotation.y = rec.rot;
      scene.add(g);
      this.placed.set(rec.id, g);
      world.colliders.push({ x: rec.x, z: rec.z, r: BUILD_RADIUS[rec.type] ?? 1.2 });
    }

    const player = new Player(scene, world.colliders, world.bounds);
    player.setPosition(this.save.px, this.save.pz);
    this.player = player;

    const npcMgr = new NPCManager(scene, world.npcSpots);
    this.npcMgr = npcMgr;

    this.quests = new QuestManager(this.save, (n) => this.addCoins(n), (n) => this.gainXP(n));
    this.shop = new Shop(
      this.save,
      (n) => this.addCoins(n),
      () => this.quests.addProgress('q3'),
      () => setCoins(this.save.coins),
      (d) => this.canStore(d),
      () => this.persistNow(),
    );
    this.build = new BuildMode(
      scene, camera, world.ground, this.save, world.colliders, world.bounds,
      (rec, g) => this.onPlaced(rec, g),
      (rec) => this.onDemolish(rec),
      () => [...this.placed.entries()].map(([id, group]) => ({
        rec: this.save.buildings.find((b) => b.id === id)!,
        group,
      })).filter((p) => p.rec),
      (b) => this.buildableUnlocked(b),
      () => this.findSpotNearPlayer(),
      () => { if (this.input) { this.input.onTap = (nx, ny) => this.handleWorldTap(nx, ny); this.input.uiLock = false; this.input.resetTouch(); } },
      (rec) => this.demolishCapacityWarn(rec),
    );
    this.myShops = new MyShopManager(
      this.save,
      (n) => this.addCoins(n),
      (shop, _itemId, price) => this.onMyShopTrade(shop, price),
      () => this.queueSave(),
    );
    this.market = new Market(this.save, (n) => this.addCoins(n), () => this.queueSave(), (d) => this.canStore(d));
    this.gallery = new Gallery(this.save, () => this.queueSave(), (w) => {
      const b = this.save.buildings.find((x) => x.id === w.buildingId);
      return b ? this.valuationOf(w, b.x, b.z) : 0;
    });

    this.input = new Input(renderer.domElement);

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.persist();
    });

    this.loop();
    } catch (err) {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;top:60px;left:10px;right:10px;background:#a00;color:#fff;padding:8px;font-size:12px;z-index:99999;border-radius:6px;word-break:break-all;';
      d.textContent = 'INIT_ERR: ' + (err as Error).message;
      document.body.appendChild(d);
    }
  }

  // ---------------- HUD ----------------
  private buildHUD() {
    const hud = el('div');
    hud.id = 'hud';
    hud.innerHTML = `<div id="coins">🪙 ${this.save.coins}</div>`;
    const mkBtn = (icon: string, cb: () => void) => {
      const b = el('button', 'hud-btn', icon) as HTMLButtonElement;
      b.onclick = cb;
      return b;
    };
    hud.appendChild(mkBtn('📋', () => this.openQuestPanel()));
    hud.appendChild(mkBtn('🛒', () => { this.uiWillOpen(); this.shop.open(); }));
    hud.appendChild(mkBtn('🏭', () => this.openIndustryPanel()));
    hud.appendChild(mkBtn('🌟', () => this.openGallery()));
    hud.appendChild(mkBtn('📦', () => {
      this.uiWillOpen();
      const wh = this.save.buildings.find((b) => WAREHOUSE_TYPES.includes(b.type));
      this.openWarehousePanel(wh);
      toast(wh ? '📦 仓库已打开' : '📦 仓库总览（建造仓库以扩容）');
    }));
    hud.appendChild(mkBtn('💬', () => this.openCommandPanel()));
    hud.appendChild(mkBtn('💾', () => { this.persist(); toast('进度已保存到本机 💾'); }));
    // 经验条
    const xpWrap = el('div');
    xpWrap.id = 'xp-wrap';
    xpWrap.innerHTML = `<div id="xp-bar"><div id="xp-fill"></div></div><div id="xp-text">Lv.1</div>`;
    hud.appendChild(xpWrap);
    this.ui.appendChild(hud);
    this.renderXpBar();

    // 小地图
    this.minimap = new Minimap();
    this.minimap.show();

    // 摇杆 DOM（input.ts 需要）
    const joy = el('div'); joy.id = 'joy-base';
    const knob = el('div'); knob.id = 'joy-knob';
    joy.appendChild(knob);
    this.ui.appendChild(joy);

    // 右下操作列
    const col = el('div'); col.id = 'action-col';
    const buildBtn = el('button', 'act-btn', '🔨<br>建造') as HTMLButtonElement;
    buildBtn.onclick = () => this.toggleBuild();
    col.appendChild(buildBtn);
    this.ui.appendChild(col);

    // 情境按钮（对话/收集）
    const ctx = el('button', '', '对话') as HTMLButtonElement;
    ctx.id = 'ctx-btn';
    ctx.onclick = () => this.doContextAction();
    this.ui.appendChild(ctx);
    this.ctxBtn = ctx;

    // 新手操作提示（第一次进村）：第一次推动摇杆后消失
    if (!this.hasSave) {
      const hint = el('div', '', '👆 按住屏幕左侧走路<br>👉 右侧滑动转视角');
      hint.id = 'move-hint';
      this.ui.appendChild(hint);
    }
  }

  /** 打开 UI 覆盖层前重置触摸（防 iOS 丢事件导致摇杆卡死） */
  private uiWillOpen() {
    this.input?.resetTouch();
  }

  private openQuestPanel() {
    this.uiWillOpen();
    const body = openPanel('📋 任务');
    for (const q of QUESTS) {
      const st = this.save.quests[q.id];
      if (!st) continue;
      const row = el('div', `quest-row${st === 'done' ? ' done' : ''}`);
      row.innerHTML = `<div class="qn">${st === 'done' ? '✅' : '📌'} ${q.name}</div>
        <div class="qd">${q.desc}</div>
        <div class="qp">进度 ${this.save.progress[q.id] ?? 0}/${q.target} · 奖励：${q.rewardText}</div>`;
      body.appendChild(row);
    }
  }

  private openGallery() {
    this.uiWillOpen();
    this.gallery.open((x, z) => {
      closePanel();
      this.focusPos = new THREE.Vector3(x, 0, z);
      this.focusUntil = performance.now() + 2500;
      toast('正在前往…');
    });
  }

  /** 建筑解锁判定 */
  private buildableUnlocked(b: { unlockQuest?: string; unlockEarned?: number; unlockLevel?: number }): { ok: boolean; reason: string } {
    if (b.unlockQuest && !this.quests.isDone(b.unlockQuest)) {
      const q = QUESTS.find((x) => x.id === b.unlockQuest);
      return { ok: false, reason: `完成任务「${q?.name ?? b.unlockQuest}」后解锁` };
    }
    if (b.unlockEarned && this.save.totalEarned < b.unlockEarned) {
      return { ok: false, reason: `累计赚取 🪙${b.unlockEarned} 后解锁（当前 ${this.save.totalEarned}）` };
    }
    if (b.unlockLevel && this.save.level < b.unlockLevel) {
      return { ok: false, reason: `达到 Lv.${b.unlockLevel} 后解锁（当前 Lv.${this.save.level}）` };
    }
    return { ok: true, reason: '' };
  }

  // ---------------- 经验值 / 等级 ----------------
  private gainXP(n: number) {
    if (n <= 0) return;
    const before = this.save.level;
    this.save.xp += n;
    const lv = levelForXp(this.save.xp);
    if (lv > before) {
      this.save.level = lv;
      const reward = 50 * lv;
      this.save.coins += reward;
      this.save.totalEarned += reward;
      setCoins(this.save.coins);
      toast(`⬆️ 升级！Lv.${lv}，金币+${reward}`);
      const newly = BUILDABLES.filter((b) => b.unlockLevel === lv);
      if (newly.length) {
        setTimeout(() => toast(`🔓 解锁新图纸：${newly.map((b) => b.name).join('、')}`), 1200);
      }
    }
    this.renderXpBar();
    this.queueSave();
  }

  private renderXpBar() {
    const fill = document.getElementById('xp-fill');
    const text = document.getElementById('xp-text');
    if (!fill || !text) return;
    const lv = this.save.level;
    const cur = LEVEL_XP[lv - 1] ?? 0;
    const next = LEVEL_XP[lv] ?? cur + 1;
    const pct = Math.min(100, Math.round(((this.save.xp - cur) / Math.max(1, next - cur)) * 100));
    fill.style.width = `${pct}%`;
    text.textContent = `Lv.${lv}`;
  }

  // ---------------- 加工与市场 ----------------
  private hasWorkshop(): boolean {
    return this.save.buildings.some((b) => b.type === 'workshop');
  }

  private openIndustryPanel(tab: 'process' | 'market' | 'log' = 'process') {
    this.uiWillOpen();
    const body = openPanel('🏭 加工与市场');
    body.appendChild(el('div', '',
      '<span style="color:#9fb3d9;font-size:12px">本地模拟市场，非真实玩家交易</span>'));
    const tabs = el('div', 'shop-tabs');
    const mkTab = (id: 'process' | 'market' | 'log', label: string) => {
      const b = el('button', `tab${tab === id ? ' active' : ''}`, label) as HTMLButtonElement;
      b.onclick = () => this.openIndustryPanel(id);
      tabs.appendChild(b);
    };
    mkTab('process', '⚙️ 加工');
    mkTab('market', '📈 市场');
    mkTab('log', '🧾 记录');
    body.appendChild(tabs);

    if (tab === 'process') this.renderProcessTab(body);
    else if (tab === 'market') this.renderMarketTab(body);
    else this.renderTxLogTab(body);
  }

  private renderProcessTab(body: HTMLElement) {
    const free = this.hasWorkshop();
    if (free) {
      body.appendChild(el('div', '', '<span style="color:#7fc8a9;font-size:12px">⚒️ 拥有工坊：加工免手续费</span>'));
    }
    for (const r of PROCESS_RECIPES) {
      const row = el('div', 'shop-item');
      const info = el('div', 'si');
      const can = r.inputs.every((i) => (this.save.inventory[i.id] ?? 0) >= i.n);
      const fee = free ? 0 : r.fee;
      const canFee = this.save.coins >= fee;
      const un = this.processUnlocked(r);
      info.innerHTML = `<div class="sn">${resName(r.id)}${un.ok ? '' : ' 🔒'}</div>
        <div class="sd">${r.inputs.map((i) => `${resName(i.id)}×${i.n}`).join(' + ')}
        → ${r.outputs.map((o) => `${resName(o.id)}×${o.n}`).join(' + ')}
        ${fee ? `（手续费 🪙${fee}）` : '（免费）'}</div>
        <div class="sd">库存：${r.inputs.map((i) => `${resName(i.id)}×${this.save.inventory[i.id] ?? 0}`).join(' ')}</div>
        ${un.ok ? '' : `<div class="sd" style="color:#ff9a9a">需建造${un.need}解锁</div>`}`;
      const btn = el('button', 'btn small', '加工') as HTMLButtonElement;
      btn.disabled = !can || !canFee || !un.ok;
      btn.onclick = () => this.doProcess(r.id);
      row.append(info, btn);
      body.appendChild(row);
    }
  }

  private doProcess(recipeId: string) {
    const r = PROCESS_RECIPES.find((x) => x.id === recipeId);
    if (!r) return;
    // 建筑解锁检查（查实际拥有的建筑）
    const un = this.processUnlocked(r);
    if (!un.ok) { toast(`🔒 需要建造${un.need}解锁该加工`); return; }
    if (!r.inputs.every((i) => (this.save.inventory[i.id] ?? 0) >= i.n)) {
      toast('材料不足');
      return;
    }
    // 容量检查（原子化：先算净增量，不满足则整个操作不执行，避免先扣后无法接收）
    const inSum = r.inputs.reduce((s, i) => s + i.n, 0);
    const outSum = r.outputs.reduce((s, o) => s + o.n, 0);
    if (!this.canStore(outSum - inSum)) { this.storeFullToast(); return; }
    const fee = this.hasWorkshop() ? 0 : r.fee;
    if (this.save.coins < fee) { toast('金币不足付手续费'); return; }
    for (const i of r.inputs) this.save.inventory[i.id] -= i.n;
    for (const o of r.outputs) {
      this.save.inventory[o.id] = (this.save.inventory[o.id] ?? 0) + o.n;
    }
    if (fee) { this.save.coins -= fee; setCoins(this.save.coins); }
    this.gainXP(5);
    toast(`⚙️ ${r.inputs.map((i) => `${resName(i.id)}×${i.n}`).join('+')} → ${r.outputs.map((o) => `${resName(o.id)}×${o.n}`).join('+')}`);
    this.queueSave();
    this.openIndustryPanel('process');
  }

  private renderMarketTab(body: HTMLElement) {
    for (const d of RESOURCES) {
      const row = el('div', 'shop-item');
      const info = el('div', 'si');
      const buyP = this.market.buyPrice(d.id);
      const sellP = this.market.sellPrice(d.id);
      const ref = refPriceOf(d.id);
      info.innerHTML = `<div class="sn">${d.icon} ${d.name} <span style="color:#9fb3d9;font-size:11px">库存×${this.save.inventory[d.id] ?? 0}</span></div>
        <div class="sd">买入 🪙${buyP} / 卖出 🪙${sellP} ${d.unit}</div>
        ${ref ? `<div class="sd" style="color:#8a93b8">现实参考 ¥${ref.cny}/${ref.unit}（${ref.source}）</div>` : ''}`;
      const ops = el('div', '');
      ops.style.display = 'flex';
      ops.style.gap = '6px';
      const buyB = el('button', 'btn small', '买1') as HTMLButtonElement;
      // 批量买入统一处理：严格保存 + 失败回滚
      let buying = false;
      const doBuy = async (n: number) => {
        if (buying) return;
        if (!Number.isInteger(n) || n < 1) { toast('数量至少为 1'); return; }
        if (!this.canStore(n)) { this.storeFullToast(); return; }
        buying = true;
        const coinsBefore = this.save.coins;
        const haveBefore = this.save.inventory[d.id] ?? 0;
        try {
          const tx = this.market.buy(d.id, n);
          if (!tx) { toast('金币不足'); return; }
          const saved = await storeSave(this.save, true);
          if (!saved) {
            this.save.coins = coinsBefore;
            this.save.inventory[d.id] = haveBefore;
            toast('⚠️ 保存失败，买入已取消');
            setCoins(this.save.coins);
            return;
          }
          setCoins(this.save.coins);
          toast(`✅ 购买成功：${d.name}×${n} 🪙-${tx.total}`);
        } finally {
          buying = false;
          this.openIndustryPanel('market');
        }
      };
      buyB.onclick = () => { void doBuy(1); };
      // 批量买入：数量输入 + 买入按钮
      const buyQtyWrap = el('div', '');
      buyQtyWrap.style.display = 'flex';
      buyQtyWrap.style.gap = '4px';
      buyQtyWrap.style.alignItems = 'center';
      buyQtyWrap.style.marginTop = '4px';
      const buyQtyInput = el('input', '') as HTMLInputElement;
      buyQtyInput.type = 'number';
      buyQtyInput.min = '1';
      buyQtyInput.value = '1';
      buyQtyInput.style.width = '60px';
      buyQtyInput.style.padding = '4px';
      buyQtyInput.placeholder = '买入数量';
      const buyQtyBtn = el('button', 'btn small', '买入') as HTMLButtonElement;
      buyQtyBtn.onclick = () => {
        const n = Math.floor(Number(buyQtyInput.value));
        void doBuy(n);
      };
      // 买入实时显示预计花费
      const buyEstDiv = el('div', '');
      buyEstDiv.style.fontSize = '11px';
      buyEstDiv.style.color = '#9fb3d9';
      const updateBuyEst = () => {
        const n = Math.floor(Number(buyQtyInput.value)) || 0;
        const unit = this.market.buyPrice(d.id);
        buyEstDiv.textContent = n >= 1 ? `预计 🪙-${n * unit}` : '';
      };
      buyQtyInput.oninput = updateBuyEst;
      updateBuyEst();
      buyQtyWrap.append(buyQtyInput, buyQtyBtn);
      const sellB = el('button', 'btn small ghost', '卖1') as HTMLButtonElement;
      const have = this.save.inventory[d.id] ?? 0;
      sellB.disabled = have < 1;
      // P1: 防连点（出售事务中禁用）
      let selling = false;
      const doSell = async (n: number) => {
        if (selling) return;
        if (!Number.isInteger(n) || n < 1) { toast('数量至少为 1'); return; }
        const cur = this.save.inventory[d.id] ?? 0;
        if (n > cur) { toast(`库存不足（持有 ${cur}）`); return; }
        selling = true;
        sellB.disabled = true;
        // 记录交易前状态（用于失败回滚，只回滚本次交易的字段）
        const coinsBefore = this.save.coins;
        try {
          const tx = this.market.sell(d.id, n);
          if (!tx) { toast('交易失败'); return; }
          // 等待保存完成（P0 模式：确保落盘）
          const saved = await storeSave(this.save, true);
          if (!saved) {
            // 保存失败：精确回滚本次交易（不覆盖其他合法变更）
            this.save.inventory[d.id] = cur;
            this.save.coins = coinsBefore;
            // 移除本次交易记录
            const txs = this.save.marketTx;
            if (txs.length > 0 && txs[txs.length - 1] === tx) txs.pop();
            // 恢复价格因子
            this.market.bumpFactor(d.id, 0.015 * n);
            toast('⚠️ 保存失败，出售已取消');
            setCoins(this.save.coins);
            return;
          }
          setCoins(this.save.coins);
          toast(`✅ 卖出成功：${d.name}×${n} 🪙+${tx.total}`);
        } finally {
          selling = false;
          this.openIndustryPanel('market');
        }
      };
      sellB.onclick = () => { void doSell(1); };
      // 批量出售：数量输入 + 快捷按钮
      const qtyWrap = el('div', '');
      qtyWrap.style.display = 'flex';
      qtyWrap.style.gap = '4px';
      qtyWrap.style.alignItems = 'center';
      qtyWrap.style.marginTop = '4px';
      const qtyInput = el('input', '') as HTMLInputElement;
      qtyInput.type = 'number';
      qtyInput.min = '1';
      qtyInput.max = String(have);
      qtyInput.value = '1';
      qtyInput.style.width = '60px';
      qtyInput.style.padding = '4px';
      const q10B = el('button', 'btn small ghost', '10') as HTMLButtonElement;
      q10B.disabled = have < 1;
      q10B.onclick = () => { qtyInput.value = String(Math.min(10, have)); };
      const qAllB = el('button', 'btn small ghost', '全部') as HTMLButtonElement;
      qAllB.disabled = have < 1;
      qAllB.onclick = () => { qtyInput.value = String(have); };
      const qSellB = el('button', 'btn small', '出售') as HTMLButtonElement;
      qSellB.disabled = have < 1;
      qSellB.onclick = () => {
        const n = Math.floor(Number(qtyInput.value));
        void doSell(n);
      };
      // 实时显示预计总额
      const estDiv = el('div', '');
      estDiv.style.fontSize = '11px';
      estDiv.style.color = '#9fb3d9';
      const updateEst = () => {
        const n = Math.floor(Number(qtyInput.value)) || 0;
        const unit = this.market.sellPrice(d.id);
        estDiv.textContent = n >= 1 ? `预计 🪙+${n * unit}` : '';
      };
      qtyInput.oninput = updateEst;
      updateEst();
      qtyWrap.append(qtyInput, q10B, qAllB, qSellB);
      const sellAllB = el('button', 'btn small ghost', '全卖') as HTMLButtonElement;
      sellAllB.disabled = have < 1;
      sellAllB.onclick = () => { void doSell(have); };
      ops.append(buyB, sellB, sellAllB);
      row.append(info, ops, buyQtyWrap, buyEstDiv, qtyWrap, estDiv);
      body.appendChild(row);
    }
  }

  private renderTxLogTab(body: HTMLElement) {
    const txs = [...this.save.marketTx].reverse().slice(0, 20);
    if (!txs.length) {
      body.appendChild(el('div', '', '<span style="color:#9fb3d9">还没有交易记录</span>'));
      return;
    }
    for (const t of txs) {
      const d = resDef(t.resId);
      const row = el('div', 'shop-item');
      row.innerHTML = `<div class="si"><div class="sn">${t.dir === 'buy' ? '📥 买入' : '📤 卖出'} ${d?.icon ?? ''}${d?.name ?? t.resId}×${t.n}</div>
        <div class="sd">单价 🪙${t.unitPrice} · ${t.dir === 'buy' ? '-' : '+'}🪙${t.total} · ${new Date(t.time).toLocaleString('zh-CN', { hour12: false })}</div></div>`;
      body.appendChild(row);
    }
  }
  private openCommandPanel() {
    const body = openPanel('💬 建造指令');
    body.appendChild(el('div', '',
      '<span style="color:#9fb3d9;font-size:12px">本地解析，不联网。例：建一座房子 / 种十棵树 / 删除最后一个 / 撤销</span>'));
    const row = el('div', 'shop-item');
    const input = el('input', 'price-input wide') as HTMLInputElement;
    input.placeholder = '输入指令…';
    input.style.flex = '1';
    const send = el('button', 'btn', '执行') as HTMLButtonElement;
    const run = () => {
      const v = input.value.trim();
      if (!v) return;
      closePanel();
      this.executeCommand(v);
    };
    send.onclick = run;
    input.onkeydown = (e) => { if ((e as KeyboardEvent).key === 'Enter') run(); };
    row.append(input, send);
    body.appendChild(row);
    const ex = el('div', 'cmd-examples');
    for (const e of COMMAND_EXAMPLES) {
      const b = el('button', 'btn small ghost', e) as HTMLButtonElement;
      b.onclick = () => { input.value = e; };
      ex.appendChild(b);
    }
    body.appendChild(ex);
    const hist = el('div', 'cmd-examples');
    const undoB = el('button', 'btn small', '↩️ 撤销') as HTMLButtonElement;
    undoB.onclick = () => { closePanel(); this.undo(); };
    const redoB = el('button', 'btn small', '↪️ 恢复') as HTMLButtonElement;
    redoB.onclick = () => { closePanel(); this.redo(); };
    hist.append(undoB, redoB);
    body.appendChild(hist);
    setTimeout(() => input.focus(), 100);
  }

  /** 执行一条中文指令（测试句柄也调这个） */
  executeCommand(text: string): string {
    const cmd = parseCommand(text);
    if (cmd.action === 'unknown') {
      toast('没听懂 😅 试试「建一座房子」或「种十棵树」');
      return 'unknown';
    }
    if (cmd.action === 'undo') { this.undo(); return 'undo'; }
    if (cmd.action === 'redo') { this.redo(); return 'redo'; }
    if (cmd.action === 'demolish_last') { this.demolishLast(); return 'demolish_last'; }
    return this.executeBuild(cmd.type!, cmd.count);
  }

  /** 指令建造：在玩家周围找空位批量放置（配方真实扣料） */
  private executeBuild(type: string, count: number): string {
    const def = BUILDABLES.find((b) => b.type === type);
    if (!def || !this.scene || !this.world || !this.player) return 'error';
    if (!this.quests.buildUnlocked()) {
      toast('完成任务「收集木材」后解锁建造');
      return 'locked';
    }
    const u = this.buildableUnlocked(def);
    if (!u.ok) { toast(`🔒 ${u.reason}`); return 'locked'; }
    // 按配方算能建几个
    let affordable = Math.floor(this.save.coins / Math.max(1, def.laborFee ?? 0));
    for (const r of def.recipe ?? []) {
      affordable = Math.min(affordable, Math.floor((this.save.inventory[r.id] ?? 0) / r.n));
    }
    const room = 30 - this.placed.size;
    const n = Math.min(count, affordable, room);
    if (n <= 0) {
      const st = recipeStatus(this.save, def);
      if (st.missing.length) {
        const miss = st.missing.map((m) => {
          const d = resDef(m.id);
          return `${d?.icon ?? ''}${d?.name ?? m.id}×${m.need - m.have}`;
        }).join('、');
        toast(`材料不足，还缺：${miss}\n去野外采集、加工或去市场购买`);
      } else if (!st.feeOk) {
        toast(`人工费不够，还差 🪙${(def.laborFee ?? 0) - this.save.coins}`);
      } else {
        toast('建筑已达 30 栋上限');
      }
      return 'noop';
    }
    let placed = 0;
    const extra: { x: number; z: number; r: number }[] = [];
    for (let i = 0; i < n; i++) {
      const spot = this.findSpotNearPlayer(extra);
      if (!spot) break;
      const rec: BuildingRec = { id: newId('b'), type: def.type, x: spot.x, z: spot.z, rot: 0 };
      const g = makeBuilding(def.type)!;
      g.position.set(rec.x, 0, rec.z);
      this.scene.add(g);
      for (const r of def.recipe ?? []) {
        this.save.inventory[r.id] = (this.save.inventory[r.id] ?? 0) - r.n;
      }
      this.save.coins -= def.laborFee ?? 0;
      const costBasis = this.costBasisOf(def);
      this.placed.set(rec.id, g);
      this.save.buildings.push(rec);
      this.world.colliders.push({ x: rec.x, z: rec.z, r: BUILD_RADIUS[def.type] ?? 1.2 });
      this.gallery.registerWork(def.type, rec.id, costBasis);
      if (def.type === 'shop') {
        this.save.myShops.push({
          buildingId: rec.id, name: `${this.save.playerName}的小店`,
          listings: [], earned: 0, trades: 0,
        });
        this.quests.addProgress('q4');
      }
      this.pushHistory({ kind: 'build', rec });
      extra.push({ x: rec.x, z: rec.z, r: BUILD_RADIUS[def.type] ?? 1.2 });
      placed++;
    }
    setCoins(this.save.coins);
    this.gainXP(10 * placed);
    this.queueSave();
    const msg = placed === count
      ? `✅ ${def.name}×${placed} 建好了！${recipeShort(def)}`
      : `✅ 建了 ${placed} 座${def.name}（${count - placed} 座材料不够/没地方放了）`;
    toast(msg);
    return `built:${placed}`;
  }

  /** 建造成本 = 材料按市价 + 人工费（与估值分开记） */
  private costBasisOf(def: BuildableDef): number {
    let c = def.laborFee ?? 0;
    for (const r of def.recipe ?? []) {
      const d = resDef(r.id);
      c += (d?.gamePrice ?? 0) * r.n;
    }
    return c;
  }

  /** 估值 = 成本 × 等级系数 × 位置系数（与建造成本分开） */
  valuationOf(work: { type: string; costBasis: number }, x: number, z: number): number {
    const def = BUILDABLES.find((b) => b.type === work.type);
    const tier = def?.tier ?? 1;
    const dist = Math.hypot(x, z);
    const locFactor = 1 + Math.max(0, (40 - dist) / 100);
    return Math.round(work.costBasis * (1 + 0.15 * tier) * locFactor);
  }

  /** 在玩家周围螺旋找空位 */
  private findSpotNearPlayer(extra: { x: number; z: number; r: number }[] = []): { x: number; z: number } | null {
    if (!this.player || !this.world) return null;
    const p = this.player.pos;
    const bounds = this.world.bounds;
    const all = [...this.world.colliders, ...extra];
    for (let r = 4; r <= 26; r += 2.5) {
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2 + r * 0.7;
        const x = p.x + Math.cos(ang) * r;
        const z = p.z + Math.sin(ang) * r;
        if (Math.hypot(x, z) > bounds - 3) continue;
        if (Math.hypot(x - p.x, z - p.z) < 2.5) continue;
        if (all.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 1.8)) continue;
        return { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 };
      }
    }
    return null;
  }

  /** 建筑放置后：登记、作品、商店初始化、任务 */
  private onPlaced(rec: BuildingRec, g: THREE.Group) {
    this.save.buildings.push(rec);
    this.placed.set(rec.id, g);
    this.world!.colliders.push({ x: rec.x, z: rec.z, r: BUILD_RADIUS[rec.type] ?? 1.2 });
    setCoins(this.save.coins);
    // 落成弹跳动画
    g.scale.setScalar(0.55);
    this.popAnims.push({ g, t: 0 });
    // 作品登记（含建造成本）
    const def = BUILDABLES.find((b) => b.type === rec.type);
    const work = this.gallery.registerWork(rec.type, rec.id, def ? this.costBasisOf(def) : 0);
    // 小商店 → 初始化经营数据
    if (rec.type === 'shop') {
      const ms: MyShopRec = {
        buildingId: rec.id,
        name: `${this.save.playerName}的小店`,
        listings: [], earned: 0, trades: 0,
      };
      this.save.myShops.push(ms);
      this.quests.addProgress('q4');
      toast(`🏪 ${work.name}开张了！靠近它点「管理商店」上架商品`);
    }
    this.pushHistory({ kind: 'build', rec });
    this.gainXP(10);
    this.queueSave();
  }

  /** 仓库管理面板：全部资源 + 容量明细 + 升级（所有按钮均有成功/失败提示） */
  private openWarehousePanel(rec?: BuildingRec) {
    const def = rec ? BUILDABLES.find((b) => b.type === rec.type) : undefined;
    const level = rec ? (rec.level ?? 1) : 0;
    const title = rec && def ? `${def.icon} ${def.name} <span class="badge">Lv.${level}</span>` : `📦 仓库`;
    const body = openPanel(title);
    const bd = this.storageBreakdown();
    const total = this.inventoryTotal();
    const remain = Math.max(0, bd.total - total);
    // 容量概览
    body.appendChild(el('div', 'wh-cap',
      `📦 总容量 <b>${bd.total}</b>　已用 <b>${total}</b>　剩余 <b>${remain}</b>`));
    body.appendChild(el('div', 'wh-cap-detail',
      `房屋 ${bd.houseMax} + 仓库 ${bd.warehouseSum}${total > bd.total ? '　<span style="color:#ff9a9a">（超限保留中）</span>' : ''}`));
    if (total >= bd.total) {
      body.appendChild(el('div', 'binfo-warn', '⚠️ 仓库已满！采集、购买、加工将无法新增库存，先消耗或扩容。'));
    }
    // 资源列表（以 RESOURCES 为准，只展示代码中存在的资源）
    const list = el('div', 'wh-list');
    for (const r of RESOURCES) {
      const n = this.save.inventory[r.id] ?? 0;
      const row = el('div', 'wh-row',
        `<span>${r.icon} ${r.name}</span><span class="wh-num">×${n}</span>`);
      list.appendChild(row);
    }
    // 金币单独一行
    list.appendChild(el('div', 'wh-row', `<span>🪙 金币</span><span class="wh-num">×${this.save.coins}</span>`));
    body.appendChild(list);
    // 升级按钮（复用升级事务，成功/失败均有提示）
    if (rec && def?.upgradeTo) {
      const target = BUILDABLES.find((b) => b.type === def.upgradeTo);
      const targetName = target ? `${target.icon} ${target.name}` : def.upgradeTo;
      const btn = el('button', 'btn', `⬆️ 升级为${targetName}（容量+${(target?.storageCap ?? 0) - (def.storageCap ?? 0)}）`) as HTMLButtonElement;
      // 检查材料
      const missing = (def.upgradeRecipe ?? []).filter((r) => (this.save.inventory[r.id] ?? 0) < r.n);
      const fee = def.upgradeFee ?? 0;
      if (missing.length || this.save.coins < fee) {
        btn.disabled = true;
        btn.classList.add('disabled');
        const miss = missing.map((m) => {
          const d = resDef(m.id);
          return `${d?.name ?? m.id}×${m.n - (this.save.inventory[m.id] ?? 0)}`;
        }).join('、');
        body.appendChild(el('div', 'binfo-warn', `材料不足，还缺：${miss}${this.save.coins < fee ? ` 🪙${fee - this.save.coins}` : ''}`));
      } else {
        btn.onclick = () => {
          this.upgradeBuilding(rec.id);
          // 升级成功后刷新仓库面板（upgradeBuilding 会关面板，这里重开）
          setTimeout(() => {
            const updated = this.save.buildings.find((b) => b.id === rec.id);
            if (updated) this.openWarehousePanel(updated);
          }, 600);
        };
      }
      body.appendChild(btn);
    } else if (rec && def && !def.upgradeTo) {
      body.appendChild(el('div', 'binfo-max', '🏆 已达最高级'));
    }
    if (!rec) {
      body.appendChild(el('div', 'binfo-desc', '💡 建造仓库可扩容：🔨 建造 → 仓库 📦（储物+200）'));
    } else {
      // 拆除按钮（含容量预警）
      const demBtn = el('button', 'btn ghost', '🗑️ 拆除仓库') as HTMLButtonElement;
      demBtn.onclick = () => {
        const warn = this.demolishCapacityWarn(rec);
        const msg = warn ? `${warn}\n\n` : '';
        if (confirm(`${msg}确定拆除${def?.name ?? '仓库'}？返还 50% 材料和人工费。`)) {
          closePanel();
          this.onDemolish(rec);
        } else {
          toast('已取消拆除');
        }
      };
      body.appendChild(demBtn);
      // 出售按钮（0.9）
      const sellBtn = el('button', 'btn', `💰 出售（🪙${this.sellPriceOf(rec).price}）`) as HTMLButtonElement;
      sellBtn.onclick = () => this.sellBuilding(rec.id);
      body.appendChild(sellBtn);
    }
  }

  /** 建筑详情面板：等级、容量、加工解锁、升级按钮 */
  private openBuildingPanel(rec: BuildingRec) {
    const def = BUILDABLES.find((b) => b.type === rec.type);
    if (!def) return;
    const level = rec.level ?? 1;
    const body = openPanel(`${def.icon} ${def.name} <span class="badge">Lv.${level}</span>`);
    body.appendChild(el('div', 'binfo-desc', def.desc ?? ''));
    // Alpha 0.7：容量与加工解锁信息
    const cap = def.storageCap ?? 0;
    if (cap > 0) {
      const total = this.inventoryTotal();
      const maxCap = this.storageCap();
      body.appendChild(el('div', 'binfo-cap',
        `📦 储物：${total}/${maxCap}${total > maxCap ? '（超限保留中）' : ''}`));
      // 该建筑解锁的加工
      const unlocked = PROCESS_RECIPES.filter((r) => {
        const need = PROCESS_BUILDING_TIER[r.requireBuilding ?? ''] ?? 0;
        const my = PROCESS_BUILDING_TIER[def.type] ?? 0;
        return need > 0 && need <= my;
      });
      if (unlocked.length) {
        body.appendChild(el('div', 'binfo-unlock',
          `⚙️ 解锁加工：${unlocked.map((r) => r.name).join('、')}`));
      }
    }
    if (def.upgradeTo) {
      const target = BUILDABLES.find((b) => b.type === def.upgradeTo);
      const targetName = target ? `${target.icon} ${target.name}` : def.upgradeTo;
      const targetCap = target?.storageCap ?? 0;
      body.appendChild(el('div', 'binfo-up', `⬆️ 可升级为：${targetName}（Lv.${level + 1}）`));
      if (targetCap > cap) {
        body.appendChild(el('div', 'binfo-cap-up', `📦 容量 ${cap} → ${targetCap}`));
      }
      // 配方行：名称 + 需要 / 拥有
      const list = el('div', 'binfo-mats');
      const missing: string[] = [];
      for (const r of def.upgradeRecipe ?? []) {
        const have = this.save.inventory[r.id] ?? 0;
        const d = resDef(r.id);
        const ok = have >= r.n;
        if (!ok) missing.push(`${d?.name ?? r.id}×${r.n - have}`);
        const row = el('div', `binfo-mat${ok ? '' : ' lack'}`,
          `${d?.icon ?? ''}${d?.name ?? r.id}：${have}/${r.n}${ok ? '' : ' ❌'}`);
        list.appendChild(row);
      }
      const fee = def.upgradeFee ?? 0;
      const feeOk = this.save.coins >= fee;
      if (!feeOk) missing.push(`金币×${fee - this.save.coins}`);
      list.appendChild(el('div', `binfo-mat${feeOk ? '' : ' lack'}`,
        `🪙金币：${this.save.coins}/${fee}${feeOk ? '' : ' ❌'}`));
      body.appendChild(list);
      const btn = el('button', 'btn', `⬆️ 升级（${recipeShort({ ...def, recipe: def.upgradeRecipe ?? [], laborFee: fee } as BuildableDef)}）`) as HTMLButtonElement;
      if (missing.length) {
        btn.disabled = true;
        btn.classList.add('disabled');
        body.appendChild(el('div', 'binfo-warn', `材料不足，还缺：${missing.join('、')}`));
      } else {
        btn.onclick = () => this.upgradeBuilding(rec.id);
      }
      body.appendChild(btn);
    } else {
      body.appendChild(el('div', 'binfo-max', '🏆 已达最高级'));
    }
    // 拆除按钮（含容量预警）
    const demBtn = el('button', 'btn ghost', '🗑️ 拆除建筑') as HTMLButtonElement;
    demBtn.onclick = () => {
      const warn = this.demolishCapacityWarn(rec);
      const msg = warn ? `${warn}\n\n` : '';
      if (confirm(`${msg}确定拆除${def?.name ?? '建筑'}？返还 50% 材料和人工费。`)) {
        closePanel();
        this.onDemolish(rec);
      } else {
        toast('已取消拆除');
      }
    };
    body.appendChild(demBtn);
    // 出售按钮（0.9）
    const sellBtn2 = el('button', 'btn', `💰 出售（🪙${this.sellPriceOf(rec).price}）`) as HTMLButtonElement;
    sellBtn2.onclick = () => this.sellBuilding(rec.id);
    body.appendChild(sellBtn2);
  }

  /** 升级：同一栋房子的状态变更（ID/坐标/旋转/存档引用不变，只换模型+等级） */
  private upgradeBuilding(id: string) {
    if (this.upgrading.has(id)) return; // 防连点
    const rec = this.save.buildings.find((b) => b.id === id);
    if (!rec) return;
    const def = BUILDABLES.find((b) => b.type === rec.type);
    if (!def?.upgradeTo) return;
    // 0. 先验证目标模型可创建（失败则不扣料不改数据，保证事务一致）
    const newG = makeBuilding(def.upgradeTo);
    if (!newG || !this.scene) { toast('升级失败：模型加载异常'); return; }
    this.upgrading.add(id);
    try {
      // 1. 检查材料（失败不扣）
      const missing = (def.upgradeRecipe ?? []).filter(
        (r) => (this.save.inventory[r.id] ?? 0) < r.n);
      const fee = def.upgradeFee ?? 0;
      if (missing.length || this.save.coins < fee) {
        const miss = missing.map((m) => {
          const d = resDef(m.id);
          return `${d?.icon ?? ''}${d?.name ?? m.id}×${m.n - (this.save.inventory[m.id] ?? 0)}`;
        }).join('、');
        toast(`材料不足，还缺：${miss}${this.save.coins < fee ? ` 🪙${fee - this.save.coins}` : ''}`);
        return;
      }
      // 2. 扣料（原子操作，同一栋房子）
      for (const r of def.upgradeRecipe ?? []) {
        this.save.inventory[r.id] = (this.save.inventory[r.id] ?? 0) - r.n;
      }
      this.save.coins -= fee;
      // 3. 更新存档记录（同一对象：id/x/z/rot 不变，只改 type/level）
      const oldName = def.name;
      rec.type = def.upgradeTo;
      rec.level = (rec.level ?? 1) + 1;
      // 4. 换 3D 模型（placed 用同一 ID，只替换 Group；newG 已在步骤0验证）
      const oldG = this.placed.get(id);
      if (oldG) this.scene.remove(oldG);
      newG.position.set(rec.x, 0, rec.z);
      newG.rotation.y = rec.rot;
      this.scene.add(newG);
      this.placed.set(id, newG);
      // 5. 原地更新碰撞体半径（按位置找，不删不增）
      const col = this.world?.colliders.find(
        (c) => Math.hypot(c.x - rec.x, c.z - rec.z) < 0.5);
      if (col) col.r = BUILD_RADIUS[rec.type] ?? 1.2;
      // 6. 落成动画 + 作品记录更新（buildingId 引用不变）
      newG.scale.setScalar(0.55);
      this.popAnims.push({ g: newG, t: 0 });
      const work = this.save.works.find((w) => w.buildingId === id);
      if (work) {
        work.type = rec.type;
        work.name = `${this.save.playerName}的${BUILDABLE_NAMES[rec.type] ?? rec.type}`;
      }
      setCoins(this.save.coins);
      this.queueSave();
      closePanel();
      toast(`⬆️ ${oldName} → ${BUILDABLE_NAMES[rec.type]}！Lv.${rec.level}`);
      this.gainXP(15);
    } finally {
      this.upgrading.delete(id);
    }
  }

  /** 拆除容量预警：计算拆除该建筑后的容量变化（拆除前提示，不改拆除流程） */
  private demolishCapacityWarn(rec: BuildingRec): string | null {
    const before = this.storageCap();
    // 模拟移除该建筑后的容量
    let houseMax = 20;
    let warehouseSum = 0;
    for (const b of this.save.buildings) {
      if (b.id === rec.id) continue;
      const def = BUILDABLES.find((d) => d.type === b.type);
      const c = def?.storageCap ?? 0;
      if (WAREHOUSE_TYPES.includes(b.type)) warehouseSum += c;
      else if (c > houseMax) houseMax = c;
    }
    const after = houseMax + warehouseSum;
    if (after >= before) return null;
    const total = this.inventoryTotal();
    let msg = `📦 当前容量 ${before}，拆除后容量 ${after}`;
    if (total > after) {
      msg += `\n⚠️ 现有库存 ${total} 将超限（保留但无法新增），建议先消耗`;
    }
    return msg;
  }

  /**
   * 建筑历史投入成本基数（0.9 出售用）
   * 依据：升级链线性无分支 + rec.level 记录升级次数，可靠还原历史投入
   * - 链 thatch(1)→hut(2)→stonehouse(3)→brickhouse(4)
   * - 链 warehouse(1)→bigwarehouse(2)
   * - level=1 表示直接建造；level>1 表示从链头逐级升级上来
   */
  private buildingCostBasis(rec: BuildingRec): number {
    const matVal = (recipe: { id: string; n: number }[] | undefined): number =>
      (recipe ?? []).reduce((s, r) => s + (resDef(r.id)?.gamePrice ?? 0) * r.n, 0);
    // 找到该建筑所在的升级链
    const findChain = (type: string): { chain: string[]; idx: number } | null => {
      // 从每个可能的链头开始追溯
      for (const head of BUILDABLES.filter((b) => b.upgradeTo)) {
        const chain: string[] = [head.type];
        let cur = head;
        while (cur.upgradeTo) {
          const next = BUILDABLES.find((b) => b.type === cur.upgradeTo);
          if (!next) break;
          chain.push(next.type);
          cur = next;
        }
        const idx = chain.indexOf(type);
        if (idx >= 0) return { chain, idx };
      }
      return null;
    };
    const found = findChain(rec.type);
    const level = rec.level ?? 1;
    if (!found) {
      // 不在升级链中：直接建造成本
      const def = BUILDABLES.find((d) => d.type === rec.type);
      return matVal(def?.recipe) + (def?.laborFee ?? 0);
    }
    const { chain, idx } = found;
    // level 表示在链中的位置（1-based）；实际升级次数 = level - 1
    // 但 type 已经决定了在链中的位置，level 用于验证
    // 保守策略：按 type 在链中的位置计算（type 是可靠的）
    let basis = 0;
    for (let i = 0; i <= idx; i++) {
      const t = BUILDABLES.find((d) => d.type === chain[i])!;
      if (i === 0) {
        basis += matVal(t.recipe) + (t.laborFee ?? 0);
      } else {
        const prev = BUILDABLES.find((d) => d.type === chain[i - 1])!;
        basis += matVal(prev.upgradeRecipe) + (prev.upgradeFee ?? 0);
      }
    }
    // 如果 level=1 但 type 在链中部（如直接建造的 hut），说明是直接建造
    // 此时应只算直接建造成本（保守，避免高估）
    if (level === 1 && idx > 0) {
      const def = BUILDABLES.find((d) => d.type === rec.type)!;
      return matVal(def.recipe) + (def.laborFee ?? 0);
    }
    return basis;
  }

  /** 出售估价：floor(成本基数 × 0.7 × 地段因子)，地段因子上限 1.4 */
  private sellPriceOf(rec: BuildingRec): { price: number; basis: number; locFactor: number } {
    const basis = this.buildingCostBasis(rec);
    const dist = Math.hypot(rec.x, rec.z);
    const locFactor = Math.min(1.4, 1 + Math.max(0, (40 - dist) / 100));
    const price = Math.floor(basis * 0.7 * locFactor);
    return { price, basis, locFactor };
  }

  /** 出售建筑（0.9）：原子事务，防连点，不返还材料 */
  private selling = new Set<string>();
  private sellBuilding(id: string): void {
    if (this.selling.has(id)) return; // 防连点
    const rec = this.save.buildings.find((b) => b.id === id);
    if (!rec) { toast('建筑不存在'); return; }
    const def = BUILDABLES.find((d) => d.type === rec.type);
    if (!def) { toast('建筑数据异常'); return; }
    this.selling.add(id);
    try {
      const { price, basis, locFactor } = this.sellPriceOf(rec);
      // 容量预警（仓库/房屋出售导致容量下降时）
      const warn = this.demolishCapacityWarn(rec);
      const locStr = locFactor > 1 ? `（地段加成 ×${locFactor.toFixed(2)}）` : '';
      const warnStr = warn ? `\n\n${warn}` : '';
      const msg = `出售${def.name}（Lv.${rec.level ?? 1}）？\n` +
        `📊 投入成本约 🪙${basis}${locStr}\n` +
        `💰 售价 🪙${price}（7 折）${warnStr}\n\n` +
        `确认出售？（不返还材料）`;
      if (!confirm(msg)) { toast('已取消出售'); return; }
      // 原子事务：先加币，再移除建筑（任一失败则整体回滚）
      this.addCoins(price);
      const rec2 = this.save.buildings.find((b) => b.id === id);
      if (!rec2) {
        // 建筑在确认对话框期间被移除（理论上不应发生），回滚金币
        this.save.coins -= price;
        setCoins(this.save.coins);
        toast('出售失败：建筑已不存在，金币已退回');
        return;
      }
      this.removeBuilding(id, 0, true); // refundRate=0，不返还材料
      closePanel();
      toast(`💰 出售${def.name}，获得 🪙${price}`);
      this.queueSave();
    } finally {
      this.selling.delete(id);
    }
  }

  /** 拆除建筑：返还 50% 材料 + 50% 人工费 */
  private onDemolish(rec: BuildingRec) {
    const { coinRefund, matRefund, shop } = this.removeBuilding(rec.id, 0.5, false);
    this.pushHistory({ kind: 'demolish', rec, coinRefund, matRefund, shop });
    const matStr = matRefund.map((m) => `${resName(m.id)}×${m.n}`).join(' ');
    toast(`🗑️ 拆除了${BUILDABLE_NAMES[rec.type] ?? ''}，返还 🪙${coinRefund}${matStr ? ' ' + matStr : ''}`);
    this.queueSave();
  }

  /**
   * 移除建筑（拆除/撤销共用）
   * @param refundRate 返还比例（拆除 0.5，撤销建造 1.0）
   * @param removeWork 是否连作品记录一起删（撤销用 true，拆除用 false 仅标记）
   */
  private removeBuilding(id: string, refundRate: number, removeWork: boolean): {
    coinRefund: number; matRefund: { id: string; n: number }[]; shop?: MyShopRec;
  } {
    const rec = this.save.buildings.find((b) => b.id === id);
    if (!rec) return { coinRefund: 0, matRefund: [] };
    const g = this.placed.get(id);
    if (g && this.scene) this.scene.remove(g);
    this.placed.delete(id);
    if (this.world) {
      this.world.colliders = this.world.colliders.filter(
        (c) => Math.hypot(c.x - rec.x, c.z - rec.z) > 0.5,
      );
    }
    this.save.buildings = this.save.buildings.filter((b) => b.id !== id);
    let shop: MyShopRec | undefined;
    const si = this.save.myShops.findIndex((s) => s.buildingId === id);
    if (si >= 0) { shop = this.save.myShops[si]; this.save.myShops.splice(si, 1); }
    if (removeWork) {
      this.save.works = this.save.works.filter((w) => w.buildingId !== id);
    } else {
      const w = this.save.works.find((x) => x.buildingId === id && !x.simulated);
      if (w) w.demolished = true;
    }
    const def = BUILDABLES.find((b) => b.type === rec.type);
    const coinRefund = Math.floor((def?.laborFee ?? 0) * refundRate);
    const matRefund = (def?.recipe ?? [])
      .map((r) => ({ id: r.id, n: Math.floor(r.n * refundRate) }))
      .filter((m) => m.n > 0);
    if (coinRefund) this.addCoins(coinRefund);
    for (const m of matRefund) {
      this.save.inventory[m.id] = (this.save.inventory[m.id] ?? 0) + m.n;
    }
    return { coinRefund, matRefund, shop };
  }

  private pushHistory(op: HistOp) {
    this.undoStack.push(op);
    if (this.undoStack.length > 20) this.undoStack.shift();
    this.redoStack = [];
  }

  /** 撤销 */
  private undo() {
    const op = this.undoStack.pop();
    if (!op) { toast('没有可撤销的操作'); return; }
    if (op.kind === 'build') {
      const def = BUILDABLES.find((b) => b.type === op.rec.type);
      this.removeBuilding(op.rec.id, 1.0, true);
      toast(`↩️ 撤销建造${def?.name ?? ''}（材料+人工费全额返还）`);
    } else {
      this.restoreDemolished(op.rec, op.coinRefund, op.matRefund, op.shop);
      toast('↩️ 撤销拆除，建筑已恢复');
    }
    this.redoStack.push(op);
    this.queueSave();
  }

  /** 恢复（重做） */
  private redo() {
    const op = this.redoStack.pop();
    if (!op) { toast('没有可恢复的操作'); return; }
    if (op.kind === 'build') {
      const def = BUILDABLES.find((b) => b.type === op.rec.type)!;
      const st = recipeStatus(this.save, def);
      if (!st.ok) {
        toast('材料或人工费不足，无法恢复建造');
        this.redoStack.push(op);
        return;
      }
      const g = makeBuilding(op.rec.type);
      if (g && this.scene && this.world) {
        g.position.set(op.rec.x, 0, op.rec.z);
        g.rotation.y = op.rec.rot;
        this.scene.add(g);
        for (const r of def.recipe ?? []) {
          this.save.inventory[r.id] = (this.save.inventory[r.id] ?? 0) - r.n;
        }
        this.save.coins -= def.laborFee ?? 0;
        setCoins(this.save.coins);
        this.placed.set(op.rec.id, g);
        this.save.buildings.push(op.rec);
        this.world.colliders.push({ x: op.rec.x, z: op.rec.z, r: BUILD_RADIUS[op.rec.type] ?? 1.2 });
        this.gallery.registerWork(op.rec.type, op.rec.id, this.costBasisOf(def));
        if (op.rec.type === 'shop') {
          this.save.myShops.push({
            buildingId: op.rec.id, name: `${this.save.playerName}的小店`,
            listings: [], earned: 0, trades: 0,
          });
        }
      }
      toast('↪️ 已恢复建造');
    } else {
      const { coinRefund, matRefund } = this.removeBuilding(op.rec.id, 0.5, false);
      const matStr = matRefund.map((m) => `${resName(m.id)}×${m.n}`).join(' ');
      toast(`↪️ 已恢复拆除，返还 🪙${coinRefund}${matStr ? ' ' + matStr : ''}`);
    }
    this.undoStack.push(op);
    if (this.undoStack.length > 20) this.undoStack.shift();
    this.queueSave();
  }

  /** 恢复一次拆除（撤销拆除用）：扣回返还的金币和材料 */
  private restoreDemolished(
    rec: BuildingRec, coinRefund: number, matRefund: { id: string; n: number }[], shop?: MyShopRec,
  ) {
    const g = makeBuilding(rec.type);
    if (!g || !this.scene || !this.world) return;
    g.position.set(rec.x, 0, rec.z);
    g.rotation.y = rec.rot;
    this.scene.add(g);
    this.placed.set(rec.id, g);
    this.save.buildings.push(rec);
    this.world.colliders.push({ x: rec.x, z: rec.z, r: BUILD_RADIUS[rec.type] ?? 1.2 });
    this.save.coins -= coinRefund;
    for (const m of matRefund) {
      this.save.inventory[m.id] = Math.max(0, (this.save.inventory[m.id] ?? 0) - m.n);
    }
    setCoins(this.save.coins);
    const w = this.save.works.find((x) => x.buildingId === rec.id && !x.simulated);
    if (w) w.demolished = false;
    if (shop) this.save.myShops.push(shop);
  }

  /** 删除最后创建的建筑 */
  private demolishLast() {
    const rec = this.save.buildings[this.save.buildings.length - 1];
    if (!rec) { toast('还没有建筑可删'); return; }
    this.onDemolish(rec);
  }

  /** 玩家自营商店成交后：任务进度 + 作品交易数 + 解锁提示 */
  private onMyShopTrade(shop: MyShopRec, price: number) {
    this.quests.addProgress('q5', price);
    this.gainXP(5);
    const w = this.save.works.find((x) => x.buildingId === shop.buildingId && !x.simulated);
    if (w) w.trades += 1;
    // 小木屋解锁提示
    const hut = BUILDABLES.find((b) => b.type === 'hut')!;
    if (this.buildableUnlocked(hut).ok && !this.save.progress['hut_unlocked_tip']) {
      this.save.progress['hut_unlocked_tip'] = 1;
      toast('🏠 解锁了新图纸：小木屋！去建造看看吧');
    }
    this.queueSave();
  }

  /** 离玩家最近的自营商店（3.5 米内） */
  private nearestMyShop(): MyShopRec | null {    if (!this.player) return null;
    for (const s of this.save.myShops) {
      const b = this.save.buildings.find((x) => x.id === s.buildingId);
      if (!b) continue;
      if (Math.hypot(this.player.pos.x - b.x, this.player.pos.z - b.z) < 3.5) return s;
    }
    return null;
  }

  /** 正常模式点选：raycast 建筑 → 打开详情面板（不干扰摇杆/镜头） */
  private handleWorldTap(nx: number, ny: number) {
    if (!this.camera || !this.scene || this.build.active) return;
    // 面板打开时不重复拾取
    if (document.getElementById('panel-wrap')) return;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)), this.camera);
    const groups = [...this.placed.values()];
    if (!groups.length) return;
    const hit = ray.intersectObjects(groups, true)[0];
    if (!hit) return;
    let g: THREE.Object3D | null = hit.object;
    while (g && !groups.includes(g as THREE.Group)) g = g.parent;
    if (!g) return;
    const id = [...this.placed.entries()].find(([, grp]) => grp === g)?.[0];
    if (!id) return;
    const rec = this.save.buildings.find((b) => b.id === id);
    if (!rec) return;
    // 仓库类建筑 → 仓库管理面板；其他 → 建筑详情面板
    // 点选反馈：建筑缩放脉冲，让手指有"点中了"的感觉
    this.tapPulse(g);
    if (WAREHOUSE_TYPES.includes(rec.type)) this.openWarehousePanel(rec);
    else this.openBuildingPanel(rec);
  }

  /** 点选建筑时的缩放脉冲反馈（0.3秒） */
  private tapPulse(g: THREE.Object3D): void {
    const orig = g.scale.clone();
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 300;
      if (t >= 1) { g.scale.copy(orig); return; }
      const s = 1 + Math.sin(t * Math.PI) * 0.12;
      g.scale.set(orig.x * s, orig.y * s, orig.z * s);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private toggleBuild() {
    if (!this.quests.buildUnlocked()) {
      toast('完成任务「收集木材」后解锁建造');
      return;
    }
    if (this.build.active) {
      this.build.exit(); // onExit 回调里会解锁 input
    } else {
      closeDialog(); closePanel();
      this.build.enter();
      if (this.input) {
        this.input.onTap = (nx, ny) => this.build.handleTap(nx, ny);
        this.input.uiLock = true;
      }
    }
  }

  // ---------------- 游戏逻辑 ----------------
  private addCoins(n: number) {
    this.save.coins += n;
    setCoins(this.save.coins);
    this.queueSave();
  }

  private queueSave() {
    if (this.isShowroom) return; // 展示模式不写存档
    this.saveTimer = 0; // 下次循环顺手存（简化：直接存）
    this.persistSoon();
  }

  private persistSoon() {
    if (this.player) { this.save.px = this.player.pos.x; this.save.pz = this.player.pos.z; }
    void storeSave(this.save);
  }

  private persist() { this.persistSoon(); }

  /** 严格保存：等待 IndexedDB 写入完成，返回是否成功（关键交易用） */
  private async persistNow(): Promise<boolean> {
    if (this.player) { this.save.px = this.player.pos.x; this.save.pz = this.player.pos.z; }
    return storeSave(this.save, true);
  }

  // ---------- Alpha 0.7 资源经济底座：储物容量 ----------
  /** 库存总量：所有非负库存数量之和 */
  private inventoryTotal(): number {
    let t = 0;
    for (const k of Object.keys(this.save.inventory)) {
      const v = this.save.inventory[k] ?? 0;
      if (v > 0) t += v;
    }
    return t;
  }

  /** 储物容量（Alpha 0.8）：房屋取最大值 + 仓库容量累加
   *  公式：totalCap = houseMax + warehouseSum
   *  - houseMax：所拥有房屋（草屋/木屋/石屋/砖房）中的最大 storageCap，无房默认 20
   *  - warehouseSum：所有仓库/大仓库的 storageCap 之和
   *  加法保证：建仓库只增不减；房屋与仓库不重复计算 */
  private storageCap(): number {
    let houseMax = 20;
    let warehouseSum = 0;
    for (const b of this.save.buildings) {
      const def = BUILDABLES.find((d) => d.type === b.type);
      const c = def?.storageCap ?? 0;
      if (WAREHOUSE_TYPES.includes(b.type)) {
        warehouseSum += c;
      } else if (c > houseMax) {
        houseMax = c;
      }
    }
    return houseMax + warehouseSum;
  }

  /** 容量明细（仓库面板展示用） */
  private storageBreakdown(): { houseMax: number; warehouseSum: number; total: number } {
    let houseMax = 20;
    let warehouseSum = 0;
    for (const b of this.save.buildings) {
      const def = BUILDABLES.find((d) => d.type === b.type);
      const c = def?.storageCap ?? 0;
      if (WAREHOUSE_TYPES.includes(b.type)) warehouseSum += c;
      else if (c > houseMax) houseMax = c;
    }
    return { houseMax, warehouseSum, total: houseMax + warehouseSum };
  }

  /**
   * 能否净增 delta 库存（grandfather 策略）：
   * - delta <= 0（纯消耗/净减少转换）：永远允许
   * - delta > 0：仅当总量 + delta <= 容量时允许
   * - 超限旧库存完整保留，只拦截会导致总量进一步增加的操作
   */
  private canStore(delta: number): boolean {
    if (delta <= 0) return true;
    return this.inventoryTotal() + delta <= this.storageCap();
  }

  /** 容量不足时的统一提示 */
  private storeFullToast(): void {
    toast(`📦 储物已满（${this.inventoryTotal()}/${this.storageCap()}），升级房屋扩容`);
  }

  /** 玩家加工建筑等级（hut=1 < stonehouse=2 < brickhouse=3，无则 0） */
  private processTier(): number {
    let t = 0;
    for (const b of this.save.buildings) {
      const tier = PROCESS_BUILDING_TIER[b.type] ?? 0;
      if (tier > t) t = tier;
    }
    return t;
  }

  /** 该加工配方是否已解锁（检查实际拥有的建筑，不看 UI） */
  private processUnlocked(r: ProcessRecipe): { ok: boolean; need?: string } {
    if (!r.requireBuilding) return { ok: true };
    const needTier = PROCESS_BUILDING_TIER[r.requireBuilding] ?? 0;
    if (this.processTier() >= needTier) return { ok: true };
    const def = BUILDABLES.find((d) => d.type === r.requireBuilding);
    return { ok: false, need: def ? `${def.icon}${def.name}` : r.requireBuilding };
  }
  // ---------- Alpha 0.7 结束 ----------

  private handleNPCAction(action: string) {
    if (action === 'complete_q1') this.quests.complete('q1');
    else if (action === 'open_shop') this.shop.open();
  }

  private talkTo(npc: NPCHandle) {
    let start: string | undefined;
    if (npc.def.id === 'chief') start = this.quests.isActive('q1') ? 'hello' : 'after';
    if (npc.def.id === 'craftsman') start = this.quests.buildUnlocked() ? 'unlocked' : 'hello';
    // 对话框弹出时手指可能还按在摇杆上（iOS 会丢事件），先重置触摸状态
    this.input?.resetTouch();
    this.npcMgr!.talk(npc, (a) => this.handleNPCAction(a), start);
  }

  private nearestNode(): number {
    if (!this.world || !this.player) return -1;
    let bi = -1, bd = 3.4;
    this.world.resNodes.forEach((w, i) => {
      if (!w.active) return;
      const d = Math.hypot(this.player!.pos.x - w.pos.x, this.player!.pos.z - w.pos.z);
      if (d < bd) { bd = d; bi = i; }
    });
    return bi;
  }

  private doContextAction() {
    if (!this.player || !this.npcMgr || !this.world) return;
    const npc = this.npcMgr.nearest(this.player.pos);
    if (npc) { this.talkTo(npc); return; }
    const ms = this.nearestMyShop();
    if (ms) { this.myShops.open(ms); return; }
    const ni = this.nearestNode();
    if (ni >= 0) {
      const node = this.world.resNodes[ni];
      const gain = 2;
      if (!this.canStore(gain)) { this.storeFullToast(); return; }
      node.active = false; node.timer = 25; node.group.visible = false;
      this.save.inventory[node.kind] = (this.save.inventory[node.kind] ?? 0) + gain;
      if (node.kind === 'wood') this.quests.addProgress('q2');
      const d = resDef(node.kind);
      toast(`${d?.icon ?? '📦'} 获得${d?.name ?? node.kind}×${gain}`);
      this.persistSoon();
    }
  }

  // ---------------- 主循环 ----------------
  private loop = () => {
    requestAnimationFrame(this.loop);
    if (this.screen !== 'play' || !this.renderer || !this.scene || !this.camera ||
        !this.player || !this.input || !this.world || !this.npcMgr) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;
    const t = performance.now();

    // 输入 → 移动
    const km = this.input.keyMove();
    const f = THREE.MathUtils.clamp(this.input.moveF + km.f, -1, 1);
    const s = THREE.MathUtils.clamp(this.input.moveS + km.s, -1, 1);
    this.player.update(dt, f, s, this.camYaw);

    // 视角
    const look = this.input.consumeLook();
    this.camYaw -= look.dx;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + look.dy, 0.12, 1.15);

    // 相机跟随（阶段3：拉近+防穿墙）
    const target = this.focusPos && t < this.focusUntil
      ? this.focusPos
      : this.player.pos.clone().add(new THREE.Vector3(0, 1.2, 0)); // 胸口高度
    const dist = 6.5; // 拉近：人物和建筑占比更大
    const cx = target.x + Math.sin(this.camYaw) * Math.cos(this.camPitch) * dist;
    const cz = target.z + Math.cos(this.camYaw) * Math.cos(this.camPitch) * dist;
    const cy = target.y + Math.sin(this.camPitch) * dist;
    const desired = new THREE.Vector3(cx, Math.max(cy, 1.6), cz);
    // 防穿墙：从目标向期望位置 raycast， hit 则拉近
    // 注意：排除玩家和NPC自身（它们的castShadow=true会误命中）
    const dir = desired.clone().sub(target);
    const rayLen = dir.length();
    dir.normalize();
    const ray = new THREE.Raycaster(target, dir, 1.2, rayLen); // near=1.2 跳过玩家自身
    ray.camera = this.camera; // Sprite raycast 需要 camera（NPC名字标签是Sprite）
    // 收集要排除的对象（玩家组+所有NPC组）
    const exclude = new Set<THREE.Object3D>();
    if (this.player.group) exclude.add(this.player.group);
    if (this.npcMgr) for (const n of this.npcMgr.npcs) exclude.add(n.group);
    // 只检测建筑/树木等遮挡物
    const hits = ray.intersectObjects(this.scene.children, true).filter(h => {
      const o = h.object as THREE.Mesh;
      if (!o.isMesh || !o.castShadow || h.distance >= rayLen - 0.3) return false;
      let p: THREE.Object3D | null = o;
      while (p) {
        if (exclude.has(p)) return false;
        p = p.parent;
      }
      return true;
    });
    let finalPos = desired;
    if (hits.length > 0) {
      const hitDist = Math.max(hits[0].distance - 0.5, 1.5);
      finalPos = target.clone().add(dir.multiplyScalar(hitDist));
      finalPos.y = Math.max(finalPos.y, 1.6);
    }
    this.camera.position.lerp(finalPos, 0.18);
    this.camera.lookAt(target);

    // NPC / 云 / 树冠摆动 / 木材重生
    this.npcMgr.update(dt);
    updateSwayers(this.world, this.elapsed);
    // 建造落成弹跳
    for (let i = this.popAnims.length - 1; i >= 0; i--) {
      const p = this.popAnims[i];
      p.t += dt * 3.2;
      if (p.t >= 1) { p.g.scale.setScalar(1); this.popAnims.splice(i, 1); continue; }
      const s = 0.55 + 0.45 * (1 - Math.pow(1 - p.t, 3)) + Math.sin(p.t * Math.PI) * 0.12;
      p.g.scale.setScalar(s);
    }
    for (const c of this.world.clouds) {
      c.position.x += dt * 0.7;
      if (c.position.x > 70) c.position.x = -70;
    }
    for (const w of this.world.resNodes) {
      if (!w.active) {
        w.timer -= dt;
        if (w.timer <= 0) respawnResNode(w);
      } else {
        w.group.rotation.y += dt * 0.6;
      }
    }

    // 情境按钮
    if (this.ctxBtn && !this.build.active) {
      const npc = this.npcMgr.nearest(this.player.pos);
      const ms = npc ? null : this.nearestMyShop();
      const ni = npc || ms ? -1 : this.nearestNode();
      if (npc) {
        this.ctxBtn.style.display = 'block';
        this.ctxBtn.textContent = `💬 和${npc.def.name}对话`;
      } else if (ms) {
        this.ctxBtn.style.display = 'block';
        this.ctxBtn.textContent = `🏪 管理${ms.name}`;
      } else if (ni >= 0) {
        const node = this.world.resNodes[ni];
        const d = resDef(node.kind);
        this.ctxBtn.style.display = 'block';
        this.ctxBtn.textContent = `${d?.icon ?? '📦'} 采集${d?.name ?? ''}`;
      } else {
        this.ctxBtn.style.display = 'none';
      }
    } else if (this.ctxBtn) {
      this.ctxBtn.style.display = 'none';
    }

    // 小地图（约 3fps 重绘）
    this.mapTimer += dt;
    if (this.mapTimer > 0.35 && this.minimap && this.player && this.world && this.npcMgr) {
      this.mapTimer = 0;
      this.minimap.draw(
        this.player.pos.x, this.player.pos.z, this.camYaw,
        this.npcMgr.positions(),
        this.world.resNodes.filter((w) => w.active).map((w) => ({ x: w.pos.x, z: w.pos.z, kind: w.kind })),
        this.save.buildings.map((b) => ({ x: b.x, z: b.z, type: b.type })),
      );
    }

    // 模拟经营 tick（约 18 秒一次）+ 访客点赞（约 45 秒一次）
    this.shopTimer += dt;
    if (this.shopTimer > 18) { this.shopTimer = 0; this.myShops.tick(); }
    this.likeTimer += dt;
    if (this.likeTimer > 45) { this.likeTimer = 0; this.gallery.simulateLike(); }

    // 自动存档（15 秒）
    this.saveTimer += dt;
    if (this.saveTimer > 15) { this.saveTimer = 0; this.persistSoon(); }

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  };
}
