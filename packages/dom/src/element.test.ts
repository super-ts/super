import { type Commands, SuperStore } from '@super-ts/core';
import { html, repeat, SuperElement } from '@super-ts/dom';
import { flush, mount } from '@super-ts/testing';
import { describe, expect, test, vi } from 'vitest';
import type { BasketContract } from '../../core/src/__fixtures__/basket.ts';
import '../../core/src/__fixtures__/basket.ts';

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

describe('SuperElement', () => {
  test('lit un store par son contrat, et se re-rend quand la valeur lue change', async () => {
    const renders = vi.fn();
    class Counter extends SuperElement {
      static tag = 'el-counter';
      basket = this.contract('basket');
      count = this.selector(this.basket.selectors.count);

      render() {
        renders();
        return html`<p>${this.count.value}</p>
          <button @click=${() => this.basket.send('add', { sku: 'mug' })}>+</button>`;
      }
    }

    const basket = BasketStore.create();
    const { container } = await mount(Counter, { stores: [basket] });
    expect(container.querySelector('p')!.textContent).toBe('0');

    container.querySelector('button')!.click();
    await flush();
    expect(container.querySelector('p')!.textContent).toBe('1');
    expect(renders).toHaveBeenCalledTimes(2);
  });

  test('ne se re-rend pas si la valeur lue par selector ne change pas', async () => {
    const renders = vi.fn();
    class MugOnly extends SuperElement {
      static tag = 'el-mug-only';
      basket = this.contract('basket');
      mugs = this.selector(() => this.basket.selectors.quantity('mug'));
      render() {
        renders();
        return html`<p>${this.mugs.value}</p>`;
      }
    }

    const basket = BasketStore.create();
    await mount(MugOnly, { stores: [basket] });
    await basket.send('add', { sku: 'sticker' });
    await flush();
    expect(renders).toHaveBeenCalledTimes(1);

    await basket.send('add', { sku: 'mug' });
    await flush();
    expect(renders).toHaveBeenCalledTimes(2);
  });

  test('selector sur une liste : re-rend si son contenu change, pas pour une copie identique', async () => {
    const renders = vi.fn();
    class Lines extends SuperElement {
      static tag = 'el-lines';
      basket = this.contract('basket');
      lines = this.selector(this.basket.selectors.entries); // un tableau neuf à chaque lecture
      empty = this.selector(this.basket.selectors.isEmpty);
      render() {
        renders();
        return html`<p>${this.empty.value ? 'vide' : this.lines.value.map(([sku, n]) => `${sku}=${n}`).join()}</p>`;
      }
    }
    const basket = BasketStore.create();
    const { container } = await mount(Lines, { stores: [basket] });
    expect(container.textContent).toContain('vide');

    await basket.send('add', { sku: 'mug' });
    await flush();
    expect(container.textContent).toContain('mug=1');
    expect(renders).toHaveBeenCalledTimes(2);

    await basket.send('add', { sku: 'mug' });
    await flush();
    expect(container.textContent).toContain('mug=2');
    expect(renders).toHaveBeenCalledTimes(3);

    await basket.send('save', { id: 'x' }); // l'état ne change pas : nouveau tableau, même contenu
    await flush();
    expect(renders).toHaveBeenCalledTimes(3);

    await basket.send('clear');
    await flush();
    expect(container.textContent).toContain('vide');
    expect(renders).toHaveBeenCalledTimes(4);
  });

  test('un selector à paramètre suit les props : le sku change, la valeur aussi', async () => {
    class Badge extends SuperElement<{ props: { sku: string } }> {
      static tag = 'el-badge';
      basket = this.contract('basket');
      quantity = this.selector(() => this.basket.selectors.quantity(this.props.sku));
      render() {
        return html`<p>${this.props.sku}=${this.quantity.value}</p>`;
      }
    }
    const basket = BasketStore.create();
    await basket.send('add', { sku: 'mug' });
    const mounted = await mount(Badge, { stores: [basket], props: { sku: 'mug' } });
    expect(mounted.container.textContent).toContain('mug=1');

    await mounted.setProps({ sku: 'sticker' });
    expect(mounted.container.textContent).toContain('sticker=0');

    // Après le changement de prop, c'est le nouveau sku qui est suivi.
    await basket.send('add', { sku: 'sticker' });
    await flush();
    expect(mounted.container.textContent).toContain('sticker=1');
  });

  test('un selector doit renvoyer la valeur d’un sélecteur telle quelle, null compris', async () => {
    // null ne porte pas de marque de type : c'est l'exécution qui le refuse.
    class Hidden extends SuperElement<{ props: { show: boolean } }> {
      static tag = 'el-hidden';
      basket = this.contract('basket');
      saved = this.selector(() => (this.props.show ? this.basket.selectors.lastSaved() : null));
      render() {
        return html`<p>${this.saved.value}</p>`;
      }
    }
    const errors: string[] = [];
    await mount(Hidden, { stores: [BasketStore.create()], props: { show: false }, onError: (error) => errors.push(error.message) });
    expect(errors[0]).toContain('selector() doit renvoyer la valeur d’un sélecteur');
  });

  test('un sélecteur qui renvoie null est accepté', async () => {
    class Saved extends SuperElement {
      static tag = 'el-saved';
      basket = this.contract('basket');
      saved = this.selector(this.basket.selectors.lastSaved);
      render() {
        return html`<p>${this.saved.value ?? 'rien'}</p>`;
      }
    }
    const { container } = await mount(Saved, { stores: [BasketStore.create()] });
    expect(container.textContent).toContain('rien');
  });

  test('un sélecteur lu directement dans render abonne aussi le composant', async () => {
    class Direct extends SuperElement {
      static tag = 'el-direct';
      basket = this.contract('basket');
      render() {
        return html`<p>${this.basket.selectors.count()}</p>`;
      }
    }
    const basket = BasketStore.create();
    const { container } = await mount(Direct, { stores: [basket] });
    await basket.send('add', { sku: 'mug' });
    await flush();
    expect(container.textContent).toContain('1');
  });

  test('lu directement dans render, un sélecteur ne re-rend que si sa valeur change', async () => {
    const renders = vi.fn();
    class Direct extends SuperElement {
      static tag = 'el-direct-fine';
      basket = this.contract('basket');
      render() {
        renders();
        return html`<p>${this.basket.selectors.quantity('mug')}</p>`;
      }
    }
    const basket = BasketStore.create();
    const { container } = await mount(Direct, { stores: [basket] });
    expect(renders).toHaveBeenCalledTimes(1);

    await basket.send('add', { sku: 'pen' }); // autre ligne : la valeur lue ne change pas
    await flush();
    expect(renders).toHaveBeenCalledTimes(1);

    await basket.send('add', { sku: 'mug' });
    await flush();
    expect(renders).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe('1');
  });

  test('lu directement, un tableau neuf mais égal en contenu ne re-rend pas', async () => {
    const renders = vi.fn();
    class Lines extends SuperElement {
      static tag = 'el-direct-lines';
      basket = this.contract('basket');
      render() {
        renders();
        return html`<p>${this.basket.selectors.entries().length}</p>`;
      }
    }
    const basket = BasketStore.create();
    await mount(Lines, { stores: [basket] });

    // `clear` pose un nouvel état ; `entries()` rend un tableau neuf, mais toujours vide.
    await basket.send('clear');
    await flush();
    expect(renders).toHaveBeenCalledTimes(1);

    await basket.send('add', { sku: 'mug' });
    await flush();
    expect(renders).toHaveBeenCalledTimes(2);
  });

  test('on, déclaré dans le constructeur, écoute tant que le composant est monté', async () => {
    const heard = vi.fn();
    class Listener extends SuperElement {
      static tag = 'el-listener';
      basket = this.contract('basket');
      constructor() {
        super();
        this.basket.on('emptied', heard);
      }
      render() {
        return html`<p></p>`;
      }
    }
    const basket = BasketStore.create();
    const mounted = await mount(Listener, { stores: [basket] });
    await basket.send('clear');
    expect(heard).toHaveBeenCalledTimes(1);

    mounted.unmount();
    await flush();
    await basket.send('clear');
    expect(heard).toHaveBeenCalledTimes(1);
  });

  test('état local, props, et enfant monté par create dans le template', async () => {
    class Dialog extends SuperElement<{ props: { question: string }; emits: { answered: { confirmed: boolean } } }> {
      static tag = 'el-dialog';
      render() {
        return html`<p>${this.props.question}</p>
          <button @click=${() => this.emit('answered', { confirmed: true })}>Oui</button>`;
      }
    }
    class Screen extends SuperElement {
      static tag = 'el-screen';
      local = this.state({ open: true, answer: null as boolean | null });
      onAnswered = ({ confirmed }: { confirmed: boolean }) => this.local.set({ open: false, answer: confirmed });
      render() {
        const { open, answer } = this.local.get();
        return html`${open ? Dialog.create({ question: 'Sûr ?' }, { on: { answered: this.onAnswered } }) : null}
          <output>${String(answer)}</output>`;
      }
    }

    const { container } = await mount(Screen);
    expect(container.textContent).toContain('Sûr ?');
    container.querySelector('button')!.click();
    await flush();
    expect(container.querySelector('el-dialog')).toBeNull();
    expect(container.querySelector('output')!.textContent).toBe('true');
  });

  test('un enfant garde son instance d’un rendu à l’autre du parent', async () => {
    class Child extends SuperElement<{ props: { label: string } }> {
      static tag = 'el-child';
      local = this.state({ clicks: 0 });
      render() {
        return html`<button @click=${() => this.local.set((s) => ({ clicks: s.clicks + 1 }))}>${this.props.label} ${this.local.get().clicks}</button>`;
      }
    }
    class Parent extends SuperElement {
      static tag = 'el-parent';
      local = this.state({ items: ['a', 'b'] });
      render() {
        return html`${repeat(
          this.local.get().items,
          (i) => i,
          (i) => Child.create({ label: i }),
        )}
          <button class="add" @click=${() => this.local.set((s) => ({ items: [...s.items, 'c'] }))}>add</button>`;
      }
    }
    const { container } = await mount(Parent);
    container.querySelector('el-child button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    (container.querySelector('button.add') as HTMLButtonElement).click();
    await flush();
    expect(container.querySelector('el-child')!.textContent).toContain('a 1');
    expect(container.querySelectorAll('el-child')).toHaveLength(3);
  });

  test('this.form : prêt dès la construction, branché sur le store au montage', async () => {
    let release!: () => void;
    class SlowBasket extends SuperStore<BasketContract> implements Commands<SlowBasket> {
      constructor() {
        super({ contract: 'basket', initialState: { items: {} } });
      }
      add(_: { sku: string }) {}
      clear() {}
      async save({ id }: { id: string }) {
        await new Promise<void>((resolve) => (release = resolve));
        if (id === 'offline') return this.fail('offline');
        return { count: 0 };
      }
    }
    class SaveForm extends SuperElement {
      static tag = 'el-save-form';
      basket = this.contract('basket');
      save = this.form({
        initial: { id: '' },
        rules: { id: (v) => v !== '' || 'Identifiant requis' },
        submit: { to: this.basket, command: 'save', toInput: ({ id }) => ({ id }) },
        failures: { fields: { offline: { id: 'Hors ligne' } }, form: { empty: 'Panier vide' } },
      });
      render() {
        return html`<form ${this.save.bind()}>
          <input ${this.save.field('id')} />
          <p class="error">${this.save.error('id')}</p>
          <button>${this.save.submitting() ? 'En cours' : 'Enregistrer'}</button>
        </form>`;
      }
    }
    const { container } = await mount(SaveForm, { stores: [SlowBasket.create()] });
    const input = container.querySelector('input')!;
    input.value = 'offline';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    container.querySelector('button')!.click();
    await flush();
    expect(container.querySelector('button')!.textContent).toBe('En cours');

    release();
    await flush();
    expect(container.querySelector('button')!.textContent).toBe('Enregistrer');
    expect(container.querySelector('.error')!.textContent).toBe('Hors ligne');
  });

  test('les props sont lisibles dès les champs et le constructeur', async () => {
    const seen: string[] = [];
    class Editor extends SuperElement<{ props: { text: string } }> {
      static tag = 'el-editor';
      local = this.state({ draft: this.props.text });
      constructor() {
        super();
        seen.push(this.props.text);
      }
      render() {
        return html`<p>${this.local.get().draft}</p>`;
      }
    }
    class Host extends SuperElement {
      static tag = 'el-editor-host';
      render() {
        return html`${Editor.create({ text: 'enfant' })}`;
      }
    }
    const { container } = await mount(Editor, { props: { text: 'bonjour' } });
    expect(container.textContent).toContain('bonjour');
    const hosted = await mount(Host);
    expect(hosted.container.textContent).toContain('enfant');
    expect(seen).toEqual(['bonjour', 'enfant']);
  });

  test('un store introuvable au montage est rattrapé par le renderError du composant lui-même', async () => {
    class NeedsBasket extends SuperElement {
      static tag = 'el-needs-basket';
      basket = this.contract('basket');
      count = this.selector(this.basket.selectors.count);
      render() {
        return html`<p>${this.count.value}</p>`;
      }
      override renderError(error: Error) {
        return html`<p role="alert">indisponible (${error.message.includes('aucun store') ? 'store absent' : 'autre'})</p>`;
      }
    }
    const reports: unknown[] = [];
    const { container } = await mount(NeedsBasket, { onError: (error, info) => reports.push(info) });
    expect(container.textContent).toContain('indisponible (store absent)');
    expect(reports).toEqual([{ tag: 'el-needs-basket', phase: 'setup', caughtBy: 'el-needs-basket' }]);
  });

  test('mounted, unmounted et ref', async () => {
    const events: string[] = [];
    class Focus extends SuperElement {
      static tag = 'el-focus';
      input = this.ref<HTMLInputElement>();
      protected override mounted() {
        events.push(`mounted:${this.input.value?.localName}`);
      }
      protected override unmounted() {
        events.push('unmounted');
      }
      render() {
        return html`<input ${this.input} />`;
      }
    }
    const mounted = await mount(Focus);
    mounted.unmount();
    await flush();
    expect(events).toEqual(['mounted:input', 'unmounted']);
  });

  test('renderError remplace le rendu qui plante', async () => {
    class Broken extends SuperElement {
      static tag = 'el-broken';
      render(): unknown {
        throw new Error('boum');
      }
      override renderError(error: Error) {
        return html`<p role="alert">${error.message}</p>`;
      }
    }
    const errors: string[] = [];
    const { container } = await mount(Broken, { onError: (error) => errors.push(error.message) });
    expect(container.textContent).toContain('boum');
    expect(errors).toEqual(['boum']);
  });

  test('un enfant qui plante dans son constructeur est rattrapé par le renderError du parent, à son nom', async () => {
    class BrokenChild extends SuperElement {
      static tag = 'el-broken-child';
      constructor() {
        super();
        throw new Error('constructeur cassé');
      }
      render() {
        return html``;
      }
    }
    class Panel extends SuperElement {
      static tag = 'el-panel';
      render() {
        return html`<p>panneau</p>${BrokenChild.create()}`;
      }
      override renderError(error: Error) {
        return html`<p role="alert">rattrapé : ${error.message}</p>`;
      }
    }
    const reports: unknown[] = [];
    const { container } = await mount(Panel, { onError: (error, info) => reports.push({ message: error.message, ...info }) });
    await flush();
    expect(container.textContent).toContain('rattrapé : constructeur cassé');
    expect(reports).toEqual([{ message: 'constructeur cassé', tag: 'el-broken-child', phase: 'setup', caughtBy: 'el-panel' }]);
  });

  test('render ne peut ni lire un contrat ni créer d’état', async () => {
    class Sneaky extends SuperElement {
      static tag = 'el-sneaky';
      render() {
        this.state({ x: 1 });
        return html``;
      }
    }
    const errors: string[] = [];
    await mount(Sneaky, { onError: (error) => errors.push(error.message) });
    expect(errors[0]).toContain('pas pendant render');
  });

  test('static tag est obligatoire, et les callbacks natifs ne se surchargent pas', () => {
    class NoTag extends SuperElement {
      render() {
        return html``;
      }
    }
    expect(() => (NoTag as unknown as typeof SuperElement & { create(): unknown }).create()).toThrow('static tag');

    class Override extends SuperElement {
      static tag = 'el-override';
      override connectedCallback() {}
      render() {
        return html``;
      }
    }
    expect(() => Override.create()).toThrow('mounted() / unmounted()');
  });
});
