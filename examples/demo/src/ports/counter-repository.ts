/**
 * Port (user-land) : ce dont le store a besoin pour persister les compteurs.
 * Super ne connaît pas ce dossier : `ports/` est un choix de ce projet.
 */
export interface CounterRepository {
  loadAll(): Promise<Record<string, number>>;
  save(id: string, count: number): Promise<void>;
}
