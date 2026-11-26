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
  test('reads a store by its contract, and re-renders when the value read changes', async () => {
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

  test('does not re-render if the value read by selector does not change', async () => {
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

  test('selector on a list: re-renders if its content changes, not for an identical copy', async () => {
    const renders = vi.fn();
    class Lines extends SuperElement {
      static tag = 'el-lines';
      basket = this.contract('basket');
      lines = this.selector(this.basket.selectors.entries); // a new array on every read
      empty = this.selector(this.basket.selectors.isEmpty);
      render() {
        renders();
        return html`<p>${this.empty.value ? 'empty' : this.lines.value.map(([sku, n]) => `${sku}=${n}`).join()}</p>`;
      }
    }
    const basket = BasketStore.create();
    const { container } = await mount(Lines, { stores: [basket] });
    expect(container.textContent).toContain('empty');

    await basket.send('add', { sku: 'mug' });
    await flush();
    expect(container.textContent).toContain('mug=1');
    expect(renders).toHaveBeenCalledTimes(2);

    await basket.send('add', { sku: 'mug' });
    await flush();
    expect(container.textContent).toContain('mug=2');
    expect(renders).toHaveBeenCalledTimes(3);

    await basket.send('save', { id: 'x' }); // the state does not change: new array, same content
    await flush();
    expect(renders).toHaveBeenCalledTimes(3);

    await basket.send('clear');
    await flush();
    expect(container.textContent).toContain('empty');
    expect(renders).toHaveBeenCalledTimes(4);
  });

  test('a selector with a parameter follows the props: the sku changes, so does the value', async () => {
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

    // After the prop change, it is the new sku that is tracked.
    await basket.send('add', { sku: 'sticker' });
    await flush();
    expect(mounted.container.textContent).toContain('sticker=1');
  });

  test("a selector must return a selector's value as is, null included", async () => {
    // null carries no type brand: it is the runtime that rejects it.
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
    expect(errors[0]).toContain("selector() must return a selector's value");
  });

  test('a selector that returns null is accepted', async () => {
    class Saved extends SuperElement {
      static tag = 'el-saved';
      basket = this.contract('basket');
      saved = this.selector(this.basket.selectors.lastSaved);
      render() {
        return html`<p>${this.saved.value ?? 'nothing'}</p>`;
      }
    }
    const { container } = await mount(Saved, { stores: [BasketStore.create()] });
    expect(container.textContent).toContain('nothing');
  });

  test('a selector read directly in render also subscribes the component', async () => {
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

  test('read directly in render, a selector only re-renders if its value changes', async () => {
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

    await basket.send('add', { sku: 'pen' }); // another line: the value read does not change
    await flush();
    expect(renders).toHaveBeenCalledTimes(1);

    await basket.send('add', { sku: 'mug' });
    await flush();
    expect(renders).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe('1');
  });

  test('read directly, a new array with equal content does not re-render', async () => {
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

    // `clear` sets a new state; `entries()` returns a new array, but still empty.
    await basket.send('clear');
    await flush();
    expect(renders).toHaveBeenCalledTimes(1);

    await basket.send('add', { sku: 'mug' });
    await flush();
    expect(renders).toHaveBeenCalledTimes(2);
  });

  test('on, declared in the constructor, listens as long as the component is mounted', async () => {
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

  test('local state, props, and child mounted by create in the template', async () => {
    class Dialog extends SuperElement<{ props: { question: string }; emits: { answered: { confirmed: boolean } } }> {
      static tag = 'el-dialog';
      render() {
        return html`<p>${this.props.question}</p>
          <button @click=${() => this.emit('answered', { confirmed: true })}>Yes</button>`;
      }
    }
    class Screen extends SuperElement {
      static tag = 'el-screen';
      local = this.state({ open: true, answer: null as boolean | null });
      onAnswered = ({ confirmed }: { confirmed: boolean }) => this.local.set({ open: false, answer: confirmed });
      render() {
        const { open, answer } = this.local.get();
        return html`${open ? Dialog.create({ question: 'Sure?' }, { on: { answered: this.onAnswered } }) : null}
          <output>${String(answer)}</output>`;
      }
    }

    const { container } = await mount(Screen);
    expect(container.textContent).toContain('Sure?');
    container.querySelector('button')!.click();
    await flush();
    expect(container.querySelector('el-dialog')).toBeNull();
    expect(container.querySelector('output')!.textContent).toBe('true');
  });

  test('a child keeps its instance from one parent render to the next', async () => {
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

  test('this.form: ready from construction, wired to the store at mount', async () => {
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
        rules: { id: (v) => v !== '' || 'Identifier required' },
        submit: { to: this.basket, command: 'save', toInput: ({ id }) => ({ id }) },
        failures: { fields: { offline: { id: 'Offline' } }, form: { empty: 'Empty basket' } },
      });
      render() {
        return html`<form ${this.save.bind()}>
          <input ${this.save.field('id')} />
          <p class="error">${this.save.error('id')}</p>
          <button>${this.save.submitting() ? 'Pending' : 'Save'}</button>
        </form>`;
      }
    }
    const { container } = await mount(SaveForm, { stores: [SlowBasket.create()] });
    const input = container.querySelector('input')!;
    input.value = 'offline';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    container.querySelector('button')!.click();
    await flush();
    expect(container.querySelector('button')!.textContent).toBe('Pending');

    release();
    await flush();
    expect(container.querySelector('button')!.textContent).toBe('Save');
    expect(container.querySelector('.error')!.textContent).toBe('Offline');
  });

  test('props are readable from the fields and the constructor', async () => {
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
        return html`${Editor.create({ text: 'child' })}`;
      }
    }
    const { container } = await mount(Editor, { props: { text: 'hello' } });
    expect(container.textContent).toContain('hello');
    const hosted = await mount(Host);
    expect(hosted.container.textContent).toContain('child');
    expect(seen).toEqual(['hello', 'child']);
  });

  test('a store not found at mount is caught by the renderError of the component itself', async () => {
    class NeedsBasket extends SuperElement {
      static tag = 'el-needs-basket';
      basket = this.contract('basket');
      count = this.selector(this.basket.selectors.count);
      render() {
        return html`<p>${this.count.value}</p>`;
      }
      override renderError(error: Error) {
        return html`<p role="alert">unavailable (${error.message.includes('no store') ? 'store missing' : 'other'})</p>`;
      }
    }
    const reports: unknown[] = [];
    const { container } = await mount(NeedsBasket, { onError: (error, info) => reports.push(info) });
    expect(container.textContent).toContain('unavailable (store missing)');
    expect(reports).toEqual([{ tag: 'el-needs-basket', phase: 'setup', caughtBy: 'el-needs-basket' }]);
  });

  test('mounted, unmounted and ref', async () => {
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

  test('renderError replaces the render that crashes', async () => {
    class Broken extends SuperElement {
      static tag = 'el-broken';
      render(): unknown {
        throw new Error('boom');
      }
      override renderError(error: Error) {
        return html`<p role="alert">${error.message}</p>`;
      }
    }
    const errors: string[] = [];
    const { container } = await mount(Broken, { onError: (error) => errors.push(error.message) });
    expect(container.textContent).toContain('boom');
    expect(errors).toEqual(['boom']);
  });

  test("a child that crashes in its constructor is caught by the parent's renderError, under its own name", async () => {
    class BrokenChild extends SuperElement {
      static tag = 'el-broken-child';
      constructor() {
        super();
        throw new Error('broken constructor');
      }
      render() {
        return html``;
      }
    }
    class Panel extends SuperElement {
      static tag = 'el-panel';
      render() {
        return html`<p>panel</p>${BrokenChild.create()}`;
      }
      override renderError(error: Error) {
        return html`<p role="alert">caught: ${error.message}</p>`;
      }
    }
    const reports: unknown[] = [];
    const { container } = await mount(Panel, { onError: (error, info) => reports.push({ message: error.message, ...info }) });
    await flush();
    expect(container.textContent).toContain('caught: broken constructor');
    expect(reports).toEqual([{ message: 'broken constructor', tag: 'el-broken-child', phase: 'setup', caughtBy: 'el-panel' }]);
  });

  test('render can neither read a contract nor create state', async () => {
    class Sneaky extends SuperElement {
      static tag = 'el-sneaky';
      render() {
        this.state({ x: 1 });
        return html``;
      }
    }
    const errors: string[] = [];
    await mount(Sneaky, { onError: (error) => errors.push(error.message) });
    expect(errors[0]).toContain('not during render');
  });

  test('static tag is required, and native callbacks cannot be overridden', () => {
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
