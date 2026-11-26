import { type Commands, SuperStore } from '@super-ts/core';
import type { TimerContract } from './contract';

export class TimerStore extends SuperStore<TimerContract> implements Commands<TimerStore> {
  constructor() {
    super({ contract: 'timer', initialState: { seconds: 0, running: false } });
  }

  toggle() {
    this.set({ running: !this.get().running });
  }

  // Appelée chaque seconde par le composant : n'avance que si le minuteur tourne.
  tick() {
    if (this.get().running) this.set({ seconds: this.get().seconds + 1 });
  }

  reset() {
    this.set({ seconds: 0, running: false });
  }
}
