import { type Commands, SuperStore } from '@super-ts/core';
import { MIN_COUNT } from '../../domain/counter';
import type { CounterRepository } from '../../ports/counter-repository';
import type { CounterContract } from './contract';

/** Les dépendances sont ce que tu veux : Super ne les inspecte jamais. */
type Deps = { counterRepository: CounterRepository };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Pas de drapeau « en cours » ni d'événement à émettre : Super suit chaque commande et publie son
// issue. Le handler fait son travail, échoue avec `this.fail(raison)`, ou retourne son résultat.
export class CounterStore extends SuperStore<CounterContract> implements Commands<CounterStore> {
  #repository: CounterRepository;

  constructor({ counterRepository }: Deps) {
    super({ contract: 'counter', initialState: { counts: {}, loadErrorMessage: null } });
    this.#repository = counterRepository;
  }

  // L'erreur de chargement reste dans l'état : elle doit rester visible, même pour un écran monté plus tard.
  async load() {
    this.set({ loadErrorMessage: null });
    try {
      this.set({ counts: await this.#repository.loadAll() });
    } catch (error) {
      this.set({ loadErrorMessage: message(error) });
    }
  }

  increment({ id }: { id: string }) {
    return this.#write(id, this.selectors.count(id) + 1);
  }

  decrement({ id }: { id: string }) {
    if (this.selectors.find(id) && this.selectors.count(id) <= MIN_COUNT) this.fail('below-min');
    return this.#write(id, this.selectors.count(id) - 1);
  }

  reset({ id }: { id: string }) {
    return this.#write(id, MIN_COUNT);
  }

  /** Le code commun aux trois écritures : une méthode privée, pas une commande. */
  async #write(id: string, next: number) {
    if (!this.selectors.find(id)) this.fail('unknown');
    await this.#repository.save(id, next).catch(() => this.fail('storage'));
    this.set((s) => ({ counts: { ...s.counts, [id]: next } }));
    return { count: next };
  }
}
