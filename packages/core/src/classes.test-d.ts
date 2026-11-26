/**
 * Tests d'inférence de l'API à classes : vérifiés par `npm run typecheck`. Chaque
 * `@ts-expect-error` échoue la compilation si l'erreur attendue disparaît.
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

test('create renvoie le handle typé du contrat', () => {
  const basket = Ok.create();
  expectTypeOf(basket).toEqualTypeOf<StoreOfContract<'basket'>>();
  expectTypeOf(basket.selectors.quantity('mug')).toEqualTypeOf<number>();
  expectTypeOf(basket.state()).toEqualTypeOf<Readonly<BasketState>>();
  // @ts-expect-error l'instance ne sort pas : pas de méthode add sur le handle
  basket.add({ sku: 'mug' });
  // @ts-expect-error body mal typé
  basket.send('add', { sku: 42 });
  // @ts-expect-error paramètre du sélecteur requis
  basket.selectors.quantity();
});

test('un handler aux paramètres plus étroits que le contrat ne compile pas', () => {
  class Narrow extends SuperStore<BasketContract> implements Commands<Narrow> {
    constructor() {
      super(init);
    }
    // @ts-expect-error paramètres différents de ceux du contrat
    add(_: { sku: 'mug' }) {}
    clear() {}
    async save(_: { id: string }) {
      return { count: 0 };
    }
  }
});

test('un handler qui renvoie une donnée non déclarée ne compile pas', () => {
  class Returns extends SuperStore<BasketContract> implements Commands<Returns> {
    constructor() {
      super(init);
    }
    add(_: { sku: string }) {}
    // @ts-expect-error clear est déclaré void
    clear() {
      return 42;
    }
    // @ts-expect-error le résultat déclaré est { count: number }
    async save(_: { id: string }) {
      return { total: 0 };
    }
  }
});

test('une commande manquante ne compile pas', () => {
  // @ts-expect-error clear et save manquent
  class Missing extends SuperStore<BasketContract> implements Commands<Missing> {
    constructor() {
      super(init);
    }
    add(_: { sku: string }) {}
  }
});

test('une méthode publique hors contrat ne compile pas : un helper s’écrit en #privé', () => {
  class Extra extends SuperStore<BasketContract> implements Commands<Extra> {
    constructor() {
      super(init);
    }
    add(_: { sku: string }) {}
    clear() {}
    async save(_: { id: string }) {
      return { count: 0 };
    }
    // @ts-expect-error méthode publique hors contrat
    increment() {}
  }
});

test('super() vérifie le nom du contrat et l’état initial', () => {
  class BadName extends SuperStore<BasketContract> {
    constructor() {
      // @ts-expect-error aucun contrat 'panier'
      super({ contract: 'panier', initialState: { items: {} } });
    }
  }
  class BadState extends SuperStore<BasketContract> {
    constructor() {
      // @ts-expect-error initialState ne respecte pas le state du contrat
      super({ contract: 'basket', initialState: { items: 'aucun' } });
    }
  }
});

test('emit, fail et send sont typés par le contrat', () => {
  class Tools extends SuperStore<BasketContract> {
    constructor() {
      super(init);
    }
    run() {
      // @ts-expect-error événement inconnu
      this.emit('nope');
      // @ts-expect-error payload requis
      this.emit('saved');
      // @ts-expect-error raison d'échec non déclarée
      this.fail('nope');
      // @ts-expect-error commande inconnue
      void this.send('nope');
      void this.send('add', { sku: 'mug' });
    }
  }
});

test('les dépendances du constructeur sont exigées par create', () => {
  class WithDeps extends SuperStore<BasketContract> {
    constructor(_: { backend: string }) {
      super(init);
    }
  }
  // @ts-expect-error dépendance manquante
  WithDeps.create();
  WithDeps.create({ backend: 'x' });
});

test('une clé inconnue dans les types d’un contrat est refusée (faute de frappe)', () => {
  class Typo extends SuperContract<{ state: {}; command: { add(): void } }> {
    constructor() {
      // @ts-expect-error clé inconnue dans les types du contrat : command
      super({ name: 'typo' });
    }
  }
  void Typo;
});

test('les sélecteurs sont vérifiés à la déclaration du store', () => {
  type State = { items: string[] };
  class Good extends SuperContract<{ state: State }> {
    constructor() {
      super({ name: 'good' });
    }
    count(s: State) {
      return s.items.length;
    }
    has(s: { items: readonly string[] }, item: string) {
      return s.items.includes(item); // un type compatible avec l'état suffit
    }
    constant() {
      return 42; // sans paramètre : il ignore l'état
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
  // @ts-expect-error le premier paramètre d'un sélecteur est l'état du contrat
  abstract class WrongStore extends SuperStore<WrongState> {}
  // @ts-expect-error « pending » est réservé
  abstract class PendingStore extends SuperStore<Pending> {}
  void [GoodStore, WrongStore, PendingStore];
});
