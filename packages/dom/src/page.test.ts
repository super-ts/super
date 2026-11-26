import { type Commands, SuperStore } from '@super-ts/core';
import { createRouter, defineRouter, html, SuperElement } from '@super-ts/dom';
import { flush, mount } from '@super-ts/testing';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { BasketContract } from '../../core/src/__fixtures__/basket.ts';
import '../../core/src/__fixtures__/basket.ts';
import { configureTitle } from './page.ts';

class BasketStore extends SuperStore<BasketContract> implements Commands<BasketStore> {
  constructor() {
    super({ contract: 'basket', initialState: { items: {} } });
  }
  add({ sku }: { sku: string }) {
    this.set({ items: { ...this.get().items, [sku]: this.selectors.quantity(sku) + 1 } });
  }
  clear() {
    this.set({ items: {} });
    this.emit('emptied');
  }
  async save(_: { id: string }) {
    return { count: this.selectors.count() };
  }
}

// What the compiler writes for `@title = …` in a `.super` file.
class Shop extends SuperElement {
  static tag = 'pg-shop';
  __superTitle = (this.page.title = 'Shop');
  render() {
    return html`<p>shop</p>`;
  }
}

class Basket extends SuperElement {
  static tag = 'pg-basket';
  basket = this.contract('basket');
  count = this.selector(this.basket.selectors.count);
  __superTitle = (this.page.title = () => `Basket (${this.count.value})`);
  render() {
    return html`<button @click=${() => this.basket.send('add', { sku: 'mug' })}>+</button>`;
  }
}

class Dialog extends SuperElement {
  static tag = 'pg-dialog';
  __superTitle = (this.page.title = 'Confirmation');
  render() {
    return html`<p>sure?</p>`;
  }
}

describe('page title', () => {
  beforeEach(() => {
    document.title = 'Start';
    configureTitle();
  });
  afterEach(() => configureTitle());

  test('a fixed title is set at mount and removed at unmount', async () => {
    const shop = await mount(Shop);
    expect(document.title).toBe('Shop');
    shop.unmount();
    await flush();
    expect(document.title).toBe('Start');
  });

  test('a function title follows the values read, like render', async () => {
    const { container } = await mount(Basket, { stores: [BasketStore.create()] });
    expect(document.title).toBe('Basket (0)');
    container.querySelector('button')!.click();
    await flush();
    expect(document.title).toBe('Basket (1)');
  });

  test('stack: the last mounted wins, the one below keeps up behind the scenes and comes back', async () => {
    const basket = BasketStore.create();
    await mount(Basket, { stores: [basket] });
    const dialog = await mount(Dialog);
    expect(document.title).toBe('Confirmation');

    await basket.send('add', { sku: 'mug' });
    await flush();
    expect(document.title).toBe('Confirmation');

    dialog.unmount();
    await flush();
    expect(document.title).toBe('Basket (1)');
  });

  test('set once mounted, it replaces the component title until unmount', async () => {
    class Editor extends SuperElement {
      static tag = 'pg-editor';
      __superTitle = (this.page.title = 'Counter');
      render() {
        return html`<button @click=${() => (this.page.title = 'Editing')}>edit</button>`;
      }
    }
    const editor = await mount(Editor);
    editor.container.querySelector('button')!.click();
    expect(document.title).toBe('Editing');

    editor.unmount();
    await flush();
    const again = await mount(Editor);
    expect(document.title).toBe('Counter'); // on remount, the declared title comes back
    again.unmount();
  });

  test('a component without a declared title can set one in mounted', async () => {
    class Late extends SuperElement {
      static tag = 'pg-late';
      protected override mounted() {
        this.page.title = 'Set at mount';
      }
      render() {
        return html``;
      }
    }
    const late = await mount(Late);
    expect(document.title).toBe('Set at mount');
    late.unmount();
    await flush();
    expect(document.title).toBe('Start');
  });

  test('cannot be set during render, and cannot be read', async () => {
    class InRender extends SuperElement {
      static tag = 'pg-in-render';
      render() {
        this.page.title = 'x';
        return html``;
      }
    }
    await expect(mount(InRender)).rejects.toThrow('cannot be set during render');

    class Reader extends SuperElement {
      static tag = 'pg-reader';
      read = () => this.page.title;
      render() {
        return html``;
      }
    }
    const reader = await mount(Reader);
    expect(() => reader.element.read()).toThrow('is set, it cannot be read');
  });

  test('the router sets the default title and the suffix', async () => {
    const Router = defineRouter({ home: '/' }).screens(() => ({ home: Shop }));
    createRouter(Router, { mode: 'memory', title: { default: 'My demo', suffix: ' · My demo' } });
    expect(document.title).toBe('My demo');
    const shop = await mount(Shop);
    expect(document.title).toBe('Shop · My demo');
    shop.unmount();
    await flush();
    expect(document.title).toBe('My demo');
  });
});
