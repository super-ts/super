import { type Commands, type ContractStore, type StoreOfContract, SuperStore } from '@super-ts/core';
import { topics } from '@super-ts/core/internal';
import { describe, expect, test } from 'vitest';
import type { StatsContract, TodosContract, WatcherContract } from './__fixtures__/todos.ts';
import './__fixtures__/todos.ts';

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
  test('send runs the handler and resolves, with no data, when it has finished', async () => {
    const store = TodosStore.create({ prefix: '- ' });
    await expect(store.send('add', { label: 'bread' })).resolves.toBeUndefined();
    expect(store.state().items).toEqual(['- bread']);
  });

  test('a synchronous command is also exposed as a promise', async () => {
    const store = TodosStore.create({ prefix: '' });
    await store.send('add', { label: 'a' });
    await expect(store.send('clear')).resolves.toBeUndefined();
    expect(store.state().items).toEqual([]);
  });

  test("an error in the handler rejects the caller's promise", async () => {
    const store = TodosStore.create({ prefix: '' });
    await expect(store.send('explode')).rejects.toThrow('boom');
  });

  test('the state is frozen and replaced on each set', async () => {
    const store = TodosStore.create({ prefix: '' });
    const before = store.state();
    await store.send('add', { label: 'a' });
    expect(store.state()).not.toBe(before);
    expect(Object.isFrozen(store.state())).toBe(true);
  });

  test('notifications are batched per microtask', async () => {
    const store = TodosStore.create({ prefix: '' });
    const seen: number[] = [];
    store.subscribe((state) => seen.push(state.items.length));

    void store.send('add', { label: 'a' });
    void store.send('add', { label: 'b' });
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    // The two `set` calls give a single notification; the end of the commands gives another (pending changed).
    expect(seen[0]).toBe(2);
    expect(seen).not.toContain(1);
  });

  test('on receives the typed payloads and unsubscribes', async () => {
    const store = TodosStore.create({ prefix: '' });
    const labels: string[] = [];
    const off = store.on('added', ({ label }) => labels.push(label));

    await store.send('add', { label: 'a' });
    off();
    await store.send('add', { label: 'b' });

    expect(labels).toEqual(['a']);
  });

  test('an aborted signal removes the listener', async () => {
    const store = TodosStore.create({ prefix: '' });
    const controller = new AbortController();
    let count = 0;
    store.on('cleared', () => count++, { signal: controller.signal });

    await store.send('clear');
    controller.abort();
    await store.send('clear');

    expect(count).toBe(1);
  });

  test('commands travel through CustomEvents prefixed by the contract', async () => {
    const store = TodosStore.create({ prefix: '' }) as EventTarget & ContractStore<TodosContract>;
    const seen: unknown[] = [];
    store.addEventListener(topics.command('core-todos', 'add'), (e) => seen.push((e as CustomEvent).detail.args));

    await store.send('add', { label: 'x' });

    expect(seen).toEqual([[{ label: 'x' }]]);
  });

  test('dispose rejects later commands and cuts off the listeners', async () => {
    const store = TodosStore.create({ prefix: '' });
    let notified = false;
    store.subscribe(() => (notified = true));

    store.dispose();

    await expect(store.send('clear')).rejects.toThrow(/disposed/);
    expect(notified).toBe(false);
  });

  test('each create starts from the initial state', async () => {
    const a = TodosStore.create({ prefix: '' });
    await a.send('add', { label: 'a' });
    expect(TodosStore.create({ prefix: '' }).state().items).toEqual([]);
  });
});

describe('store that depends on another store', () => {
  class StatsStore extends SuperStore<StatsContract> implements Commands<StatsStore> {
    constructor({ todos }: { todos: StoreOfContract<'core-todos'> }) {
      super({ contract: 'core-stats', initialState: { added: 0 } });
      // No `{ signal }`: listening stops by itself on this store's dispose().
      todos.on('added', () => this.#count());
    }

    #count() {
      this.set({ added: this.get().added + 1 });
    }
  }

  test('it reacts to the events of its dependency', async () => {
    const todos = TodosStore.create({ prefix: '' });
    const stats = StatsStore.create({ todos });

    await todos.send('add', { label: 'a' });
    await todos.send('add', { label: 'b' });

    expect(stats.state().added).toBe(2);
  });

  test('its listening to the dependency stops on its dispose(), with no signal to pass', async () => {
    const todos = TodosStore.create({ prefix: '' });
    const stats = StatsStore.create({ todos });

    await todos.send('add', { label: 'a' });
    stats.dispose();
    await todos.send('add', { label: 'b' });

    expect(stats.state().added).toBe(1);
  });

  test('the dependency remains usable as normal', async () => {
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

    expect(seen.at(-1)).toBe(1); // the dependency did receive the command, and its subscription was notified
  });
});
