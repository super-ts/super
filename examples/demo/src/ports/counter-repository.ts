/**
 * Port (user-land): what the store needs to persist the counters.
 * Super does not know about this folder: `ports/` is a choice of this project.
 */
export interface CounterRepository {
  loadAll(): Promise<Record<string, number>>;
  save(id: string, count: number): Promise<void>;
}
