import { type Commands, SuperStore } from '@super-ts/core';
import { createApp, html, repeat, SuperElement } from '@super-ts/dom';
import { fakeStore, flush, mount } from '@super-ts/testing';
import { describe, expect, test, vi } from 'vitest';
import './__fixtures__/cmp-contracts.ts';
import type { CmpBoardContract, CmpClockContract, CmpListedContract, CmpSaverContract } from './__fixtures__/cmp-contracts.ts';

class ClockStore extends SuperStore<CmpClockContract> implements Commands<ClockStore> {
  constructor() {
    super({ contract: 'cmp-clock', initialState: { now: 0 } });
  }
  tick() {
    this.set({ now: this.get().now + 1 });
  }
}

class BoardStore extends SuperStore<CmpBoardContract> implements Commands<BoardStore> {
  constructor() {
    super({ contract: 'cmp-board', initialState: { scores: { a: 1, b: 5 }, status: 'idle' } });
  }
  score({ id, value }: { id: string; value: number }) {
    this.set((s) => ({ scores: { ...s.scores, [id]: value } }));
  }
  setStatus(status: string) {
    this.set({ status });
  }
}

class ListedStore extends SuperStore<CmpListedContract> implements Commands<ListedStore> {
  constructor() {
    super({ contract: 'cmp-listed', initialState: { items: { a: 1 }, note: '' } });
  }
  add(sku: string) {
    const { items } = this.get();
    this.set({ items: { ...items, [sku]: (items[sku] ?? 0) + 1 } });
  }
  note(text: string) {
    this.set({ note: text });
  }
}

describe('component', () => {
  test('renders the template, escapes interpolations and re-renders when the props change', async () => {
    class Hello extends SuperElement<{ props: { name: string } }> {
      static tag = 'cmp-hello';
      render() {
        return html`<p>Hello ${this.props.name}</p>`;
      }
    }

    const mounted = await mount(Hello, { props: { name: '<b>Ada</b>' } });
    expect(mounted.container.querySelector('p')!.textContent).toBe('Hello <b>Ada</b>');
    expect(mounted.container.querySelector('b')).toBeNull();

    await mounted.setProps({ name: 'Grace' });
    expect(mounted.container.textContent).toContain('Grace');
  });

  test('local state: set merges and re-renders', async () => {
    class Toggle extends SuperElement {
      static tag = 'cmp-toggle';
      local = this.state({ on: false, clicks: 0, label: 'x' });
      render() {
        const { on, clicks, label } = this.local.get();
        return html`<button @click=${() => this.local.set((s) => ({ on: !s.on, clicks: s.clicks + 1 }))}>
          ${on ? 'ON' : 'OFF'} ${clicks} ${label}
        </button>`;
      }
    }

    const { container } = await mount(Toggle);
    container.querySelector('button')!.click();
    await flush();

    expect(container.textContent).toContain('ON 1 x');
  });

  test('a child does not re-render when the parent passes the same props again', async () => {
    const childRender = vi.fn();
    class Child extends SuperElement<{ props: { label: string } }> {
      static tag = 'cmp-same-props-child';
      render() {
        childRender();
        return html`<span>${this.props.label}</span>`;
      }
    }
    class Parent extends SuperElement {
      static tag = 'cmp-same-props-parent';
      local = this.state({ clicks: 0, label: 'a' });
      render() {
        return html`<button @click=${() => this.local.set((s) => ({ clicks: s.clicks + 1 }))}>${this.local.get().clicks}</button>
          ${Child.create({ label: this.local.get().label })}`;
      }
    }
    const { container } = await mount(Parent);
    await flush();
    const before = childRender.mock.calls.length;

    container.querySelector('button')!.click();
    await flush();
    expect(container.querySelector('button')!.textContent).toBe('1');
    expect(childRender).toHaveBeenCalledTimes(before);
  });

  test('the parent keeps the same child instance and updates its props', async () => {
    class Child extends SuperElement<{ props: { n: number } }> {
      static tag = 'cmp-child-props';
      render() {
        return html`<i>${this.props.n}</i>`;
      }
    }
    class Parent extends SuperElement {
      static tag = 'cmp-parent-props';
      local = this.state({ n: 1 });
      render() {
        return html`<button @click=${() => this.local.set({ n: this.local.get().n + 1 })}>+</button>${Child.create({ n: this.local.get().n })}`;
      }
    }

    const { container } = await mount(Parent);
    const child = container.querySelector('cmp-child-props');
    container.querySelector('button')!.click();
    await flush();

    expect(container.querySelector('cmp-child-props')).toBe(child);
    expect(container.querySelector('i')!.textContent).toBe('2');
  });

  test('a dialog opens through a prop and answers through an event, without await in the parent', async () => {
    class Confirm extends SuperElement<{ props: { question: string | null }; emits: { answered: { confirmed: boolean } } }> {
      static tag = 'cmp-confirm';
      render() {
        const { question } = this.props;
        return question
          ? html`<p>${question}</p>
              <button class="no" @click=${() => this.emit('answered', { confirmed: false })}>No</button>
              <button class="yes" @click=${() => this.emit('answered', { confirmed: true })}>Yes</button>`
          : null;
      }
    }
    const answers: boolean[] = [];
    class Screen extends SuperElement {
      static tag = 'cmp-screen-confirm';
      local = this.state({ question: null as string | null });
      onAnswered = ({ confirmed }: { confirmed: boolean }) => {
        this.local.set({ question: null });
        answers.push(confirmed);
      };
      render() {
        return html`
          <button class="go" @click=${() => this.local.set({ question: 'Continue?' })}>Go</button>
          ${Confirm.create({ question: this.local.get().question }, { on: { answered: this.onAnswered } })}
        `;
      }
    }

    const { container } = await mount(Screen);
    container.querySelector<HTMLButtonElement>('.go')!.click();
    await flush();
    expect(container.textContent).toContain('Continue?');

    container.querySelector<HTMLButtonElement>('cmp-confirm .yes')!.click();
    await flush();
    expect(answers).toEqual([true]);
    expect(container.textContent).not.toContain('Continue?');
  });

  test('mounted runs after the first render; unmounted and the signal at unmount', async () => {
    const calls: string[] = [];
    let signal!: AbortSignal;
    class Widget extends SuperElement {
      static tag = 'cmp-lifecycle';
      protected override mounted() {
        signal = this.signal;
        calls.push(`mount:${this.querySelector('span')?.textContent}`);
      }
      protected override unmounted() {
        calls.push('cleanup');
      }
      render() {
        return html`<span>ready</span>`;
      }
    }

    const mounted = await mount(Widget);
    expect(signal.aborted).toBe(false);
    mounted.unmount();
    await flush();

    expect(calls).toEqual(['mount:ready', 'cleanup']);
    expect(signal.aborted).toBe(true);
  });

  test('a child moved by repeat keeps its local state', async () => {
    class Item extends SuperElement<{ props: { label: string } }> {
      static tag = 'cmp-item';
      local = this.state({ ticks: 0 });
      render() {
        return html`<button @click=${() => this.local.set({ ticks: this.local.get().ticks + 1 })}>${this.props.label}:${this.local.get().ticks}</button>`;
      }
    }
    class List extends SuperElement {
      static tag = 'cmp-list';
      local = this.state({ items: ['a', 'b'] });
      render() {
        return html`
          <button class="reverse" @click=${() => this.local.set({ items: [...this.local.get().items].reverse() })}>reverse</button>
          ${repeat(
            this.local.get().items,
            (item) => item,
            (item) => Item.create({ label: item }),
          )}`;
      }
    }

    const { container } = await mount(List);
    container.querySelector<HTMLButtonElement>('cmp-item button')!.click(); // a:1
    await flush();
    container.querySelector<HTMLButtonElement>('.reverse')!.click();
    await flush();

    const labels = [...container.querySelectorAll('cmp-item')].map((el) => el.textContent!.trim());
    expect(labels).toEqual(['b:0', 'a:1']);
  });
});

describe('contracts and createApp', () => {
  class ClockView extends SuperElement {
    static tag = 'cmp-clock-view';
    clock = this.contract('cmp-clock');
    now = this.selector(this.clock.selectors.now);
    render() {
      return html`<button @click=${() => this.clock.send('tick')}>${this.now.value}</button>`;
    }
  }

  test('createApp provides the stores to everything rendered under the root', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const clock = ClockStore.create();
    const app = createApp({ root, stores: [clock] });

    app.mount(ClockView.create());
    await clock.send('tick');
    await flush();

    expect(root.textContent).toBe('1');
    app.dispose();
    root.remove();
  });

  test('a missing store produces an explicit error', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener('error', onError);
    try {
      root.append(ClockView.create());
    } catch (error) {
      errors.push(error);
    } finally {
      window.removeEventListener('error', onError);
      root.remove();
    }
    expect(String(errors[0])).toMatch(/no store provided for the contract "cmp-clock"/);
  });

  test('two stores for the same contract are refused', () => {
    expect(() => createApp({ root: document.createElement('div'), stores: [ClockStore.create(), ClockStore.create()] })).toThrow(
      /two stores/,
    );
  });

  test('the component unsubscribes from the store at unmount', async () => {
    const clock = ClockStore.create();
    const renders = vi.fn();
    class Spy extends SuperElement {
      static tag = 'cmp-clock-spy';
      clock = this.contract('cmp-clock');
      render() {
        renders(this.clock.selectors.now());
        return null;
      }
    }

    const mounted = await mount(Spy, { stores: [clock] });
    mounted.unmount();
    await flush();
    await clock.send('tick');
    await flush();

    expect(renders).toHaveBeenCalledTimes(1);
  });

  describe('selector', () => {
    test('only re-renders if the selected value changes', async () => {
      const board = BoardStore.create();
      const renders = vi.fn();
      class Score extends SuperElement {
        static tag = 'cmp-score';
        board = this.contract('cmp-board');
        scores = this.selector(this.board.selectors.scores);
        render() {
          renders();
          return html`<p>${this.scores.value.a}</p>`;
        }
      }
      const { container } = await mount(Score, { stores: [board] });

      await board.send('setStatus', 'busy');
      await flush();
      expect(renders).toHaveBeenCalledTimes(1);

      await board.send('score', { id: 'a', value: 2 });
      await flush();
      expect(renders).toHaveBeenCalledTimes(2);
      expect(container.textContent).toBe('2');
    });

    test('an identically recreated object does not re-render', async () => {
      const board = BoardStore.create();
      const renders = vi.fn();
      class Pair extends SuperElement {
        static tag = 'cmp-score-pair';
        board = this.contract('cmp-board');
        pair = this.selector(this.board.selectors.pair); // a new object on every read
        render() {
          renders(this.pair.value);
          return null;
        }
      }
      await mount(Pair, { stores: [board] });

      await board.send('score', { id: 'a', value: 1 }); // same value, new scores object
      await board.send('setStatus', 'busy');
      await flush();
      expect(renders).toHaveBeenCalledTimes(1);
    });

    test('a selector that reads the props compares with what was rendered', async () => {
      const board = BoardStore.create();
      class Single extends SuperElement<{ props: { id: string } }> {
        static tag = 'cmp-score-single';
        board = this.contract('cmp-board');
        score = this.selector(() => this.board.selectors.score(this.props.id));
        render() {
          return html`<p>${this.score.value}</p>`;
        }
      }
      const mounted = await mount(Single, { props: { id: 'a' }, stores: [board] });
      expect(mounted.container.textContent).toBe('1');

      await mounted.setProps({ id: 'b' });
      expect(mounted.container.textContent).toBe('5');

      // b goes to 1, the value of a at the first render: it still has to re-render.
      await board.send('score', { id: 'b', value: 1 });
      await flush();
      expect(mounted.container.textContent).toBe('1');
    });

    test('a list built by the selector only re-renders if its content changes', async () => {
      const store = ListedStore.create();
      const renders = vi.fn();
      class List extends SuperElement {
        static tag = 'cmp-listed-view';
        listed = this.contract('cmp-listed');
        // Array recreated on every read: stabilised by Super.
        labels = this.selector(this.listed.selectors.labels);
        render() {
          renders();
          return html`<p>${this.labels.value.join(',')}</p>`;
        }
      }
      const { container } = await mount(List, { stores: [store] });

      await store.send('note', 'outside the list');
      await flush();
      expect(renders).toHaveBeenCalledTimes(1);

      await store.send('add', 'a');
      await flush();
      expect(renders).toHaveBeenCalledTimes(2);
      expect(container.textContent).toBe('a2');
    });
  });
});

describe('error boundary: renderError and onError', () => {
  const fail = (message: string): never => {
    throw new Error(message);
  };

  test('an error at the first render displays the component renderError, with its props', async () => {
    class Broken extends SuperElement<{ props: { id: string } }> {
      static tag = 'cmp-err-first';
      render(): unknown {
        return fail('broken render');
      }
      override renderError(error: Error) {
        return html`<p>${this.props.id}: ${error.message}</p>`;
      }
    }
    const onError = vi.fn();
    const { container } = await mount(Broken, { props: { id: 'coffees' }, onError });

    expect(container.textContent).toBe('coffees: broken render');
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { tag: 'cmp-err-first', phase: 'render', caughtBy: 'cmp-err-first' });
  });

  test('an error in a later render switches to renderError', async () => {
    class Flaky extends SuperElement {
      static tag = 'cmp-err-render';
      local = this.state({ broken: false });
      render(): unknown {
        return this.local.get().broken
          ? fail('broken render')
          : html`<button @click=${() => this.local.set({ broken: true })}>break</button>`;
      }
      override renderError(error: Error) {
        return html`<p>fallback: ${error.message}</p>`;
      }
    }
    const { container } = await mount(Flaky, { onError: () => {} });

    container.querySelector('button')!.click();
    await flush();

    expect(container.textContent).toBe('fallback: broken render');
  });

  test("an ancestor's renderError catches a descendant's error, through an intermediate", async () => {
    class Child extends SuperElement {
      static tag = 'cmp-err-child';
      constructor() {
        super();
        fail('broken child');
      }
      render() {
        return null;
      }
    }
    class Middle extends SuperElement {
      static tag = 'cmp-err-middle';
      render() {
        return html`<section>${Child.create()}</section>`;
      }
    }
    class Screen extends SuperElement {
      static tag = 'cmp-err-screen';
      render() {
        return html`<h1>screen</h1>${Middle.create()}`;
      }
      override renderError(error: Error) {
        return html`<p>screen in fallback: ${error.message}</p>`;
      }
    }
    const onError = vi.fn();
    const { container } = await mount(Screen, { onError });
    await flush();

    expect(container.textContent).toBe('screen in fallback: broken child');
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { tag: 'cmp-err-child', phase: 'setup', caughtBy: 'cmp-err-screen' });
  });

  test('a renderError that crashes lets the error bubble up to the next parent', async () => {
    class Inner extends SuperElement {
      static tag = 'cmp-err-inner';
      render(): unknown {
        return fail('broken inner');
      }
      override renderError(): unknown {
        return fail('broken fallback');
      }
    }
    class Outer extends SuperElement {
      static tag = 'cmp-err-outer';
      render() {
        return html`${Inner.create()}`;
      }
      override renderError(error: Error) {
        return html`<p>outer: ${error.message}</p>`;
      }
    }
    const onError = vi.fn();
    const { container } = await mount(Outer, { onError });
    await flush();

    expect(container.textContent).toBe('outer: broken fallback');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'broken fallback' }), {
      tag: 'cmp-err-inner',
      phase: 'renderError',
      caughtBy: 'cmp-err-outer',
    });
  });

  test('without onError, a caught error goes to the console', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    class Broken extends SuperElement {
      static tag = 'cmp-err-console';
      render(): unknown {
        return fail('visible');
      }
      override renderError() {
        return html`<p>fallback</p>`;
      }
    }
    await mount(Broken);

    expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'visible' }));
    consoleError.mockRestore();
  });
});

describe('pending commands and outcomes, on the component side', () => {
  function createSaver() {
    let release: () => void = () => {};
    class SaverStore extends SuperStore<CmpSaverContract> implements Commands<SaverStore> {
      constructor() {
        super({ contract: 'cmp-saver', initialState: { saved: 0 } });
      }
      async save({ id }: { id: string }) {
        if (id === 'no') this.fail('refused');
        await new Promise<void>((resolve) => (release = resolve));
        this.set({ saved: this.get().saved + 1 });
      }
      crash() {
        throw new Error('bug');
      }
    }
    return { store: SaverStore.create(), release: () => release() };
  }

  test('pending re-renders the component at the start and at the end of the command', async () => {
    const { store, release } = createSaver();
    class Button extends SuperElement {
      static tag = 'cmp-saver-button';
      saver = this.contract('cmp-saver');
      saving = this.selector(() => this.saver.selectors.pending('save', { id: 'a' }));
      render() {
        return html`<button ?disabled=${this.saving.value} @click=${() => this.saver.send('save', { id: 'a' })}>save</button>`;
      }
    }
    const { container } = await mount(Button, { stores: [store] });
    const button = container.querySelector('button')!;

    button.click();
    await flush();
    expect(button.disabled).toBe(true);

    release();
    await flush();
    expect(button.disabled).toBe(false);
  });

  test('a declared failure sends nothing to the console; an unexpected exception does', async () => {
    const { store } = createSaver();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    class Actions extends SuperElement {
      static tag = 'cmp-saver-actions';
      saver = this.contract('cmp-saver');
      render() {
        return html`
          <button class="refuse" @click=${() => this.saver.send('save', { id: 'no' })}>refuse</button>
          <button class="crash" @click=${() => this.saver.send('crash')}>crash</button>
        `;
      }
    }
    const { container } = await mount(Actions, { stores: [store] });

    container.querySelector<HTMLButtonElement>('.refuse')!.click();
    await flush();
    expect(consoleError).not.toHaveBeenCalled();

    container.querySelector<HTMLButtonElement>('.crash')!.click();
    await flush();
    expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'bug' }));
    consoleError.mockRestore();
  });
});

describe('action errors: @event, on, mounted', () => {
  test('a crashing @click is reported (event phase) and the display stays in place', async () => {
    const onError = vi.fn();
    class Buttons extends SuperElement {
      static tag = 'cmp-act-click';
      local = this.state({ clicks: 0 });
      render() {
        return html`
          <button class="ok" @click=${() => this.local.set({ clicks: this.local.get().clicks + 1 })}>ok ${this.local.get().clicks}</button>
          <button class="sync" @click=${() => {
            throw new Error('broken click');
          }}>sync</button>
          <button class="async" @click=${async () => {
            throw new Error('broken async click');
          }}>async</button>
        `;
      }
    }
    const { container } = await mount(Buttons, { onError });

    container.querySelector<HTMLButtonElement>('.sync')!.click();
    container.querySelector<HTMLButtonElement>('.async')!.click();
    await flush();
    container.querySelector<HTMLButtonElement>('.ok')!.click();
    await flush();

    expect(onError).toHaveBeenNthCalledWith(1, expect.objectContaining({ message: 'broken click' }), {
      tag: 'cmp-act-click',
      phase: 'event',
      caughtBy: null,
    });
    expect(onError).toHaveBeenNthCalledWith(2, expect.objectContaining({ message: 'broken async click' }), {
      tag: 'cmp-act-click',
      phase: 'event',
      caughtBy: null,
    });
    expect(container.querySelector('.ok')!.textContent).toBe('ok 1'); // the other handlers still work
  });

  test('a crashing on listener is reported (listener phase)', async () => {
    const ping = fakeStore('cmp-ping', { state: {} });
    const onError = vi.fn();
    class Listener extends SuperElement {
      static tag = 'cmp-act-listener';
      ping = this.contract('cmp-ping');
      constructor() {
        super();
        this.ping.on('pinged', () => {
          throw new Error('broken listener');
        });
      }
      render() {
        return html`<p>still there</p>`;
      }
    }
    const { container } = await mount(Listener, { stores: [ping], onError });

    ping.emit('pinged');

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'broken listener' }), {
      tag: 'cmp-act-listener',
      phase: 'listener',
      caughtBy: null,
    });
    expect(container.textContent).toBe('still there');
  });

  test('a crashing mounted is reported (mount phase); a crashing unmounted goes to the console', async () => {
    const onError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    class Mounted extends SuperElement {
      static tag = 'cmp-act-mount';
      protected override mounted() {
        throw new Error('broken mount');
      }
      protected override unmounted() {
        throw new Error('broken cleanup');
      }
      render() {
        return html`<p>rendered</p>`;
      }
    }
    const mounted = await mount(Mounted, { onError });
    expect(mounted.container.textContent).toBe('rendered');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'broken mount' }), {
      tag: 'cmp-act-mount',
      phase: 'mount',
      caughtBy: null,
    });

    // unmounted runs once the element is removed from the DOM: it can no longer bubble up to the application.
    mounted.element.remove();
    await flush();
    expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'broken cleanup' }));
    consoleError.mockRestore();
  });

  test("without onError, a handler's error goes to the console", async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    class Broken extends SuperElement {
      static tag = 'cmp-act-console';
      render() {
        return html`<button @click=${() => {
          throw new Error('visible');
        }}>x</button>`;
      }
    }
    const { container } = await mount(Broken);

    container.querySelector('button')!.click();

    expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'visible' }));
    consoleError.mockRestore();
  });
});

describe('tools reserved for preparation', () => {
  test.each(['contract', 'state', 'selector', 'form', 'ref'] as const)('%s called in render throws an error', async (name) => {
    const onError = vi.fn();
    const counter = fakeStore('cmp-counter', { state: { n: 0 } });
    class Leaky extends SuperElement {
      static tag = `cmp-guard-${name}`;
      counter = this.contract('cmp-counter');
      render() {
        if (name === 'contract') this.contract('cmp-counter');
        if (name === 'state') this.state({});
        if (name === 'selector') this.selector(this.counter.selectors.n);
        if (name === 'form') this.form({} as never);
        if (name === 'ref') this.ref();
        return html`<p>never</p>`;
      }
      override renderError(error: Error) {
        return html`<p>${error.message}</p>`;
      }
    }
    const { container } = await mount(Leaky, { stores: [counter], onError });

    expect(container.textContent).toBe(
      `[super] <cmp-guard-${name}>: \`${name}\` is declared in a field or the constructor, not during render`,
    );
    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ phase: 'render' }));
  });

  test('on is forbidden during render, allowed in a handler', async () => {
    const counter = fakeStore('cmp-counter', { state: { n: 0 } });
    const heard = vi.fn();
    class Listener extends SuperElement {
      static tag = 'cmp-guard-on';
      counter = this.contract('cmp-counter');
      local = this.state({ inRender: false });
      render() {
        if (this.local.get().inRender) this.counter.on('ticked', heard);
        return html`
          <button class="handler" @click=${() => this.counter.on('ticked', heard)}>listen</button>
          <button class="render" @click=${() => this.local.set({ inRender: true })}>break</button>`;
      }
      override renderError(error: Error) {
        return html`<p>${error.message}</p>`;
      }
    }
    const { container } = await mount(Listener, { stores: [counter], onError: () => {} });

    container.querySelector<HTMLButtonElement>('.handler')!.click();
    counter.emit('ticked');
    expect(heard).toHaveBeenCalledTimes(1);

    container.querySelector<HTMLButtonElement>('.render')!.click();
    await flush();
    expect(container.textContent).toBe('[super] <cmp-guard-on>: `on` cannot be called during render');
  });
});
