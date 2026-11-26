import { SuperContract } from '@super-ts/core';

export type TimerState = { seconds: number; running: boolean };

export type TimerTypes = {
  state: TimerState;
  commands: { toggle(): void; tick(): void; reset(): void };
};

export class TimerContract extends SuperContract<TimerTypes> {
  constructor() {
    super({ name: 'timer' });
  }

  running(s: TimerState) {
    return s.running;
  }
  label(s: TimerState) {
    return `${String(Math.floor(s.seconds / 60)).padStart(2, '0')}:${String(s.seconds % 60).padStart(2, '0')}`;
  }
}
