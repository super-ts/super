import { type Commands, SuperStore } from '@super-ts/core';
import { createRouter, defineRouter, html, SuperElement } from '@super-ts/dom';
import { flush, mount } from '@super-ts/testing';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { BasketContract } from '../../core/src/__fixtures__/basket';
import '../../core/src/__fixtures__/basket';
import { configureTitle } from './page';

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

// Ce qu'écrit le compilateur pour `@title = …` dans un `.super`.
class Shop extends SuperElement {
  static tag = 'pg-shop';
  __superTitle = (this.page.title = 'Boutique');
  render() {
    return html`<p>boutique</p>`;
  }
}

class Basket extends SuperElement {
  static tag = 'pg-basket';
  basket = this.contract('basket');
  count = this.selector(this.basket.selectors.count);
  __superTitle = (this.page.title = () => `Panier (${this.count.value})`);
  render() {
    return html`<button @click=${() => this.basket.send('add', { sku: 'mug' })}>+</button>`;
  }
}

class Dialog extends SuperElement {
  static tag = 'pg-dialog';
  __superTitle = (this.page.title = 'Confirmation');
  render() {
    return html`<p>sûr ?</p>`;
  }
}

describe('titre de la page', () => {
  beforeEach(() => {
    document.title = 'Départ';
    configureTitle();
  });
  afterEach(() => configureTitle());

  test('un titre fixe est posé au montage et retiré au démontage', async () => {
    const shop = await mount(Shop);
    expect(document.title).toBe('Boutique');
    shop.unmount();
    await flush();
    expect(document.title).toBe('Départ');
  });

  test('un titre en fonction suit les valeurs lues, comme render', async () => {
    const { container } = await mount(Basket, { stores: [BasketStore.create()] });
    expect(document.title).toBe('Panier (0)');
    container.querySelector('button')!.click();
    await flush();
    expect(document.title).toBe('Panier (1)');
  });

  test('pile : le dernier monté l’emporte, celui du dessous suit en coulisse et revient', async () => {
    const basket = BasketStore.create();
    await mount(Basket, { stores: [basket] });
    const dialog = await mount(Dialog);
    expect(document.title).toBe('Confirmation');

    await basket.send('add', { sku: 'mug' });
    await flush();
    expect(document.title).toBe('Confirmation');

    dialog.unmount();
    await flush();
    expect(document.title).toBe('Panier (1)');
  });

  test('posé une fois monté, il remplace le titre du composant jusqu’au démontage', async () => {
    class Editor extends SuperElement {
      static tag = 'pg-editor';
      __superTitle = (this.page.title = 'Compteur');
      render() {
        return html`<button @click=${() => (this.page.title = 'Modification')}>éditer</button>`;
      }
    }
    const editor = await mount(Editor);
    editor.container.querySelector('button')!.click();
    expect(document.title).toBe('Modification');

    editor.unmount();
    await flush();
    const again = await mount(Editor);
    expect(document.title).toBe('Compteur'); // au remontage, le titre déclaré revient
    again.unmount();
  });

  test('un composant sans titre déclaré peut en poser un dans mounted', async () => {
    class Late extends SuperElement {
      static tag = 'pg-late';
      protected override mounted() {
        this.page.title = 'Posé au montage';
      }
      render() {
        return html``;
      }
    }
    const late = await mount(Late);
    expect(document.title).toBe('Posé au montage');
    late.unmount();
    await flush();
    expect(document.title).toBe('Départ');
  });

  test('ne se pose pas pendant render, et ne se lit pas', async () => {
    class InRender extends SuperElement {
      static tag = 'pg-in-render';
      render() {
        this.page.title = 'x';
        return html``;
      }
    }
    await expect(mount(InRender)).rejects.toThrow('ne se pose pas pendant render');

    class Reader extends SuperElement {
      static tag = 'pg-reader';
      read = () => this.page.title;
      render() {
        return html``;
      }
    }
    const reader = await mount(Reader);
    expect(() => reader.element.read()).toThrow('se pose, il ne se lit pas');
  });

  test('le router fixe le titre par défaut et le suffixe', async () => {
    const Router = defineRouter({ home: '/' }).screens(() => ({ home: Shop }));
    createRouter(Router, { mode: 'memory', title: { default: 'Ma démo', suffix: ' · Ma démo' } });
    expect(document.title).toBe('Ma démo');
    const shop = await mount(Shop);
    expect(document.title).toBe('Boutique · Ma démo');
    shop.unmount();
    await flush();
    expect(document.title).toBe('Ma démo');
  });
});
