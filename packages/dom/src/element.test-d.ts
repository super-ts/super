/**
 * Tests d'inférence de SuperElement : vérifiés par `npm run typecheck`.
 */
import { html, SuperElement } from '@super-ts/dom';
import { expectTypeOf, test } from 'vitest';
import '../../core/src/__fixtures__/basket';

class Dialog extends SuperElement<{ props: { question: string }; emits: { answered: { confirmed: boolean }; closed: void } }> {
  static tag = 't-dialog';
  render() {
    // @ts-expect-error événement non déclaré
    this.emit('nope');
    // @ts-expect-error payload requis
    this.emit('answered');
    this.emit('closed');
    expectTypeOf(this.props.question).toEqualTypeOf<string>();
    return html``;
  }
}

class NoTag extends SuperElement {
  render() {
    return html``;
  }
}

test('create : props et écouteurs typés, tag obligatoire', () => {
  Dialog.create({ question: 'ok ?' }, { on: { answered: ({ confirmed }) => expectTypeOf(confirmed).toEqualTypeOf<boolean>() } });
  // @ts-expect-error props requises
  Dialog.create();
  // @ts-expect-error prop mal typée
  Dialog.create({ question: 42 });
  // @ts-expect-error écouteur pour un événement que l'enfant n'émet pas
  Dialog.create({ question: 'ok ?' }, { on: { nope: () => {} } });
  // @ts-expect-error `static tag` manquant
  NoTag.create();
});

test('contract, selector : typés par le registre des contrats', () => {
  class Screen extends SuperElement<{ props: { sku: string; show: boolean } }> {
    static tag = 't-screen';
    basket = this.contract('basket');
    count = this.selector(this.basket.selectors.count);
    // @ts-expect-error un sélecteur à paramètre se lit dans une fonction
    raw = this.selector(this.basket.selectors.quantity);
    // @ts-expect-error aucun contrat 'panier'
    other = this.contract('panier');
    mugs = this.selector(() => this.basket.selectors.quantity(this.props.sku));
    entries = this.selector(this.basket.selectors.entries);
    saved = this.selector(this.basket.selectors.lastSaved);
    // @ts-expect-error 0 ne vient pas d'un sélecteur : la condition se fait dans render
    shown = this.selector(() => (this.props.show ? this.basket.selectors.count() : 0));
    // @ts-expect-error un calcul sur la valeur se fait dans render (ou dans un sélecteur du contrat)
    double = this.selector(() => this.basket.selectors.count() * 2);
    // @ts-expect-error un tableau dérivé n'est plus la valeur du sélecteur
    skus = this.selector(() => this.basket.selectors.entries().map(([sku]) => sku));
    // @ts-expect-error aucun sélecteur
    constant = this.selector(() => 42);

    render() {
      expectTypeOf(this.count.value).toEqualTypeOf<number>();
      expectTypeOf(this.mugs.value).toEqualTypeOf<number>();
      expectTypeOf(this.entries.value).toEqualTypeOf<[string, number][]>();
      expectTypeOf(this.saved.value).toEqualTypeOf<string | null>();
      // Lue directement, la valeur d'un sélecteur s'utilise comme un nombre ordinaire.
      const total: number = this.basket.selectors.count() * 2;
      void total;
      this.basket.send('add', { sku: 'mug' });
      // @ts-expect-error body mal typé
      this.basket.send('add', { sku: 1 });
      // @ts-expect-error commande inconnue
      this.basket.send('nope');
      this.basket.on('saved', ({ id }) => expectTypeOf(id).toEqualTypeOf<string>());
      this.basket.on('save:failed', ({ reason }) => expectTypeOf(reason).toEqualTypeOf<'empty' | 'offline' | 'error'>());
      // @ts-expect-error l'état brut n'est pas exposé
      this.basket.state();
      return html``;
    }
  }
  void Screen;
});
