/**
 * Inference tests for SuperElement: checked by `npm run typecheck`.
 */
import { html, SuperElement } from '@super-ts/dom';
import { expectTypeOf, test } from 'vitest';
import '../../core/src/__fixtures__/basket.ts';

class Dialog extends SuperElement<{ props: { question: string }; emits: { answered: { confirmed: boolean }; closed: void } }> {
  static tag = 't-dialog';
  render() {
    // @ts-expect-error undeclared event
    this.emit('nope');
    // @ts-expect-error payload required
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

test('create: typed props and listeners, tag required', () => {
  Dialog.create({ question: 'ok?' }, { on: { answered: ({ confirmed }) => expectTypeOf(confirmed).toEqualTypeOf<boolean>() } });
  // @ts-expect-error required props
  Dialog.create();
  // @ts-expect-error wrongly typed prop
  Dialog.create({ question: 42 });
  // @ts-expect-error listener for an event the child does not emit
  Dialog.create({ question: 'ok?' }, { on: { nope: () => {} } });
  // @ts-expect-error `static tag` missing
  NoTag.create();
});

test('contract, selector: typed by the contract registry', () => {
  class Screen extends SuperElement<{ props: { sku: string; show: boolean } }> {
    static tag = 't-screen';
    basket = this.contract('basket');
    count = this.selector(this.basket.selectors.count);
    // @ts-expect-error a selector with a parameter is read in a function
    raw = this.selector(this.basket.selectors.quantity);
    // @ts-expect-error no 'shopping-cart' contract
    other = this.contract('shopping-cart');
    mugs = this.selector(() => this.basket.selectors.quantity(this.props.sku));
    entries = this.selector(this.basket.selectors.entries);
    saved = this.selector(this.basket.selectors.lastSaved);
    // @ts-expect-error 0 does not come from a selector: the condition goes in render
    shown = this.selector(() => (this.props.show ? this.basket.selectors.count() : 0));
    // @ts-expect-error a computation on the value goes in render (or in a contract selector)
    double = this.selector(() => this.basket.selectors.count() * 2);
    // @ts-expect-error a derived array is no longer the selector's value
    skus = this.selector(() => this.basket.selectors.entries().map(([sku]) => sku));
    // @ts-expect-error no selector
    constant = this.selector(() => 42);

    render() {
      expectTypeOf(this.count.value).toEqualTypeOf<number>();
      expectTypeOf(this.mugs.value).toEqualTypeOf<number>();
      expectTypeOf(this.entries.value).toEqualTypeOf<[string, number][]>();
      expectTypeOf(this.saved.value).toEqualTypeOf<string | null>();
      // Read directly, a selector's value is used like an ordinary number.
      const total: number = this.basket.selectors.count() * 2;
      void total;
      this.basket.send('add', { sku: 'mug' });
      // @ts-expect-error wrongly typed body
      this.basket.send('add', { sku: 1 });
      // @ts-expect-error unknown command
      this.basket.send('nope');
      this.basket.on('saved', ({ id }) => expectTypeOf(id).toEqualTypeOf<string>());
      this.basket.on('save:failed', ({ reason }) => expectTypeOf(reason).toEqualTypeOf<'empty' | 'offline' | 'error'>());
      // @ts-expect-error the raw state is not exposed
      this.basket.state();
      return html``;
    }
  }
  void Screen;
});
