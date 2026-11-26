import { type Commands, SuperStore } from '@super-ts/core';
import type { LoggedError } from '../../domain/error-log';
import type { ErrorLogContract } from './contract';

export class ErrorLogStore extends SuperStore<ErrorLogContract> implements Commands<ErrorLogStore> {
  constructor() {
    super({ contract: 'error-log', initialState: { entries: [] } });
  }

  record(entry: LoggedError) {
    this.set({ entries: [entry, ...this.get().entries].slice(0, 20) });
  }

  clear() {
    this.set({ entries: [] });
  }
}
