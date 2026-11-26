import { createApp, createRouter, defineRouter, html, params, query, RouterOutlet, redirect, SuperElement } from '@super-ts/dom';
import { fakeStore, flush, mount, record } from '@super-ts/testing';
import { describe, expect, test, vi } from 'vitest';
import './__fixtures__/rt-session';

/**
 * Les routers de ces tests ne sont pas celui de l'app (typé par le fixture `app-router`) : leurs
 * écrans lisent la route active par une vue non typée.
 */
type LooseValue = (() => any) & { isValid(): boolean };
type LooseRouter = {
  current: { name(): string | null; params: Record<string, LooseValue>; query: Record<string, LooseValue> };
  at(name: string): { params: Record<string, LooseValue>; query: Record<string, LooseValue> };
};
const loose = (router: unknown) => router as LooseRouter;

class Home extends SuperElement {
  static tag = 'r-home';
  render() {
    return html`<h1>home</h1>`;
  }
}
class Item extends SuperElement {
  static tag = 'r-item';
  // On retient le paramètre du premier rendu : il change si l'écran est remonté.
  #mountedFor: string | null = null;
  render() {
    const id = loose(this.router).current.params.id!();
    this.#mountedFor ??= id;
    return html`<h1>item ${id} (monté pour ${this.#mountedFor})</h1>`;
  }
}
class Pair extends SuperElement {
  static tag = 'r-pair';
  render() {
    const { a, b } = loose(this.router).current.params;
    return html`<h1>${a!()}-${b!()}</h1>`;
  }
}
class Missing extends SuperElement {
  static tag = 'r-missing';
  render() {
    return html`<h1>introuvable</h1>`;
  }
}

const Router = defineRouter({ home: '/', item: '/items/:id', pair: '/pairs/:a/:b' }).screens(() => ({
  home: Home,
  item: Item,
  pair: Pair,
  '*': Missing,
}));
const memory = (initialPath = '/') => createRouter(Router, { mode: 'memory', initialPath });

describe('déclaration', () => {
  test("les écrans ne sont lus qu'à la création du router (imports circulaires écrans <-> router)", () => {
    const screens = vi.fn(() => ({ home: Home, item: Item, pair: Pair }));
    const lazy = defineRouter({ home: '/', item: '/items/:id', pair: '/pairs/:a/:b' }).screens(screens);
    expect(screens).not.toHaveBeenCalled();

    expect(createRouter(lazy, { mode: 'memory', initialPath: '/items/1' }).state().screen).toBe(Item);
    expect(screens).toHaveBeenCalledOnce();
  });

  test('this.router retrouve le router fourni à l’application', async () => {
    class Probe extends SuperElement {
      static tag = 'r-probe';
      route = this.selector(this.router.current.name);
      render() {
        return html`<p>${this.route.value}</p>`;
      }
    }
    const { container } = await mount(Probe, { router: memory('/items/1') });
    expect(container.textContent).toBe('item');
  });

  test('this.router se lit aussi pour la première fois dans render, et suit la route', async () => {
    class LateProbe extends SuperElement {
      static tag = 'r-late-probe';
      render() {
        return html`<a href=${this.router.href('item', { params: { id: 2 } })}>${this.router.current.name()}</a>`;
      }
    }
    const router = memory('/');
    const { container } = await mount(LateProbe, { router });
    expect(container.querySelector('a')!.getAttribute('href')).toBe('/items/2');
    expect(container.textContent).toBe('home');
    await router.send('visit', '/items/1');
    await Promise.resolve();
    expect(container.textContent).toBe('item');
  });

  test('un composant qui ne lit pas this.router se monte sans router', async () => {
    class NoRouter extends SuperElement {
      static tag = 'r-no-router';
      render() {
        return html`<p>ok</p>`;
      }
    }
    const { container } = await mount(NoRouter);
    expect(container.textContent).toBe('ok');
  });

  test("this.contract('router') est refusé : le router se lit par this.router", async () => {
    class Legacy extends SuperElement {
      static tag = 'r-legacy';
      nav = (this.contract as unknown as (name: string) => unknown)('router');
      render() {
        return html``;
      }
    }
    expect(() => Legacy.create()).toThrow(/this\.router/);
  });

  test('erreurs explicites à la déclaration et à la création', () => {
    expect(() => defineRouter({ bad: 'relative' })).toThrow(/doit commencer par "\/"/);
    const loose = defineRouter as (paths: Record<string, string>) => unknown;
    expect(() => loose({ '*': '/x' })).toThrow(/"\*" est réservé/);
    const withoutScreens = defineRouter({ home: '/' }) as unknown as Parameters<typeof createRouter>[0];
    expect(() => createRouter(withoutScreens)).toThrow(/déclare-les avec \.screens/);
    expect(() => createRouter({} as Parameters<typeof createRouter>[0])).toThrow(/defineRouter/);
  });
});

describe('résolution des chemins', () => {
  test('route statique, paramètres, paramètres multiples et décodage', () => {
    expect(memory('/').state()).toMatchObject({ name: 'home', params: {} });
    expect(memory('/items/42').state()).toMatchObject({ name: 'item', params: { id: '42' }, screen: Item });
    expect(memory('/pairs/x/y').state().params).toEqual({ a: 'x', b: 'y' });
    expect(memory('/items/caf%C3%A9').state().params).toEqual({ id: 'café' });
  });

  test('ignore le slash final, la query et le hash', () => {
    expect(memory('/items/42/').state().name).toBe('item');
    expect(memory('/items/42?tab=1#top').state()).toMatchObject({ name: 'item', path: '/items/42?tab=1#top' });
  });

  test("aucune correspondance : name null et écran '*'", () => {
    expect(memory('/items').state()).toMatchObject({ name: null, screen: Missing });
    const withoutFallback = defineRouter({ home: '/' }).screens(() => ({ home: Home }));
    expect(createRouter(withoutFallback, { mode: 'memory', initialPath: '/x' }).state().screen).toBeNull();
  });
});

describe('href', () => {
  test('construit les chemins et encode les paramètres', () => {
    expect(Router.href('home')).toBe('/');
    expect(Router.href('item', { params: { id: 'a b' } })).toBe('/items/a%20b');
  });

  test('erreurs explicites', () => {
    const untyped = Router.href as (name: string, input?: object) => string;
    expect(() => untyped('nope')).toThrow(/route inconnue "nope"/);
    expect(() => untyped('item', {})).toThrow(/paramètre "id" manquant/);
  });
});

describe('navigation', () => {
  test('navigate par nom, visit par chemin, événement navigated', async () => {
    const router = memory();
    const navigated = record(router, 'navigated');

    await router.send('navigate', { to: 'item', params: { id: '7' } });
    await router.send('visit', '/pairs/1/2');

    expect(router.state().name).toBe('pair');
    expect(navigated.calls).toEqual([
      { from: '/', to: '/items/7' },
      { from: '/items/7', to: '/pairs/1/2' },
    ]);
  });

  test('back en mode mémoire', async () => {
    const router = memory();
    await router.send('visit', '/items/1');
    await router.send('visit', '/items/2');

    await router.send('back');

    expect(router.state().params).toEqual({ id: '1' });
  });

  test('mode browser : pushState et popstate', async () => {
    history.replaceState(null, '', '/items/9');
    const router = createRouter(Router);
    expect(router.state().params).toEqual({ id: '9' });

    await router.send('navigate', { to: 'home' });
    expect(location.pathname).toBe('/');

    history.replaceState(null, '', '/items/3');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(router.state().params).toEqual({ id: '3' });
    router.dispose();
  });
});

describe('RouterOutlet et liens', () => {
  class Shell extends SuperElement {
    static tag = 'r-shell';
    render() {
      return html`
        <nav>
          <a href="/items/1">un</a>
          <a href="/items/2">deux</a>
          <a href="/items/3" target="_blank">nouvel onglet</a>
          <a href="https://example.com/items/4">externe</a>
          <a href="/items/5" data-native>natif</a>
        </nav>
        ${RouterOutlet.create()}`;
    }
  }

  async function start(initialPath = '/') {
    const router = memory(initialPath);
    const { container } = await mount(Shell, { router });
    const link = (text: string) => [...container.querySelectorAll('a')].find((a) => a.textContent === text)!;
    return { router, container, link };
  }

  test('rend l’écran de la route active, qui lit ses paramètres par this.router.current', async () => {
    const { container } = await start('/items/1');
    expect(container.querySelector('h1')!.textContent).toBe('item 1 (monté pour 1)');
  });

  test('un clic sur un lien interne navigue sans recharger', async () => {
    const { router, container, link } = await start();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });

    link('un').dispatchEvent(click);
    await flush();

    expect(click.defaultPrevented).toBe(true);
    expect(router.state().path).toBe('/items/1');
    expect(container.querySelector('h1')!.textContent).toContain('item 1');
  });

  test('chaque changement de chemin remonte un nouvel écran', async () => {
    const { container, link } = await start('/items/1');

    link('deux').click();
    await flush();

    expect(container.querySelector('h1')!.textContent).toBe('item 2 (monté pour 2)');
  });

  test('laisse le navigateur gérer target, externe, data-native et les modificateurs', async () => {
    const { router, link } = await start();
    const clicks = [
      [link('nouvel onglet'), {}],
      [link('externe'), {}],
      [link('natif'), {}],
      [link('un'), { metaKey: true }],
      [link('un'), { ctrlKey: true }],
    ] as const;

    // Après le router, on note la décision puis on empêche happy-dom de suivre réellement le lien.
    const prevented: boolean[] = [];
    const stopNavigation = (event: Event) => (prevented.push(event.defaultPrevented), event.preventDefault());
    window.addEventListener('click', stopNavigation);
    for (const [anchor, init] of clicks) {
      anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
    }
    window.removeEventListener('click', stopNavigation);

    expect(prevented).toEqual([false, false, false, false, false]);
    await flush();
    expect(router.state().path).toBe('/');
  });

  test('createApp sans router ne touche pas aux liens', () => {
    const root = document.createElement('div');
    root.innerHTML = '<a href="/items/1">un</a>';
    document.body.append(root);
    const app = createApp({ root });
    let prevented: boolean | null = null;
    const stopNavigation = (event: Event) => ((prevented = event.defaultPrevented), event.preventDefault());
    window.addEventListener('click', stopNavigation, { once: true });

    root.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));

    expect(prevented).toBe(false);
    app.dispose();
    root.remove();
  });
});

describe('redirections déclarées', () => {
  const Redirecting = defineRouter({ home: '/', stats: '/stats', item: '/items/:id', old: '/old/:id' }).screens(() => ({
    home: Home,
    stats: redirect({ to: 'home' }),
    item: Item,
    old: redirect({ to: 'item', params: { id: 'legacy' } }),
  }));

  test('le chemin initial redirigé remplace l’entrée d’historique', async () => {
    const router = createRouter(Redirecting, { mode: 'memory', initialPath: '/stats' });
    expect(router.state()).toMatchObject({ path: '/', name: 'home', screen: Home });

    await router.send('back'); // rien avant : l'entrée /stats a été remplacée
    expect(router.state().path).toBe('/');
  });

  test('une navigation vers une route redirigée aboutit à la cible, avec ses paramètres', async () => {
    const router = createRouter(Redirecting, { mode: 'memory' });
    const navigated = record(router, 'navigated');

    await router.send('visit', '/old/42');

    expect(router.state()).toMatchObject({ path: '/items/legacy', name: 'item', params: { id: 'legacy' } });
    expect(navigated.calls).toEqual([{ from: '/', to: '/items/legacy' }]);
  });

  test('une boucle de redirections lève une erreur explicite', () => {
    const Loop = defineRouter({ a: '/a', b: '/b' }).screens(() => ({ a: redirect({ to: 'b' }), b: redirect({ to: 'a' }) }));
    expect(() => createRouter(Loop, { mode: 'memory', initialPath: '/a' })).toThrow(/trop de redirections à partir de "\/a"/);
  });
});

describe('guards', () => {
  const session = (user: string | null) => fakeStore('rt-session', { state: { user } });

  class Account extends SuperElement {
    static tag = 'r-account';
    render() {
      return html`<h1>compte</h1>`;
    }
  }
  class Login extends SuperElement {
    static tag = 'r-login';
    render() {
      return html`<h1>connexion</h1>`;
    }
  }
  const Guarded = defineRouter({ home: '/', account: '/account', login: '/login', item: '/items/:id' })
    .guards(({ read }) => ({
      account: () => read('rt-session').isLoggedIn() || { to: 'login' },
      item: ({ params }) => params.id() !== 'secret' || { to: 'home' },
    }))
    .screens(() => ({ home: Home, account: Account, login: Login, item: Item }));

  test('une route refusée redirige, et la redirection est poussée à la place du chemin demandé', async () => {
    const router = createRouter(Guarded, { mode: 'memory' });
    await mount(RouterOutlet, { stores: [session(null)], router });

    await router.send('navigate', { to: 'account' });
    expect(router.state()).toMatchObject({ path: '/login', name: 'login' });

    await router.send('back');
    expect(router.state().path).toBe('/'); // /account n'est jamais entré dans l'historique
  });

  test('le guard lit l’état courant du store à chaque navigation', async () => {
    const store = session(null);
    const router = createRouter(Guarded, { mode: 'memory' });
    await mount(RouterOutlet, { stores: [store], router });

    store.setState({ user: 'ada' });
    await router.send('navigate', { to: 'account' });

    expect(router.state().name).toBe('account');
  });

  test('le guard reçoit les paramètres de sa route', async () => {
    const router = createRouter(Guarded, { mode: 'memory' });
    await mount(RouterOutlet, { stores: [session('ada')], router });

    await router.send('visit', '/items/secret');
    expect(router.state().name).toBe('home');
    await router.send('visit', '/items/1');
    expect(router.state().name).toBe('item');
  });

  test('le chemin courant passe par les guards quand le router rejoint l’application', async () => {
    const router = createRouter(Guarded, { mode: 'memory', initialPath: '/account' });
    expect(router.state().name).toBe('account'); // pas encore d'application : pas de stores à lire

    const { container } = await mount(RouterOutlet, { stores: [session(null)], router });

    expect(router.state().name).toBe('login');
    expect(container.textContent).toBe('connexion');
  });

  test('un store absent de l’application lève une erreur explicite', () => {
    const router = createRouter(Guarded, { mode: 'memory', initialPath: '/account' });
    expect(() => createApp({ root: document.createElement('div'), router })).toThrow(
      /guard du router : aucun store fourni pour le contrat "rt-session"/,
    );
  });
});

describe("écran '!'", () => {
  class Broken extends SuperElement {
    static tag = 'r-broken';
    constructor() {
      super();
      throw new Error('écran cassé');
    }
    render() {
      return null;
    }
  }
  class Oops extends SuperElement<{ props: { error: Error; path: string } }> {
    static tag = 'r-oops';
    render() {
      return html`<p>${this.props.error.message} sur ${this.props.path}</p>`;
    }
  }
  const WithErrorScreen = defineRouter({ home: '/', broken: '/broken' }).screens(() => ({ home: Home, broken: Broken, '!': Oops }));

  test("un écran qui plante sans être rattrapé est remplacé par l’écran '!', qui reçoit l’erreur", async () => {
    const onError = vi.fn();
    const router = createRouter(WithErrorScreen, { mode: 'memory', initialPath: '/broken' });
    const { container } = await mount(RouterOutlet, { router, onError });
    await flush();

    expect(container.textContent).toBe('écran cassé sur /broken');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'écran cassé' }), {
      tag: 'r-broken',
      phase: 'setup',
      caughtBy: 'super-router-outlet',
    });
  });

  test('naviguer ailleurs affiche de nouveau l’écran de la route', async () => {
    const router = createRouter(WithErrorScreen, { mode: 'memory', initialPath: '/broken' });
    const { container } = await mount(RouterOutlet, { router, onError: () => {} });
    await flush();

    await router.send('navigate', { to: 'home' });
    await flush();

    expect(container.textContent).toBe('home');
  });
});

test('guards : déclarés après les écrans, une erreur explicite (le typage l’interdit déjà)', () => {
  const declared = defineRouter({ home: '/' }).screens(() => ({ home: Home }));
  expect(() => (declared as unknown as { guards(define: unknown): unknown }).guards(() => ({}))).toThrow(
    /déclare les guards avec \.guards\(\.\.\.\) avant \.screens\(\.\.\.\)/,
  );
});

describe("écran '!' : en sortir", () => {
  let broken = true;
  class Flaky extends SuperElement {
    static tag = 'r-flaky';
    constructor() {
      super();
      if (broken) throw new Error('écran cassé');
    }
    render() {
      return html`<h1>réparé</h1>`;
    }
  }
  class Oops extends SuperElement<{ props: { error: Error; path: string } }> {
    static tag = 'r-oops-exit';
    render() {
      return html`<p>oups ${this.props.path}</p>`;
    }
  }
  const Recovering = defineRouter({ home: '/', flaky: '/flaky' }).screens(() => ({ home: Home, flaky: Flaky, '!': Oops }));

  test('revenir sur le chemin en erreur après être allé ailleurs remonte l’écran, au lieu de réafficher l’erreur', async () => {
    broken = true;
    const router = createRouter(Recovering, { mode: 'memory', initialPath: '/flaky' });
    const { container } = await mount(RouterOutlet, { router, onError: () => {} });
    await flush();
    expect(container.textContent).toBe('oups /flaky');

    broken = false;
    await router.send('navigate', { to: 'home' });
    await router.send('navigate', { to: 'flaky' });
    await flush();

    expect(container.textContent).toBe('réparé');
  });

  test('naviguer vers le chemin courant remonte l’écran (recliquer sur le lien de la page en erreur)', async () => {
    broken = true;
    const router = createRouter(Recovering, { mode: 'memory', initialPath: '/flaky' });
    const navigated = record(router, 'navigated');
    const { container } = await mount(RouterOutlet, { router, onError: () => {} });
    await flush();
    expect(container.textContent).toBe('oups /flaky');

    broken = false;
    await router.send('visit', '/flaky');
    await flush();

    expect(container.textContent).toBe('réparé');
    expect(navigated.last).toEqual({ from: '/flaky', to: '/flaky' }); // rien dans l'historique, mais l'événement part
  });
});

describe('query déclarée dans la chaîne', () => {
  class List extends SuperElement {
    static tag = 'r-q-list';
    // Propre à l'instance : change si l'écran est remonté.
    #mount = Math.random();
    render() {
      const { sort, tag } = loose(this.router).current.query;
      return html`<h1 data-mount=${this.#mount}>${sort!() ?? '-'} [${tag!().join(',')}]</h1>`;
    }
  }
  class Detail extends SuperElement {
    static tag = 'r-q-detail';
    render() {
      const { current } = loose(this.router);
      return html`<h1>${current.params.id!()} ${current.query.tab!() ?? '-'}</h1>`;
    }
  }
  const WithQuery = defineRouter({ home: '/', list: '/list?sort&tag[]', detail: '/items/:id?tab' }).screens(() => ({
    home: Home,
    list: List,
    detail: Detail,
  }));
  const start = (initialPath = '/') => createRouter(WithQuery, { mode: 'memory', initialPath });

  test('lit les clés déclarées : plusieurs clés, listes, absentes, non déclarées ignorées', () => {
    expect(start('/list?sort=asc&tag=a&tag=b&other=1').state()).toMatchObject({
      name: 'list',
      params: {},
      query: { sort: 'asc', tag: ['a', 'b'] },
      path: '/list?sort=asc&tag=a&tag=b&other=1',
    });
    expect(start('/list').state().query).toEqual({ sort: undefined, tag: [] });
    expect(start('/items/7?tab=hist#top').state()).toMatchObject({ params: { id: '7' }, query: { tab: 'hist' } });
    expect(start('/list?tag=caf%C3%A9&tag=a+b').state().query).toMatchObject({ tag: ['café', 'a b'] });
  });

  test('href et navigate : paramètres et query séparés', async () => {
    expect(WithQuery.href('list')).toBe('/list');
    expect(WithQuery.href('list', { query: { sort: 'asc', tag: ['a', 'b'] } })).toBe('/list?sort=asc&tag=a&tag=b');
    expect(WithQuery.href('list', { query: { tag: [] } })).toBe('/list');
    expect(WithQuery.href('detail', { params: { id: 'a b' }, query: { tab: 'x&y' } })).toBe('/items/a%20b?tab=x%26y');

    const router = start();
    await router.send('navigate', { to: 'detail', params: { id: '1' }, query: { tab: 'hist' } });
    expect(router.state()).toMatchObject({ path: '/items/1?tab=hist', params: { id: '1' }, query: { tab: 'hist' } });
  });

  test('changer la query seule ne remonte pas l’écran, qui se re-rend', async () => {
    const router = start('/list?sort=asc');
    const { container } = await mount(RouterOutlet, { router });
    const h1 = () => container.querySelector('h1')!;
    expect(h1().textContent).toBe('asc []');
    const mounted = h1().dataset.mount;

    await router.send('navigate', { to: 'list', query: { sort: 'desc', tag: ['a'] } });
    await flush();
    expect(h1().textContent).toBe('desc [a]');
    expect(h1().dataset.mount).toBe(mounted);

    await router.send('visit', '/items/3?tab=hist');
    await flush();
    expect(h1().textContent).toBe('3 hist');
  });

  test('les guards reçoivent paramètres et query de leur route', async () => {
    const Guarded = defineRouter({ home: '/', detail: '/items/:id?tab' })
      .guards(() => ({ detail: ({ params, query }) => !(params.id() === '1' && query.tab() === 'admin') || { to: 'home' } }))
      .screens(() => ({ home: Home, detail: Detail }));
    const router = createRouter(Guarded, { mode: 'memory' });
    await mount(RouterOutlet, { router });

    await router.send('visit', '/items/1?tab=admin');
    expect(router.state().name).toBe('home');
    await router.send('visit', '/items/1?tab=hist');
    expect(router.state().name).toBe('detail');
  });

  test('déclarations invalides : clé vide, clé en double', () => {
    const untyped = defineRouter as (paths: Record<string, string>) => unknown;
    expect(() => untyped({ a: '/a?' })).toThrow(/clé de query vide/);
    expect(() => untyped({ a: '/a?x&x[]' })).toThrow(/"x" apparaît deux fois/);
    // Paramètres et query sont lus séparément : un même nom ne les confond plus.
    expect(() => untyped({ a: '/a/:id?id' })).not.toThrow();
  });
});

describe('routes décrites : valeurs typées', () => {
  type ListQuery = { sort: 'label' | 'value'; page: number; tag: number[]; search?: string; archived?: boolean };
  const Typed = defineRouter({
    home: '/',
    item: { path: '/items/:id', params: params<{ id: number }>({ id: Number }) },
    list: {
      path: '/list',
      query: query<ListQuery>({
        sort: { oneOf: ['label', 'value'], default: 'label' },
        page: { type: Number, default: 1 },
        tag: [Number],
        search: String,
        archived: Boolean,
      }),
    },
  });

  class ItemScreen extends SuperElement {
    static tag = 'r-t-item';
    #router = loose(this.router);
    itemId = this.selector(this.#router.current.params.id as never) as unknown as { value: number | undefined; isValid(): boolean };
    renders = 0;
    render() {
      this.renders++;
      if (!this.itemId.isValid()) return html`<p>introuvable</p>`;
      return html`<p>item ${this.itemId.value! + 1}</p>`;
    }
  }
  class ListScreen extends SuperElement {
    static tag = 'r-t-list';
    pageNumber = this.selector(loose(this.router).current.query.page as never) as unknown as { value: number; isValid(): boolean };
    renders = 0;
    render() {
      this.renders++;
      return html`<p>page ${this.pageNumber.value} ${this.pageNumber.isValid() ? 'ok' : 'corrigée'}</p>`;
    }
  }
  const Router = Typed.screens(() => ({ home: Home, item: ItemScreen, list: ListScreen }));
  const start = (initialPath = '/') => createRouter(Router, { mode: 'memory', initialPath });

  test('paramètres convertis ; un paramètre invalide vaut undefined et reste sur l’écran de la route', () => {
    expect(start('/items/42').state()).toMatchObject({ name: 'item', params: { id: 42 }, invalid: { params: [], query: [] } });
    expect(start('/items/abc').state()).toMatchObject({ name: 'item', params: { id: undefined }, invalid: { params: ['id'] } });
    expect(start('/items/1.5').state().params).toEqual({ id: 1.5 });
  });

  test('query convertie : défaut si absente, défaut et invalide si non conforme, listes filtrées', () => {
    expect(start('/list').state().query).toEqual({ sort: 'label', page: 1, tag: [], search: undefined, archived: undefined });
    expect(start('/list?sort=value&page=3&tag=1&tag=2&search=x&archived=true').state().query).toEqual({
      sort: 'value',
      page: 3,
      tag: [1, 2],
      search: 'x',
      archived: true,
    });
    const invalid = start('/list?sort=nope&page=abc&tag=1&tag=x&archived=oui').state();
    expect(invalid.query).toEqual({ sort: 'label', page: 1, tag: [1], search: undefined, archived: undefined });
    expect(invalid.invalid.query).toEqual(['sort', 'page', 'tag', 'archived']);
  });

  test('href : valeurs typées écrites dans l’URL', () => {
    expect(Router.href('item', { params: { id: 7 } })).toBe('/items/7');
    expect(Router.href('list', { query: { sort: 'value', page: 2, tag: [1, 2], archived: false } })).toBe(
      '/list?sort=value&page=2&tag=1&tag=2&archived=false',
    );
  });

  test('l’écran gère lui-même un paramètre invalide', async () => {
    const router = start('/items/abc');
    const { container } = await mount(RouterOutlet, { router });
    expect(container.textContent).toBe('introuvable');

    await router.send('navigate', { to: 'item', params: { id: 41 } });
    await flush();
    expect(container.textContent).toBe('item 42');
  });

  test('selector : re-rend quand la valeur change, ou quand seule sa validité change', async () => {
    const router = start('/list?page=2');
    const { container } = await mount(RouterOutlet, { router });
    const screen = container.querySelector('r-t-list') as ListScreen;
    expect(container.textContent).toBe('page 2 ok');

    await router.send('visit', '/list?page=2&search=x'); // autre clé : pas de nouveau rendu
    await flush();
    expect(screen.renders).toBe(1);

    await router.send('visit', '/list?page=1');
    await flush();
    expect(container.textContent).toBe('page 1 ok');

    await router.send('visit', '/list?page=abc'); // même valeur (le défaut), mais invalide
    await flush();
    expect(container.textContent).toBe('page 1 corrigée');
  });

  test('isValid : faux pour une clé que la route active ne déclare pas', async () => {
    let seen: unknown[] = [];
    class Probe extends SuperElement {
      static tag = 'r-t-probe';
      render() {
        const { current } = loose(this.router);
        seen = [current.params.id!(), current.params.id!.isValid(), current.query.page!(), current.query.page!.isValid()];
        return null;
      }
    }
    await mount(Probe, { router: start('/list') });
    expect(seen).toEqual([undefined, false, 1, true]);
  });

  test('at : lit une route précise, et lève une erreur si la route active est une autre', async () => {
    let read: () => unknown = () => null;
    class Breadcrumb extends SuperElement {
      static tag = 'r-t-breadcrumb';
      item = loose(this.router).at('item');
      render() {
        read = () => this.item.params.id!();
        return html`<p>${read()}</p>`;
      }
    }
    const router = start('/items/5');
    const { container } = await mount(Breadcrumb, { router, onError: () => {} });
    expect(container.textContent).toBe('5');

    await router.send('visit', '/list');
    expect(read).toThrow(/this\.router\.at\('item'\) lu alors que la route active est 'list'/);
  });

  test('at dans un selector : quitter la route passe par le rendu (et son erreur), pas par le router', async () => {
    const onError = vi.fn();
    class Crumb extends SuperElement {
      static tag = 'r-t-crumb';
      crumb = this.selector(loose(this.router).at('item').params.id as never) as unknown as { value: unknown };
      render() {
        return html`<p>${this.crumb.value}</p>`;
      }
    }
    const router = start('/items/5');
    const { container } = await mount(Crumb, { router, onError });
    expect(container.textContent).toBe('5');

    await router.send('visit', '/list'); // ne lève pas dans le router
    await flush();
    expect(router.state().name).toBe('list');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/at\('item'\)/) }), expect.anything());
  });

  test('guards : valeurs typées et validité', async () => {
    const Guarded = Typed.guards(() => ({ item: ({ params }) => params.id.isValid() || { to: 'list' } })).screens(() => ({
      home: Home,
      item: ItemScreen,
      list: ListScreen,
    }));
    const router = createRouter(Guarded, { mode: 'memory' });
    await mount(RouterOutlet, { router });

    await router.send('visit', '/items/abc');
    expect(router.state().name).toBe('list');
  });

  test('descriptions invalides : erreurs explicites', () => {
    const untyped = defineRouter as (paths: Record<string, unknown>) => unknown;
    expect(() => untyped({ a: { path: '/a/:id', params: params<{ slug: string }>({ slug: String }) } })).toThrow(
      /params doit décrire exactement les paramètres du chemin \(id\)/,
    );
    expect(() => untyped({ a: { path: '/a?x' } })).toThrow(/la query se décrit par query<T>/);
    expect(() => untyped({ a: { path: '/a', query: query<{ x?: string }>({ x: Date as never }) } })).toThrow(
      /clé "x" de la route "a" : attendu String, Number, Boolean ou \{ oneOf/,
    );
  });
});
