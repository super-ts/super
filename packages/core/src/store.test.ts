import { type Commands, type ContractStore, type StoreOfContract, SuperStore } from '@super-ts/core';
import { topics } from '@super-ts/core/internal';
import { describe, expect, test } from 'vitest';
import type { StatsContract, TodosContract, WatcherContract } from './__fixtures__/todos';
import './__fixtures__/todos';

class TodosStore extends SuperStore<TodosContract> implements Commands<TodosStore> {
  #prefix: string;

  constructor({ prefix }: { prefix: string }) {
    super({ contract: 'core-todos', initialState: { items: [], filter: 'all' } });
    this.#prefix = prefix;
  }

  async add({ label }: { label: string }) {
    this.set({ items: [...this.get().items, this.#prefix + label] });
    this.emit('added', { label });
  }

  clear() {
    this.set({ items: [] });
    this.emit('cleared');
  }

  async explode() {
    throw new Error('boom');
  }
}

describe('SuperStore', () => {
  test('send exécute le handler et se résout, sans donnée, quand il a fini', async () => {
    const store = TodosStore.create({ prefix: '- ' });
    await expect(store.send('add', { label: 'pain' })).resolves.toBeUndefined();
    expect(store.state().items).toEqual(['- pain']);
  });

  test('une commande synchrone est aussi exposée sous forme de promesse', async () => {
    const store = TodosStore.create({ prefix: '' });
    await store.send('add', { label: 'a' });
    await expect(store.send('clear')).resolves.toBeUndefined();
    expect(store.state().items).toEqual([]);
  });

  test("une erreur du handler rejette la promesse de l'appelant", async () => {
    const store = TodosStore.create({ prefix: '' });
    await expect(store.send('explode')).rejects.toThrow('boom');
  });

  test("l'état est figé et remplacé à chaque set", async () => {
    const store = TodosStore.create({ prefix: '' });
    const before = store.state();
    await store.send('add', { label: 'a' });
    expect(store.state()).not.toBe(before);
    expect(Object.isFrozen(store.state())).toBe(true);
  });

  test('les notifications sont regroupées par microtask', async () => {
    const store = TodosStore.create({ prefix: '' });
    const seen: number[] = [];
    store.subscribe((state) => seen.push(state.items.length));

    void store.send('add', { label: 'a' });
    void store.send('add', { label: 'b' });
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    // Les deux `set` donnent une seule notification ; la fin des commandes en donne une autre (pending a changé).
    expect(seen[0]).toBe(2);
    expect(seen).not.toContain(1);
  });

  test('on reçoit les payloads typés et se désabonne', async () => {
    const store = TodosStore.create({ prefix: '' });
    const labels: string[] = [];
    const off = store.on('added', ({ label }) => labels.push(label));

    await store.send('add', { label: 'a' });
    off();
    await store.send('add', { label: 'b' });

    expect(labels).toEqual(['a']);
  });

  test('un signal avorté retire l’écouteur', async () => {
    const store = TodosStore.create({ prefix: '' });
    const controller = new AbortController();
    let count = 0;
    store.on('cleared', () => count++, { signal: controller.signal });

    await store.send('clear');
    controller.abort();
    await store.send('clear');

    expect(count).toBe(1);
  });

  test('les commandes transitent par des CustomEvent préfixés par le contrat', async () => {
    const store = TodosStore.create({ prefix: '' }) as EventTarget & ContractStore<TodosContract>;
    const seen: unknown[] = [];
    store.addEventListener(topics.command('core-todos', 'add'), (e) => seen.push((e as CustomEvent).detail.args));

    await store.send('add', { label: 'x' });

    expect(seen).toEqual([[{ label: 'x' }]]);
  });

  test('dispose refuse les commandes suivantes et coupe les écouteurs', async () => {
    const store = TodosStore.create({ prefix: '' });
    let notified = false;
    store.subscribe(() => (notified = true));

    store.dispose();

    await expect(store.send('clear')).rejects.toThrow(/disposé/);
    expect(notified).toBe(false);
  });

  test('chaque create part de l’état initial', async () => {
    const a = TodosStore.create({ prefix: '' });
    await a.send('add', { label: 'a' });
    expect(TodosStore.create({ prefix: '' }).state().items).toEqual([]);
  });
});

describe('store qui dépend d’un autre store', () => {
  class StatsStore extends SuperStore<StatsContract> implements Commands<StatsStore> {
    constructor({ todos }: { todos: StoreOfContract<'core-todos'> }) {
      super({ contract: 'core-stats', initialState: { added: 0 } });
      // Pas de `{ signal }` : l'écoute s'arrête d'elle-même au dispose() de ce store.
      todos.on('added', () => this.#count());
    }

    #count() {
      this.set({ added: this.get().added + 1 });
    }
  }

  test('il réagit aux événements de sa dépendance', async () => {
    const todos = TodosStore.create({ prefix: '' });
    const stats = StatsStore.create({ todos });

    await todos.send('add', { label: 'a' });
    await todos.send('add', { label: 'b' });

    expect(stats.state().added).toBe(2);
  });

  test('son écoute de la dépendance s’arrête à son dispose(), sans signal à passer', async () => {
    const todos = TodosStore.create({ prefix: '' });
    const stats = StatsStore.create({ todos });

    await todos.send('add', { label: 'a' });
    stats.dispose();
    await todos.send('add', { label: 'b' });

    expect(stats.state().added).toBe(1);
  });

  test('la dépendance reste utilisable normalement', async () => {
    const seen: number[] = [];

    class WatcherStore extends SuperStore<WatcherContract> implements Commands<WatcherStore> {
      #todos: StoreOfContract<'core-todos'>;

      constructor({ todos }: { todos: StoreOfContract<'core-todos'> }) {
        super({ contract: 'core-watcher', initialState: {} });
        this.#todos = todos;
        todos.subscribe((state) => seen.push(state.items.length));
      }

      add(label: string) {
        return this.#todos.send('add', { label });
      }
    }

    const watcher = WatcherStore.create({ todos: TodosStore.create({ prefix: '' }) });

    await watcher.send('add', 'a');
    await new Promise((resolve) => setTimeout(resolve, 0));
    watcher.dispose();

    expect(seen.at(-1)).toBe(1); // la dépendance a bien reçu la commande, et son abonnement a été notifié
  });
});
