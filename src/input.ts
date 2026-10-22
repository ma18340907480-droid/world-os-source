// WORLD OS Alpha 0.1 · 触屏输入：左侧虚拟摇杆移动 + 右侧滑动转视角 + 点击
export class Input {
  /** 摇杆输入：forward 前进量(-1..1)，strafe 左右量(-1..1) */
  moveF = 0; moveS = 0;
  /** 视角增量（每帧消费） */
  lookDX = 0; lookDY = 0;
  onTap: ((nx: number, ny: number) => void) | null = null;

  private joyId: number | null = null;
  private joyCX = 0; private joyCY = 0;
  private lookId: number | null = null;
  private lookLX = 0; private lookLY = 0;
  private downT = 0; private downX = 0; private downY = 0;
  private keys = new Set<string>();
  /** 建造/拆除模式锁定：为 true 时不启用摇杆，所有触摸都走点选 */
  public uiLock = false;
  // 摇杆 DOM 用 getter 懒查找：HUD 重建后引用不失效
  private get joyBase(): HTMLElement { return document.getElementById('joy-base')!; }
  private get joyKnob(): HTMLElement { return document.getElementById('joy-knob')!; }

  constructor(canvas: HTMLCanvasElement) {
    canvas.addEventListener('touchstart', (e) => this.ts(e), { passive: false });
    canvas.addEventListener('touchmove', (e) => this.tm(e), { passive: false });
    canvas.addEventListener('touchend', (e) => this.te(e), { passive: false });
    canvas.addEventListener('touchcancel', (e) => this.te(e), { passive: false });

    // 桌面调试：WASD 移动 + 鼠标右键拖拽转视角
    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    let mDown = false, mLX = 0, mLY = 0;
    canvas.addEventListener('mousedown', (e) => { mDown = true; mLX = e.clientX; mLY = e.clientY; });
    window.addEventListener('mousemove', (e) => {
      if (!mDown) return;
      this.lookDX += (e.clientX - mLX) * 0.006;
      this.lookDY += (e.clientY - mLY) * 0.006;
      mLX = e.clientX; mLY = e.clientY;
    });
    window.addEventListener('mouseup', (e) => {
      mDown = false;
      // 桌面点击 = tap
      if (this.onTap && Math.abs(e.clientX - mLX) < 6 && Math.abs(e.clientY - mLY) < 6) {
        this.onTap(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
      }
    });
  }

  private ts(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < window.innerWidth * 0.45 && this.joyId === null && !this.uiLock) {
        this.joyId = t.identifier;
        this.joyCX = t.clientX; this.joyCY = t.clientY;
        this.joyBase.style.display = 'block';
        this.joyBase.style.left = `${t.clientX - 60}px`;
        this.joyBase.style.top = `${t.clientY - 60}px`;
        // 第一次推动摇杆：藏掉新手提示
        document.getElementById('move-hint')?.remove();
        this.downT = performance.now(); this.downX = t.clientX; this.downY = t.clientY;
      } else if (this.lookId === null) {
        this.lookId = t.identifier;
        this.lookLX = t.clientX; this.lookLY = t.clientY;
        this.downT = performance.now(); this.downX = t.clientX; this.downY = t.clientY;
      }
    }
  }

  private tm(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.joyId) {
        let dx = t.clientX - this.joyCX, dy = t.clientY - this.joyCY;
        const len = Math.hypot(dx, dy), max = 48;
        if (len > max) { dx = dx / len * max; dy = dy / len * max; }
        this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        this.moveF = -dy / max;
        this.moveS = dx / max;
      } else if (t.identifier === this.lookId) {
        this.lookDX += (t.clientX - this.lookLX) * 0.007;
        this.lookDY += (t.clientY - this.lookLY) * 0.007;
        this.lookLX = t.clientX; this.lookLY = t.clientY;
      }
    }
  }

  private te(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.joyId) {
        this.joyId = null; this.moveF = 0; this.moveS = 0;
        this.joyBase.style.display = 'none';
        this.joyKnob.style.transform = 'translate(-50%,-50%)';
      } else if (t.identifier === this.lookId) {
        const dt = performance.now() - this.downT;
        const moved = Math.hypot(t.clientX - this.downX, t.clientY - this.downY);
        if (dt < 300 && moved < 12 && this.onTap) {
          this.onTap(t.clientX / window.innerWidth, t.clientY / window.innerHeight);
        }
        this.lookId = null;
      }
    }
  }

  /** 强制重置触摸状态（iOS 上弹窗出现时活动触摸可能丢失，导致 joyId 卡死） */
  resetTouch() {
    this.joyId = null; this.lookId = null;
    this.moveF = 0; this.moveS = 0;
    this.lookDX = 0; this.lookDY = 0;
    const base = document.getElementById('joy-base');
    if (base) base.style.display = 'none';
    const knob = document.getElementById('joy-knob');
    if (knob) knob.style.transform = 'translate(-50%,-50%)';
  }

  /** 桌面键盘移动量（叠加到摇杆） */
  keyMove(): { f: number; s: number } {
    let f = 0, s = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) f += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) f -= 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) s -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) s += 1;
    return { f, s };
  }

  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0; this.lookDY = 0;
    return r;
  }
}
