// WORLD OS Alpha 0.1 · UI 基础组件（DOM）
export function el(tag: string, cls = '', html = ''): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function toast(msg: string, ms = 2200) {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) {
    wrap = el('div');
    wrap.id = 'toast-wrap';
    document.getElementById('ui')!.appendChild(wrap);
  }
  const t = el('div', 'toast', msg);
  wrap.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, ms);
}

export interface ChoiceDef { label: string; cb: () => void }

export function showDialog(name: string, title: string, text: string, choices: ChoiceDef[]) {
  closeDialog();
  const ui = document.getElementById('ui')!;
  const sheet = el('div', 'sheet');
  sheet.id = 'dialog-sheet';
  sheet.appendChild(el('div', 'dlg-name', `${name} · ${title}`));
  sheet.appendChild(el('div', 'dlg-text', text.replace(/\n/g, '<br>')));
  const box = el('div', 'dlg-choices');
  for (const c of choices) {
    const b = el('button', 'btn', c.label) as HTMLButtonElement;
    b.onclick = () => c.cb();
    box.appendChild(b);
  }
  sheet.appendChild(box);
  sheet.appendChild(el('div', 'dlg-note', '※ 本版本 NPC 为脚本化台词，非真 AI 对话'));
  ui.appendChild(sheet);
}

export function closeDialog() {
  document.getElementById('dialog-sheet')?.remove();
}

export function openPanel(title: string): HTMLElement {
  closePanel();
  const ui = document.getElementById('ui')!;
  const wrap = el('div', 'panel-wrap');
  wrap.id = 'panel-wrap';
  const panel = el('div', 'panel');
  const head = el('div', 'panel-head', `<span>${title}</span>`);
  const close = el('button', 'panel-close', '✕') as HTMLButtonElement;
  close.onclick = () => closePanel();
  head.appendChild(close);
  const body = el('div', 'panel-body');
  panel.appendChild(head);
  panel.appendChild(body);
  wrap.appendChild(panel);
  wrap.addEventListener('touchstart', (e) => { if (e.target === wrap) closePanel(); }, { passive: true });
  ui.appendChild(wrap);
  return body;
}

export function closePanel() {
  document.getElementById('panel-wrap')?.remove();
}

export function isPanelOpen(): boolean {
  return !!document.getElementById('panel-wrap');
}

export function setCoins(n: number) {
  const c = document.getElementById('coins');
  if (c) c.innerHTML = `🪙 ${n}`;
}

export interface QuestHUDItem { name: string; desc: string; prog: number; target: number; done: boolean }

export function renderQuestTracker(items: QuestHUDItem[]) {
  let t = document.getElementById('quest-tracker');
  if (!t) {
    t = el('div');
    t.id = 'quest-tracker';
    document.getElementById('ui')!.appendChild(t);
  }
  const active = items.filter((i) => !i.done);
  if (active.length === 0) {
    t.innerHTML = '<span class="q-name">🎉 所有任务完成！</span>';
    return;
  }
  const q = active[0];
  const pct = q.target > 0 ? Math.min(100, Math.round((q.prog / q.target) * 100)) : 0;
  t.innerHTML = `<div class="q-name">📌 ${q.name}</div><div class="q-prog">${q.desc} · ${q.prog}/${q.target}</div><div class="q-bar"><div class="q-fill" style="width:${pct}%"></div></div>`;
}
