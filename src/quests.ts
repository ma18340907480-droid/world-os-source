// WORLD OS Alpha 0.1 · 任务系统
import { QUESTS, type QuestDef } from './data';
import { toast, renderQuestTracker, type QuestHUDItem } from './ui';
import type { SaveData } from './save';

export class QuestManager {
  private save: SaveData;
  private onCoins: (n: number) => void;
  private onXp: (n: number) => void;

  constructor(save: SaveData, onCoins: (n: number) => void, onXp: (n: number) => void = () => {}) {
    this.save = save;
    this.onCoins = onCoins;
    this.onXp = onXp;
  }

  def(id: string): QuestDef { return QUESTS.find((q) => q.id === id)!; }

  start(id: string) {
    if (!this.save.quests[id]) {
      this.save.quests[id] = 'active';
      this.save.progress[id] = 0;
      toast(`📌 新任务：${this.def(id).name}`);
      this.refreshHUD();
    }
  }

  addProgress(id: string, n = 1) {
    if (this.save.quests[id] !== 'active') return;
    const d = this.def(id);
    this.save.progress[id] = Math.min(d.target, (this.save.progress[id] ?? 0) + n);
    if (this.save.progress[id] >= d.target) this.complete(id);
    else this.refreshHUD();
  }

  complete(id: string) {
    if (this.save.quests[id] === 'done') return;
    this.save.quests[id] = 'done';
    const d = this.def(id);
    this.onCoins(d.rewardCoins);
    this.onXp(40);
    toast(`🎉 任务完成：${d.name}\n${d.rewardText} · 经验+40`);
    // 任务链
    if (id === 'q1') this.start('q2');
    if (id === 'q2') this.start('q3');
    if (id === 'q3') this.start('q4');
    if (id === 'q4') this.start('q5');
    this.refreshHUD();
  }

  isDone(id: string): boolean { return this.save.quests[id] === 'done'; }
  isActive(id: string): boolean { return this.save.quests[id] === 'active'; }
  buildUnlocked(): boolean { return this.isDone('q2'); }

  hudItems(): QuestHUDItem[] {
    return QUESTS.filter((q) => this.save.quests[q.id]).map((q) => ({
      name: q.name, desc: q.desc,
      prog: this.save.progress[q.id] ?? 0, target: q.target,
      done: this.save.quests[q.id] === 'done',
    }));
  }

  refreshHUD() { renderQuestTracker(this.hudItems()); }
}
