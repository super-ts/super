import { createApp, createRouter, defineRouter, html, params, query, RouterOutlet, redirect, SuperElement } from '@super-ts/dom';
import { fakeStore, flush, mount, record } from '@super-ts/testing';
import { describe, expect, test, vi } from 'vitest';
import './__fixtures__/rt-session.ts';

/**
 * The routers of these tests are not the app's (typed by the `app-router` fixture): their
 * screens read the active route through an untyped view.
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
  // Remember the parameter of the first render: it changes if the screen is remounted.
  #mountedFor: string | null = null;
  render() {
    const id = loose(this.router).current.params.id!();
    this.#mountedFor ??= id;
    return html`<h1>item ${id} (mounted for ${this.#mountedFor})</h1>`;
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
    return html`<h1>not found</h1>`;
  }
}

const Router = defineRouter({ home: '/', item: '/items/:id', pair: '/pairs/:a/:b' }).screens(() => ({
  home: Home,
  item: Item,
  pair: Pair,
  '*': Missing,
}));
const memory = (initialPath = '/') => createRouter(Router, { mode: 'memory', initialPath });

describe('declaration', () => {
  test('the screens are only read when the router is created (circular imports screens <-> router)', () => {
    const screens = vi.fn(() => ({ home: Home, item: Item, pair: Pair }));
    const lazy = defineRouter({ home: '/', item: '/items/:id', pair: '/pairs/:a/:b' }).screens(screens);
    expect(screens).not.toHaveBeenCalled();

    expect(createRouter(lazy, { mode: 'memory', initialPath: '/items/1' }).state().screen).toBe(Item);
    expect(screens).toHaveBeenCalledOnce();
  });

  test('this.router finds the router provided to the application', async () => {
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

  test('this.router can also be read for the first time in render, and follows the route', async () => {
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

  test('a component that does not read this.router mounts without a router', async () => {
    class NoRouter extends SuperElement {
      static tag = 'r-no-router';
      render() {
        return html`<p>ok</p>`;
      }
    }
    const { container } = await mount(NoRouter);
    expect(container.textContent).toBe('ok');
  });

  test("this.contract('router') is refused: the router is read through this.router", async () => {
    class Legacy extends SuperElement {
      static tag = 'r-legacy';
      nav = (this.contract as unknown as (name: string) => unknown)('router');
      render() {
        return html``;
      }
    }
    expect(() => Legacy.create()).toThrow(/this\.router/);
  });

  test('explicit errors at declaration and creation', () => {
    expect(() => defineRouter({ bad: 'relative' })).toThrow(/must start with "\/"/);
    const loose = defineRouter as (paths: Record<string, string>) => unknown;
    expect(() => loose({ '*': '/x' })).toThrow(/"\*" is reserved/);
    const withoutScreens = defineRouter({ home: '/' }) as unknown as Parameters<typeof createRouter>[0];
    expect(() => createRouter(withoutScreens)).toThrow(/declare them with \.screens/);
    expect(() => createRouter({} as Parameters<typeof createRouter>[0])).toThrow(/defineRouter/);
  });
});

describe('path resolution', () => {
  test('static route, parameters, multiple parameters and decoding', () => {
    expect(memory('/').state()).toMatchObject({ name: 'home', params: {} });
    expect(memory('/items/42').state()).toMatchObject({ name: 'item', params: { id: '42' }, screen: Item });
    expect(memory('/pairs/x/y').state().params).toEqual({ a: 'x', b: 'y' });
    expect(memory('/items/caf%C3%A9').state().params).toEqual({ id: 'café' });
  });

  test('ignores the trailing slash, the query and the hash', () => {
    expect(memory('/items/42/').state().name).toBe('item');
    expect(memory('/items/42?tab=1#top').state()).toMatchObject({ name: 'item', path: '/items/42?tab=1#top' });
  });

  test("no match: name null and '*' screen", () => {
    expect(memory('/items').state()).toMatchObject({ name: null, screen: Missing });
    const withoutFallback = defineRouter({ home: '/' }).screens(() => ({ home: Home }));
    expect(createRouter(withoutFallback, { mode: 'memory', initialPath: '/x' }).state().screen).toBeNull();
  });
});

describe('href', () => {
  test('builds the paths and encodes the parameters', () => {
    expect(Router.href('home')).toBe('/');
    expect(Router.href('item', { params: { id: 'a b' } })).toBe('/items/a%20b');
  });

  test('explicit errors', () => {
    const untyped = Router.href as (name: string, input?: object) => string;
    expect(() => untyped('nope')).toThrow(/unknown route "nope"/);
    expect(() => untyped('item', {})).toThrow(/parameter "id" missing/);
  });
});

describe('navigation', () => {
  test('navigate by name, visit by path, navigated event', async () => {
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

  test('back in memory mode', async () => {
    const router = memory();
    await router.send('visit', '/items/1');
    await router.send('visit', '/items/2');

    await router.send('back');

    expect(router.state().params).toEqual({ id: '1' });
  });

  test('browser mode: pushState and popstate', async () => {
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

describe('RouterOutlet and links', () => {
  class Shell extends SuperElement {
    static tag = 'r-shell';
    render() {
      return html`
        <nav>
          <a href="/items/1">one</a>
          <a href="/items/2">two</a>
          <a href="/items/3" target="_blank">new tab</a>
          <a href="https://example.com/items/4">external</a>
          <a href="/items/5" data-native>native</a>
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

  test("renders the active route's screen, which reads its parameters through this.router.current", async () => {
    const { container } = await start('/items/1');
    expect(container.querySelector('h1')!.textContent).toBe('item 1 (mounted for 1)');
  });

  test('a click on an internal link navigates without reloading', async () => {
    const { router, container, link } = await start();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });

    link('one').dispatchEvent(click);
    await flush();

    expect(click.defaultPrevented).toBe(true);
    expect(router.state().path).toBe('/items/1');
    expect(container.querySelector('h1')!.textContent).toContain('item 1');
  });

  test('each path change remounts a new screen', async () => {
    const { container, link } = await start('/items/1');

    link('two').click();
    await flush();

    expect(container.querySelector('h1')!.textContent).toBe('item 2 (mounted for 2)');
  });

  test('lets the browser handle target, external, data-native and modifiers', async () => {
    const { router, link } = await start();
    const clicks = [
      [link('new tab'), {}],
      [link('external'), {}],
      [link('native'), {}],
      [link('one'), { metaKey: true }],
      [link('one'), { ctrlKey: true }],
    ] as const;

    // After the router, record the decision then stop happy-dom from actually following the link.
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

  test('createApp without a router leaves links alone', () => {
    const root = document.createElement('div');
    root.innerHTML = '<a href="/items/1">one</a>';
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

describe('declared redirects', () => {
  const Redirecting = defineRouter({ home: '/', stats: '/stats', item: '/items/:id', old: '/old/:id' }).screens(() => ({
    home: Home,
    stats: redirect({ to: 'home' }),
    item: Item,
    old: redirect({ to: 'item', params: { id: 'legacy' } }),
  }));

  test('the redirected initial path replaces the history entry', async () => {
    const router = createRouter(Redirecting, { mode: 'memory', initialPath: '/stats' });
    expect(router.state()).toMatchObject({ path: '/', name: 'home', screen: Home });

    await router.send('back'); // nothing before: the /stats entry was replaced
    expect(router.state().path).toBe('/');
  });

  test('a navigation to a redirected route ends at the target, with its parameters', async () => {
    const router = createRouter(Redirecting, { mode: 'memory' });
    const navigated = record(router, 'navigated');

    await router.send('visit', '/old/42');

    expect(router.state()).toMatchObject({ path: '/items/legacy', name: 'item', params: { id: 'legacy' } });
    expect(navigated.calls).toEqual([{ from: '/', to: '/items/legacy' }]);
  });

  test('a redirect loop throws an explicit error', () => {
    const Loop = defineRouter({ a: '/a', b: '/b' }).screens(() => ({ a: redirect({ to: 'b' }), b: redirect({ to: 'a' }) }));
    expect(() => createRouter(Loop, { mode: 'memory', initialPath: '/a' })).toThrow(/too many redirects starting from "\/a"/);
  });
});

describe('guards', () => {
  const session = (user: string | null) => fakeStore('rt-session', { state: { user } });

  class Account extends SuperElement {
    static tag = 'r-account';
    render() {
      return html`<h1>account</h1>`;
    }
  }
  class Login extends SuperElement {
    static tag = 'r-login';
    render() {
      return html`<h1>login</h1>`;
    }
  }
  const Guarded = defineRouter({ home: '/', account: '/account', login: '/login', item: '/items/:id' })
    .guards(({ read }) => ({
      account: () => read('rt-session').isLoggedIn() || { to: 'login' },
      item: ({ params }) => params.id() !== 'secret' || { to: 'home' },
    }))
    .screens(() => ({ home: Home, account: Account, login: Login, item: Item }));

  test('a refused route redirects, and the redirect is pushed instead of the requested path', async () => {
    const router = createRouter(Guarded, { mode: 'memory' });
    await mount(RouterOutlet, { stores: [session(null)], router });

    await router.send('navigate', { to: 'account' });
    expect(router.state()).toMatchObject({ path: '/login', name: 'login' });

    await router.send('back');
    expect(router.state().path).toBe('/'); // /account never entered the history
  });

  test("the guard reads the store's current state at each navigation", async () => {
    const store = session(null);
    const router = createRouter(Guarded, { mode: 'memory' });
    await mount(RouterOutlet, { stores: [store], router });

    store.setState({ user: 'ada' });
    await router.send('navigate', { to: 'account' });

    expect(router.state().name).toBe('account');
  });

  test("the guard receives its route's parameters", async () => {
    const router = createRouter(Guarded, { mode: 'memory' });
    await mount(RouterOutlet, { stores: [session('ada')], router });

    await router.send('visit', '/items/secret');
    expect(router.state().name).toBe('home');
    await router.send('visit', '/items/1');
    expect(router.state().name).toBe('item');
  });

  test('the current path goes through the guards when the router joins the application', async () => {
    const router = createRouter(Guarded, { mode: 'memory', initialPath: '/account' });
    expect(router.state().name).toBe('account'); // no application yet: no stores to read

    const { container } = await mount(RouterOutlet, { stores: [session(null)], router });

    expect(router.state().name).toBe('login');
    expect(container.textContent).toBe('login');
  });

  test('a store missing from the application throws an explicit error', () => {
    const router = createRouter(Guarded, { mode: 'memory', initialPath: '/account' });
    expect(() => createApp({ root: document.createElement('div'), router })).toThrow(
      /router guard: no store provided for the contract "rt-session"/,
    );
  });
});

describe("'!' screen", () => {
  class Broken extends SuperElement {
    static tag = 'r-broken';
    constructor() {
      super();
      throw new Error('broken screen');
    }
    render() {
      return null;
    }
  }
  class Oops extends SuperElement<{ props: { error: Error; path: string } }> {
    static tag = 'r-oops';
    render() {
      return html`<p>${this.props.error.message} on ${this.props.path}</p>`;
    }
  }
  const WithErrorScreen = defineRouter({ home: '/', broken: '/broken' }).screens(() => ({ home: Home, broken: Broken, '!': Oops }));

  test("a screen that crashes without being caught is replaced by the '!' screen, which receives the error", async () => {
    const onError = vi.fn();
    const router = createRouter(WithErrorScreen, { mode: 'memory', initialPath: '/broken' });
    const { container } = await mount(RouterOutlet, { router, onError });
    await flush();

    expect(container.textContent).toBe('broken screen on /broken');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'broken screen' }), {
      tag: 'r-broken',
      phase: 'setup',
      caughtBy: 'super-router-outlet',
    });
  });

  test("navigating elsewhere displays the route's screen again", async () => {
    const router = createRouter(WithErrorScreen, { mode: 'memory', initialPath: '/broken' });
    const { container } = await mount(RouterOutlet, { router, onError: () => {} });
    await flush();

    await router.send('navigate', { to: 'home' });
    await flush();

    expect(container.textContent).toBe('home');
  });
});

test('guards: declared after the screens, an explicit error (typing already forbids it)', () => {
  const declared = defineRouter({ home: '/' }).screens(() => ({ home: Home }));
  expect(() => (declared as unknown as { guards(define: unknown): unknown }).guards(() => ({}))).toThrow(
    /declare the guards with \.guards\(\.\.\.\) before \.screens\(\.\.\.\)/,
  );
});

describe("'!' screen: leaving it", () => {
  let broken = true;
  class Flaky extends SuperElement {
    static tag = 'r-flaky';
    constructor() {
      super();
      if (broken) throw new Error('broken screen');
    }
    render() {
      return html`<h1>fixed</h1>`;
    }
  }
  class Oops extends SuperElement<{ props: { error: Error; path: string } }> {
    static tag = 'r-oops-exit';
    render() {
      return html`<p>oops ${this.props.path}</p>`;
    }
  }
  const Recovering = defineRouter({ home: '/', flaky: '/flaky' }).screens(() => ({ home: Home, flaky: Flaky, '!': Oops }));

  test('coming back to the path in error after going elsewhere remounts the screen, instead of showing the error again', async () => {
    broken = true;
    const router = createRouter(Recovering, { mode: 'memory', initialPath: '/flaky' });
    const { container } = await mount(RouterOutlet, { router, onError: () => {} });
    await flush();
    expect(container.textContent).toBe('oops /flaky');

    broken = false;
    await router.send('navigate', { to: 'home' });
    await router.send('navigate', { to: 'flaky' });
    await flush();

    expect(container.textContent).toBe('fixed');
  });

  test('navigating to the current path remounts the screen (clicking again on the link of the page in error)', async () => {
    broken = true;
    const router = createRouter(Recovering, { mode: 'memory', initialPath: '/flaky' });
    const navigated = record(router, 'navigated');
    const { container } = await mount(RouterOutlet, { router, onError: () => {} });
    await flush();
    expect(container.textContent).toBe('oops /flaky');

    broken = false;
    await router.send('visit', '/flaky');
    await flush();

    expect(container.textContent).toBe('fixed');
    expect(navigated.last).toEqual({ from: '/flaky', to: '/flaky' }); // nothing in the history, but the event is emitted
  });
});

describe('query declared in the string', () => {
  class List extends SuperElement {
    static tag = 'r-q-list';
    // Specific to the instance: changes if the screen is remounted.
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

  test('reads the declared keys: several keys, lists, absent, undeclared ignored', () => {
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

  test('href and navigate: parameters and query separate', async () => {
    expect(WithQuery.href('list')).toBe('/list');
    expect(WithQuery.href('list', { query: { sort: 'asc', tag: ['a', 'b'] } })).toBe('/list?sort=asc&tag=a&tag=b');
    expect(WithQuery.href('list', { query: { tag: [] } })).toBe('/list');
    expect(WithQuery.href('detail', { params: { id: 'a b' }, query: { tab: 'x&y' } })).toBe('/items/a%20b?tab=x%26y');

    const router = start();
    await router.send('navigate', { to: 'detail', params: { id: '1' }, query: { tab: 'hist' } });
    expect(router.state()).toMatchObject({ path: '/items/1?tab=hist', params: { id: '1' }, query: { tab: 'hist' } });
  });

  test('changing the query alone does not remount the screen, which re-renders', async () => {
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

  test("guards receive their route's parameters and query", async () => {
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

  test('invalid declarations: empty key, duplicate key', () => {
    const untyped = defineRouter as (paths: Record<string, string>) => unknown;
    expect(() => untyped({ a: '/a?' })).toThrow(/empty query key/);
    expect(() => untyped({ a: '/a?x&x[]' })).toThrow(/"x" appears twice/);
    // Parameters and query are read separately: the same name no longer confuses them.
    expect(() => untyped({ a: '/a/:id?id' })).not.toThrow();
  });
});

describe('described routes: typed values', () => {
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
      if (!this.itemId.isValid()) return html`<p>not found</p>`;
      return html`<p>item ${this.itemId.value! + 1}</p>`;
    }
  }
  class ListScreen extends SuperElement {
    static tag = 'r-t-list';
    pageNumber = this.selector(loose(this.router).current.query.page as never) as unknown as { value: number; isValid(): boolean };
    renders = 0;
    render() {
      this.renders++;
      return html`<p>page ${this.pageNumber.value} ${this.pageNumber.isValid() ? 'ok' : 'corrected'}</p>`;
    }
  }
  const Router = Typed.screens(() => ({ home: Home, item: ItemScreen, list: ListScreen }));
  const start = (initialPath = '/') => createRouter(Router, { mode: 'memory', initialPath });

  test("converted parameters; an invalid parameter is undefined and stays on the route's screen", () => {
    expect(start('/items/42').state()).toMatchObject({ name: 'item', params: { id: 42 }, invalid: { params: [], query: [] } });
    expect(start('/items/abc').state()).toMatchObject({ name: 'item', params: { id: undefined }, invalid: { params: ['id'] } });
    expect(start('/items/1.5').state().params).toEqual({ id: 1.5 });
  });

  test('converted query: default if absent, default and invalid if non-conforming, lists filtered', () => {
    expect(start('/list').state().query).toEqual({ sort: 'label', page: 1, tag: [], search: undefined, archived: undefined });
    expect(start('/list?sort=value&page=3&tag=1&tag=2&search=x&archived=true').state().query).toEqual({
      sort: 'value',
      page: 3,
      tag: [1, 2],
      search: 'x',
      archived: true,
    });
    const invalid = start('/list?sort=nope&page=abc&tag=1&tag=x&archived=yes').state();
    expect(invalid.query).toEqual({ sort: 'label', page: 1, tag: [1], search: undefined, archived: undefined });
    expect(invalid.invalid.query).toEqual(['sort', 'page', 'tag', 'archived']);
  });

  test('href: typed values written into the URL', () => {
    expect(Router.href('item', { params: { id: 7 } })).toBe('/items/7');
    expect(Router.href('list', { query: { sort: 'value', page: 2, tag: [1, 2], archived: false } })).toBe(
      '/list?sort=value&page=2&tag=1&tag=2&archived=false',
    );
  });

  test('the screen handles an invalid parameter itself', async () => {
    const router = start('/items/abc');
    const { container } = await mount(RouterOutlet, { router });
    expect(container.textContent).toBe('not found');

    await router.send('navigate', { to: 'item', params: { id: 41 } });
    await flush();
    expect(container.textContent).toBe('item 42');
  });

  test('selector: re-renders when the value changes, or when only its validity changes', async () => {
    const router = start('/list?page=2');
    const { container } = await mount(RouterOutlet, { router });
    const screen = container.querySelector('r-t-list') as ListScreen;
    expect(container.textContent).toBe('page 2 ok');

    await router.send('visit', '/list?page=2&search=x'); // another key: no new render
    await flush();
    expect(screen.renders).toBe(1);

    await router.send('visit', '/list?page=1');
    await flush();
    expect(container.textContent).toBe('page 1 ok');

    await router.send('visit', '/list?page=abc'); // same value (the default), but invalid
    await flush();
    expect(container.textContent).toBe('page 1 corrected');
  });

  test('isValid: false for a key the active route does not declare', async () => {
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

  test('at: reads a specific route, and throws an error if the active route is another one', async () => {
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
    expect(read).toThrow(/this\.router\.at\('item'\) read while the active route is 'list'/);
  });

  test('at in a selector: leaving the route goes through the render (and its error), not through the router', async () => {
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

    await router.send('visit', '/list'); // does not throw in the router
    await flush();
    expect(router.state().name).toBe('list');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/at\('item'\)/) }), expect.anything());
  });

  test('guards: typed values and validity', async () => {
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

  test('invalid descriptions: explicit errors', () => {
    const untyped = defineRouter as (paths: Record<string, unknown>) => unknown;
    expect(() => untyped({ a: { path: '/a/:id', params: params<{ slug: string }>({ slug: String }) } })).toThrow(
      /params must describe exactly the path parameters \(id\)/,
    );
    expect(() => untyped({ a: { path: '/a?x' } })).toThrow(/the query is described with query<T>/);
    expect(() => untyped({ a: { path: '/a', query: query<{ x?: string }>({ x: Date as never }) } })).toThrow(
      /key "x" of the route "a": expected String, Number, Boolean or \{ oneOf/,
    );
  });
});
