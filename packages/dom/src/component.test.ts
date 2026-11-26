import { type Commands, SuperStore } from '@super-ts/core';
import { createApp, html, repeat, SuperElement } from '@super-ts/dom';
import { fakeStore, flush, mount } from '@super-ts/testing';
import { describe, expect, test, vi } from 'vitest';
import './__fixtures__/cmp-contracts';
import type { CmpBoardContract, CmpClockContract, CmpListedContract, CmpSaverContract } from './__fixtures__/cmp-contracts';

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

describe('composant', () => {
  test('rend le template, échappe les interpolations et re-rend quand les props changent', async () => {
    class Hello extends SuperElement<{ props: { name: string } }> {
      static tag = 'cmp-hello';
      render() {
        return html`<p>Bonjour ${this.props.name}</p>`;
      }
    }

    const mounted = await mount(Hello, { props: { name: '<b>Ada</b>' } });
    expect(mounted.container.querySelector('p')!.textContent).toBe('Bonjour <b>Ada</b>');
    expect(mounted.container.querySelector('b')).toBeNull();

    await mounted.setProps({ name: 'Grace' });
    expect(mounted.container.textContent).toContain('Grace');
  });

  test('état local : set merge et re-rend', async () => {
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

  test('un enfant ne se re-rend pas quand le parent repasse les mêmes props', async () => {
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

  test('le parent garde la même instance enfant et met à jour ses props', async () => {
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

  test('un dialogue s’ouvre par une prop et répond par un événement, sans await dans le parent', async () => {
    class Confirm extends SuperElement<{ props: { question: string | null }; emits: { answered: { confirmed: boolean } } }> {
      static tag = 'cmp-confirm';
      render() {
        const { question } = this.props;
        return question
          ? html`<p>${question}</p>
              <button class="no" @click=${() => this.emit('answered', { confirmed: false })}>Non</button>
              <button class="yes" @click=${() => this.emit('answered', { confirmed: true })}>Oui</button>`
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
          <button class="go" @click=${() => this.local.set({ question: 'Continuer ?' })}>Go</button>
          ${Confirm.create({ question: this.local.get().question }, { on: { answered: this.onAnswered } })}
        `;
      }
    }

    const { container } = await mount(Screen);
    container.querySelector<HTMLButtonElement>('.go')!.click();
    await flush();
    expect(container.textContent).toContain('Continuer ?');

    container.querySelector<HTMLButtonElement>('cmp-confirm .yes')!.click();
    await flush();
    expect(answers).toEqual([true]);
    expect(container.textContent).not.toContain('Continuer ?');
  });

  test('mounted s’exécute après le premier rendu ; unmounted et le signal au démontage', async () => {
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
        return html`<span>prêt</span>`;
      }
    }

    const mounted = await mount(Widget);
    expect(signal.aborted).toBe(false);
    mounted.unmount();
    await flush();

    expect(calls).toEqual(['mount:prêt', 'cleanup']);
    expect(signal.aborted).toBe(true);
  });

  test('un enfant déplacé par repeat garde son état local', async () => {
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

describe('contrats et createApp', () => {
  class ClockView extends SuperElement {
    static tag = 'cmp-clock-view';
    clock = this.contract('cmp-clock');
    now = this.selector(this.clock.selectors.now);
    render() {
      return html`<button @click=${() => this.clock.send('tick')}>${this.now.value}</button>`;
    }
  }

  test('createApp fournit les stores à tout ce qui est rendu sous la racine', async () => {
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

  test('un store manquant produit une erreur explicite', () => {
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
    expect(String(errors[0])).toMatch(/aucun store fourni pour le contrat "cmp-clock"/);
  });

  test('deux stores pour le même contrat sont refusés', () => {
    expect(() => createApp({ root: document.createElement('div'), stores: [ClockStore.create(), ClockStore.create()] })).toThrow(
      /deux stores/,
    );
  });

  test('le composant se désabonne du store au démontage', async () => {
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
    test('ne re-rend que si la valeur sélectionnée change', async () => {
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

    test('un objet recréé à l’identique ne re-rend pas', async () => {
      const board = BoardStore.create();
      const renders = vi.fn();
      class Pair extends SuperElement {
        static tag = 'cmp-score-pair';
        board = this.contract('cmp-board');
        pair = this.selector(this.board.selectors.pair); // un objet neuf à chaque lecture
        render() {
          renders(this.pair.value);
          return null;
        }
      }
      await mount(Pair, { stores: [board] });

      await board.send('score', { id: 'a', value: 1 }); // même valeur, nouvel objet scores
      await board.send('setStatus', 'busy');
      await flush();
      expect(renders).toHaveBeenCalledTimes(1);
    });

    test('un selector qui lit les props compare avec ce qui a été rendu', async () => {
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

      // b passe à 1, la valeur de a au premier rendu : il faut quand même re-rendre.
      await board.send('score', { id: 'b', value: 1 });
      await flush();
      expect(mounted.container.textContent).toBe('1');
    });

    test('une liste construite par le sélecteur ne re-rend que si son contenu change', async () => {
      const store = ListedStore.create();
      const renders = vi.fn();
      class List extends SuperElement {
        static tag = 'cmp-listed-view';
        listed = this.contract('cmp-listed');
        // Tableau recréé à chaque lecture : stabilisé par Super.
        labels = this.selector(this.listed.selectors.labels);
        render() {
          renders();
          return html`<p>${this.labels.value.join(',')}</p>`;
        }
      }
      const { container } = await mount(List, { stores: [store] });

      await store.send('note', 'hors liste');
      await flush();
      expect(renders).toHaveBeenCalledTimes(1);

      await store.send('add', 'a');
      await flush();
      expect(renders).toHaveBeenCalledTimes(2);
      expect(container.textContent).toBe('a2');
    });
  });
});

describe('frontière d’erreur : renderError et onError', () => {
  const fail = (message: string): never => {
    throw new Error(message);
  };

  test('une erreur au premier rendu affiche le renderError du composant, avec ses props', async () => {
    class Broken extends SuperElement<{ props: { id: string } }> {
      static tag = 'cmp-err-first';
      render(): unknown {
        return fail('rendu cassé');
      }
      override renderError(error: Error) {
        return html`<p>${this.props.id} : ${error.message}</p>`;
      }
    }
    const onError = vi.fn();
    const { container } = await mount(Broken, { props: { id: 'cafes' }, onError });

    expect(container.textContent).toBe('cafes : rendu cassé');
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { tag: 'cmp-err-first', phase: 'render', caughtBy: 'cmp-err-first' });
  });

  test('une erreur dans un rendu suivant bascule sur renderError', async () => {
    class Flaky extends SuperElement {
      static tag = 'cmp-err-render';
      local = this.state({ broken: false });
      render(): unknown {
        return this.local.get().broken
          ? fail('rendu cassé')
          : html`<button @click=${() => this.local.set({ broken: true })}>casser</button>`;
      }
      override renderError(error: Error) {
        return html`<p>repli : ${error.message}</p>`;
      }
    }
    const { container } = await mount(Flaky, { onError: () => {} });

    container.querySelector('button')!.click();
    await flush();

    expect(container.textContent).toBe('repli : rendu cassé');
  });

  test('le renderError d’un ancêtre rattrape l’erreur d’un descendant, à travers un intermédiaire', async () => {
    class Child extends SuperElement {
      static tag = 'cmp-err-child';
      constructor() {
        super();
        fail('enfant cassé');
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
        return html`<h1>écran</h1>${Middle.create()}`;
      }
      override renderError(error: Error) {
        return html`<p>écran en repli : ${error.message}</p>`;
      }
    }
    const onError = vi.fn();
    const { container } = await mount(Screen, { onError });
    await flush();

    expect(container.textContent).toBe('écran en repli : enfant cassé');
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { tag: 'cmp-err-child', phase: 'setup', caughtBy: 'cmp-err-screen' });
  });

  test('un renderError qui plante laisse l’erreur remonter au parent suivant', async () => {
    class Inner extends SuperElement {
      static tag = 'cmp-err-inner';
      render(): unknown {
        return fail('intérieur cassé');
      }
      override renderError(): unknown {
        return fail('repli cassé');
      }
    }
    class Outer extends SuperElement {
      static tag = 'cmp-err-outer';
      render() {
        return html`${Inner.create()}`;
      }
      override renderError(error: Error) {
        return html`<p>extérieur : ${error.message}</p>`;
      }
    }
    const onError = vi.fn();
    const { container } = await mount(Outer, { onError });
    await flush();

    expect(container.textContent).toBe('extérieur : repli cassé');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'repli cassé' }), {
      tag: 'cmp-err-inner',
      phase: 'renderError',
      caughtBy: 'cmp-err-outer',
    });
  });

  test('sans onError, une erreur rattrapée part dans la console', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    class Broken extends SuperElement {
      static tag = 'cmp-err-console';
      render(): unknown {
        return fail('visible');
      }
      override renderError() {
        return html`<p>repli</p>`;
      }
    }
    await mount(Broken);

    expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'visible' }));
    consoleError.mockRestore();
  });
});

describe('commandes en cours et issues, côté composant', () => {
  function createSaver() {
    let release: () => void = () => {};
    class SaverStore extends SuperStore<CmpSaverContract> implements Commands<SaverStore> {
      constructor() {
        super({ contract: 'cmp-saver', initialState: { saved: 0 } });
      }
      async save({ id }: { id: string }) {
        if (id === 'non') this.fail('refused');
        await new Promise<void>((resolve) => (release = resolve));
        this.set({ saved: this.get().saved + 1 });
      }
      crash() {
        throw new Error('bug');
      }
    }
    return { store: SaverStore.create(), release: () => release() };
  }

  test('pending re-rend le composant au début et à la fin de la commande', async () => {
    const { store, release } = createSaver();
    class Button extends SuperElement {
      static tag = 'cmp-saver-button';
      saver = this.contract('cmp-saver');
      saving = this.selector(() => this.saver.selectors.pending('save', { id: 'a' }));
      render() {
        return html`<button ?disabled=${this.saving.value} @click=${() => this.saver.send('save', { id: 'a' })}>enregistrer</button>`;
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

  test('un échec déclaré ne remonte rien dans la console ; une exception inattendue, si', async () => {
    const { store } = createSaver();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    class Actions extends SuperElement {
      static tag = 'cmp-saver-actions';
      saver = this.contract('cmp-saver');
      render() {
        return html`
          <button class="refuse" @click=${() => this.saver.send('save', { id: 'non' })}>refuser</button>
          <button class="crash" @click=${() => this.saver.send('crash')}>planter</button>
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

describe('erreurs d’action : @événement, on, mounted', () => {
  test('un @click qui plante est signalé (phase event) et l’affichage reste en place', async () => {
    const onError = vi.fn();
    class Buttons extends SuperElement {
      static tag = 'cmp-act-click';
      local = this.state({ clicks: 0 });
      render() {
        return html`
          <button class="ok" @click=${() => this.local.set({ clicks: this.local.get().clicks + 1 })}>ok ${this.local.get().clicks}</button>
          <button class="sync" @click=${() => {
            throw new Error('clic cassé');
          }}>sync</button>
          <button class="async" @click=${async () => {
            throw new Error('clic asynchrone cassé');
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

    expect(onError).toHaveBeenNthCalledWith(1, expect.objectContaining({ message: 'clic cassé' }), {
      tag: 'cmp-act-click',
      phase: 'event',
      caughtBy: null,
    });
    expect(onError).toHaveBeenNthCalledWith(2, expect.objectContaining({ message: 'clic asynchrone cassé' }), {
      tag: 'cmp-act-click',
      phase: 'event',
      caughtBy: null,
    });
    expect(container.querySelector('.ok')!.textContent).toBe('ok 1'); // les autres gestionnaires marchent toujours
  });

  test('un écouteur on qui plante est signalé (phase listener)', async () => {
    const ping = fakeStore('cmp-ping', { state: {} });
    const onError = vi.fn();
    class Listener extends SuperElement {
      static tag = 'cmp-act-listener';
      ping = this.contract('cmp-ping');
      constructor() {
        super();
        this.ping.on('pinged', () => {
          throw new Error('écouteur cassé');
        });
      }
      render() {
        return html`<p>toujours là</p>`;
      }
    }
    const { container } = await mount(Listener, { stores: [ping], onError });

    ping.emit('pinged');

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'écouteur cassé' }), {
      tag: 'cmp-act-listener',
      phase: 'listener',
      caughtBy: null,
    });
    expect(container.textContent).toBe('toujours là');
  });

  test('un mounted qui plante est signalé (phase mount) ; un unmounted qui plante part dans la console', async () => {
    const onError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    class Mounted extends SuperElement {
      static tag = 'cmp-act-mount';
      protected override mounted() {
        throw new Error('montage cassé');
      }
      protected override unmounted() {
        throw new Error('nettoyage cassé');
      }
      render() {
        return html`<p>rendu</p>`;
      }
    }
    const mounted = await mount(Mounted, { onError });
    expect(mounted.container.textContent).toBe('rendu');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'montage cassé' }), {
      tag: 'cmp-act-mount',
      phase: 'mount',
      caughtBy: null,
    });

    // unmounted s'exécute une fois l'élément retiré du DOM : il ne peut plus remonter à l'application.
    mounted.element.remove();
    await flush();
    expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'nettoyage cassé' }));
    consoleError.mockRestore();
  });

  test('sans onError, l’erreur d’un gestionnaire part dans la console', async () => {
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

describe('outils réservés à la préparation', () => {
  test.each(['contract', 'state', 'selector', 'form', 'ref'] as const)('%s appelé dans render lève une erreur', async (name) => {
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
        return html`<p>jamais</p>`;
      }
      override renderError(error: Error) {
        return html`<p>${error.message}</p>`;
      }
    }
    const { container } = await mount(Leaky, { stores: [counter], onError });

    expect(container.textContent).toBe(
      `[super] <cmp-guard-${name}> : \`${name}\` se déclare dans un champ ou le constructeur, pas pendant render`,
    );
    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ phase: 'render' }));
  });

  test('on est interdit pendant render, permis dans un gestionnaire', async () => {
    const counter = fakeStore('cmp-counter', { state: { n: 0 } });
    const heard = vi.fn();
    class Listener extends SuperElement {
      static tag = 'cmp-guard-on';
      counter = this.contract('cmp-counter');
      local = this.state({ inRender: false });
      render() {
        if (this.local.get().inRender) this.counter.on('ticked', heard);
        return html`
          <button class="handler" @click=${() => this.counter.on('ticked', heard)}>écouter</button>
          <button class="render" @click=${() => this.local.set({ inRender: true })}>casser</button>`;
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
    expect(container.textContent).toBe("[super] <cmp-guard-on> : `on` ne s'appelle pas pendant render");
  });
});
