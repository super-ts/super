import { SuperContract } from '@super-ts/core';
import type { LoggedError } from '../../domain/error-log';

export type ErrorLogState = { entries: readonly LoggedError[] };

/** Les erreurs reçues par `onError`, pour les afficher dans l'exemple « Erreurs ». */
export class ErrorLogContract extends SuperContract<{
  state: ErrorLogState;
  commands: { record(input: LoggedError): void; clear(): void };
}> {
  constructor() {
    super({ name: 'error-log' });
  }

  entries(s: ErrorLogState) {
    return s.entries;
  }
}
