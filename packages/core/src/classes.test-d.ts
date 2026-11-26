/**
 * Class API inference tests: checked by `npm run typecheck`. Each `@ts-expect-error` fails the
 * compilation if the expected error disappears.
 */

import { type Commands, type StoreOfContract, SuperContract, SuperStore } from '@super-ts/core';
import { expectTypeOf, test } from 'vitest';
import type { BasketContract, BasketState } from './__fixtures__/basket.ts';

const init = { contract: 'basket', initialState: { items: {} } } as const;

class Ok extends SuperStore<BasketContract> implements Commands<Ok> {
  constructor() {
    super(init);
  }
  add({ sku }: { sku: string }) {
    this.set({ items: { [sku]: this.selectors.quantity(sku) + 1 } });
  }
  clear() {}
  async save({ id }: { id: string }) {
    this.emit('saved', { id });
    return { count: this.selectors.count() };
  }
  #helper() {}
}

test('create returns the typed handle of the contract', () => {
  const basket = Ok.create();
  expectTypeOf(basket).toEqualTypeOf<StoreOfContract<'basket'>>();
  expectTypeOf(basket.selectors.quantity('mug')).toEqualTypeOf<number>();
  expectTypeOf(basket.state()).toEqualTypeOf<Readonly<BasketState>>();
  // @ts-expect-error the instance does not leave the store: no add method on the handle
  basket.add({ sku: 'mug' });
  // @ts-expect-error wrongly typed body
  basket.send('add', { sku: 42 });
  // @ts-expect-error selector parameter required
  basket.selectors.quantity();
});

test('a handler with narrower parameters than the contract does not compile', () => {
  class Narrow extends SuperStore<BasketContract> implements Commands<Narrow> {
    constructor() {
      super(init);
    }
    // @ts-expect-error parameters differ from the contract's
    add(_: { sku: 'mug' }) {}
    clear() {}
    async save(_: { id: string }) {
      return { count: 0 };
    }
  }
});

test('a handler that returns undeclared data does not compile', () => {
  class Returns extends SuperStore<BasketContract> implements Commands<Returns> {
    constructor() {
      super(init);
    }
    add(_: { sku: string }) {}
    // @ts-expect-error clear is declared void
    clear() {
      return 42;
    }
    // @ts-expect-error the declared result is { count: number }
    async save(_: { id: string }) {
      return { total: 0 };
    }
  }
});

test('a missing command does not compile', () => {
  // @ts-expect-error clear and save are missing
  class Missing extends SuperStore<BasketContract> implements Commands<Missing> {
    constructor() {
      super(init);
    }
    add(_: { sku: string }) {}
  }
});

test('a public method outside the contract does not compile: a helper is written as #private', () => {
  class Extra extends SuperStore<BasketContract> implements Commands<Extra> {
    constructor() {
      super(init);
    }
    add(_: { sku: string }) {}
    clear() {}
    async save(_: { id: string }) {
      return { count: 0 };
    }
    // @ts-expect-error public method outside the contract
    increment() {}
  }
});

test('super() checks the contract name and the initial state', () => {
  class BadName extends SuperStore<BasketContract> {
    constructor() {
      // @ts-expect-error no 'cart' contract
      super({ contract: 'cart', initialState: { items: {} } });
    }
  }
  class BadState extends SuperStore<BasketContract> {
    constructor() {
      // @ts-expect-error initialState does not match the contract state
      super({ contract: 'basket', initialState: { items: 'none' } });
    }
  }
});

test('emit, fail and send are typed by the contract', () => {
  class Tools extends SuperStore<BasketContract> {
    constructor() {
      super(init);
    }
    run() {
      // @ts-expect-error unknown event
      this.emit('nope');
      // @ts-expect-error payload required
      this.emit('saved');
      // @ts-expect-error undeclared failure reason
      this.fail('nope');
      // @ts-expect-error unknown command
      void this.send('nope');
      void this.send('add', { sku: 'mug' });
    }
  }
});

test('the constructor dependencies are required by create', () => {
  class WithDeps extends SuperStore<BasketContract> {
    constructor(_: { backend: string }) {
      super(init);
    }
  }
  // @ts-expect-error missing dependency
  WithDeps.create();
  WithDeps.create({ backend: 'x' });
});

test('an unknown key in the types of a contract is rejected (typo)', () => {
  class Typo extends SuperContract<{ state: {}; command: { add(): void } }> {
    constructor() {
      // @ts-expect-error unknown key in the contract types: command
      super({ name: 'typo' });
    }
  }
  void Typo;
});

test('selectors are checked at the store declaration', () => {
  type State = { items: string[] };
  class Good extends SuperContract<{ state: State }> {
    constructor() {
      super({ name: 'good' });
    }
    count(s: State) {
      return s.items.length;
    }
    has(s: { items: readonly string[] }, item: string) {
      return s.items.includes(item); // a type compatible with the state is enough
    }
    constant() {
      return 42; // no parameter: it ignores the state
    }
  }
  class WrongState extends SuperContract<{ state: State }> {
    constructor() {
      super({ name: 'wrong-state' });
    }
    count(s: { total: number }) {
      return s.total;
    }
  }
  class Pending extends SuperContract<{ state: State }> {
    constructor() {
      super({ name: 'pending' });
    }
    pending(_s: State) {
      return false;
    }
  }
  abstract class GoodStore extends SuperStore<Good> {}
  // @ts-expect-error the first parameter of a selector is the contract state
  abstract class WrongStore extends SuperStore<WrongState> {}
  // @ts-expect-error "pending" is reserved
  abstract class PendingStore extends SuperStore<Pending> {}
  void [GoodStore, WrongStore, PendingStore];
});
