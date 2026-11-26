import {
  createApp,
  createRouter,
  defineRouter,
  type NavigateTargetOf,
  type ParamsOf,
  type PathParams,
  params,
  type QueryOf,
  type QueryParams,
  query,
  type RouterHandle,
  redirect,
  SuperElement,
} from '@super-ts/dom';
import { expectTypeOf, test } from 'vitest';
import './__fixtures__/rt-session.ts';

class Screen extends SuperElement {
  static tag = 'td-screen';
  render() {
    return null;
  }
}
class IdScreen extends SuperElement<{ props: { id: string } }> {
  static tag = 'td-id-screen';
  render() {
    return null;
  }
}

type CountersQuery = { sort: 'label' | 'value'; page: number; tag: string[]; search?: string; archived?: boolean };
type CounterParams = { id: number };

const COUNTERS = {
  path: '/counters',
  query: query<CountersQuery>({
    sort: { oneOf: ['label', 'value'], default: 'label' },
    page: { type: Number, default: 1 },
    tag: [String],
    search: String,
    archived: Boolean,
  }),
} as const;
const COUNTER = { path: '/counters/:id', params: params<CounterParams>({ id: Number }) } as const;

test('strings: parameters and query extracted from the path', () => {
  expectTypeOf<PathParams<'/'>>().toEqualTypeOf<{}>();
  expectTypeOf<PathParams<'/items/:id'>>().toEqualTypeOf<{ id: string }>();
  expectTypeOf<PathParams<'/a/:x/b/:y'>>().toEqualTypeOf<{ x: string; y: string }>();
  expectTypeOf<PathParams<'/items/:id?tab'>>().toEqualTypeOf<{ id: string }>();
  expectTypeOf<QueryParams<'/list?sort&tag[]'>>().toEqualTypeOf<{ sort?: string; tag: string[] }>();
  expectTypeOf<QueryParams<'/list'>>().toEqualTypeOf<{}>();
});

test('described routes: the types written by the app', () => {
  expectTypeOf<ParamsOf<typeof COUNTER>>().toEqualTypeOf<CounterParams>();
  expectTypeOf<QueryOf<typeof COUNTERS>>().toEqualTypeOf<CountersQuery>();
  expectTypeOf<ParamsOf<{ path: '/x/:slug' }>>().toEqualTypeOf<{ slug: string }>();
});

test('descriptions checked against the type', () => {
  query<{ page: number }>({ page: { type: Number, default: 1 } });
  // @ts-expect-error a required key demands its default value
  query<{ page: number }>({ page: Number });
  // @ts-expect-error an optional key has no default
  query<{ page?: number }>({ page: { type: Number, default: 1 } });
  // @ts-expect-error wrong type
  query<{ page?: number }>({ page: String });
  // @ts-expect-error value outside the union
  query<{ sort?: 'a' | 'b' }>({ sort: { oneOf: ['a', 'c'] } });
  // @ts-expect-error default outside the union
  query<{ sort: 'a' | 'b' }>({ sort: { oneOf: ['a', 'b'], default: 'c' } });
  // @ts-expect-error a list is described between square brackets
  query<{ tag: string[] }>({ tag: String });
  // @ts-expect-error missing key
  query<{ a?: string; b?: string }>({ a: String });
  // @ts-expect-error extra key
  query<{ a?: string }>({ a: String, b: String });
  params<{ id: number; slug: string; kind: 'a' | 'b' }>({ id: Number, slug: String, kind: { oneOf: ['a', 'b'] } });
  // @ts-expect-error a path parameter is always present: no default
  params<{ id: number }>({ id: { type: Number, default: 1 } });
});

test('defineRouter: described params = path parameters, query outside the path', () => {
  defineRouter({ counter: COUNTER });
  // @ts-expect-error `slug` is not a path parameter
  void (() => defineRouter({ counter: { path: '/counters/:id', params: params<{ slug: string }>({ slug: String }) } }));
  // @ts-expect-error the query is described with query<T>
  void (() => defineRouter({ counters: { path: '/counters?sort' } }));
  // @ts-expect-error '*' is reserved, it is not a route name
  defineRouter({ '*': '/x' });
  // @ts-expect-error '!' is not a route name
  defineRouter({ '!': '/oops' });
});

test('NavigateTargetOf: params required only if the route has some, query separate', () => {
  type Target = NavigateTargetOf<{ home: '/'; item: typeof COUNTER; list: typeof COUNTERS }>;
  expectTypeOf<{ to: 'home' }>().toExtend<Target>();
  expectTypeOf<{ to: 'item'; params: { id: number } }>().toExtend<Target>();
  expectTypeOf<{ to: 'list'; query: { sort: 'value'; tag: readonly string[] } }>().toExtend<Target>();
  expectTypeOf<{ to: 'item' }>().not.toExtend<Target>();
  expectTypeOf<{ to: 'item'; params: { id: string } }>().not.toExtend<Target>();
  expectTypeOf<{ to: 'list'; query: { sort: 'nope' } }>().not.toExtend<Target>();
  expectTypeOf<{ to: 'nope' }>().not.toExtend<Target>();
});

test('screens: one screen per route, without required props', () => {
  const declared = defineRouter({ home: '/', item: '/items/:id' });
  declared.screens(() => ({ home: Screen, item: Screen }));
  declared.screens(() => ({ home: Screen, item: Screen, '*': Screen }));
  // @ts-expect-error missing screen
  declared.screens(() => ({ home: Screen }));
  // @ts-expect-error a screen no longer receives route props
  declared.screens(() => ({ home: Screen, item: IdScreen }));
});

test('createRouter requires a router whose screens are declared', () => {
  const declared = defineRouter({ home: '/' });
  // @ts-expect-error .screens() not called yet
  createRouter(declared, { mode: 'memory' });
  createRouter(
    declared.screens(() => ({ home: Screen })),
    { mode: 'memory' },
  );
});

test('href and navigate: params and query separate, typed', () => {
  const Router = defineRouter({ home: '/', item: COUNTER, list: COUNTERS, legacy: '/legacy/:id?tab&tag[]' }).screens(() => ({
    home: Screen,
    item: Screen,
    list: Screen,
    legacy: Screen,
  }));

  Router.href('home');
  Router.href('item', { params: { id: 1 } });
  Router.href('list');
  Router.href('list', { query: { sort: 'value', page: 2, tag: ['a', 'b'], archived: true } });
  Router.href('legacy', { params: { id: 'x' }, query: { tab: 'y', tag: ['z'] } });
  // @ts-expect-error parameter `id` required
  Router.href('item');
  // @ts-expect-error `id` is a number
  Router.href('item', { params: { id: '1' } });
  // @ts-expect-error value outside the union
  Router.href('list', { query: { sort: 'nope' } });
  // @ts-expect-error `nope` is not declared
  Router.href('list', { query: { nope: 'x' } });
  // @ts-expect-error `/` has no query
  Router.href('home', { query: { sort: 'value' } });
  // @ts-expect-error unknown route
  Router.href('nope');

  const router = createRouter(Router, { mode: 'memory' });
  void router.send('navigate', { to: 'item', params: { id: 1 } });
  void router.send('navigate', { to: 'list', query: { page: 3 } });
  // @ts-expect-error params required
  void router.send('navigate', { to: 'item' });
  // @ts-expect-error unknown route
  void router.send('navigate', { to: 'nope' });
  expectTypeOf(router.state().name).toEqualTypeOf<'home' | 'item' | 'list' | 'legacy' | null>();
  expectTypeOf(router).toEqualTypeOf<RouterHandle<(typeof Router)['paths']>>();
  createApp({ root: document.body, router });
});

// The real case: screens that use the router whose declaration contains them. If the
// compiler could no longer type `Cyclic` without reading its screens, all of this would fall back to `any`
// and the `@ts-expect-error` below would fail.
const Cyclic = defineRouter({ home: '/', item: COUNTER }).screens(() => ({
  home: CyclicHome,
  item: CyclicItem,
  '*': CyclicMissing,
}));
class CyclicHome extends SuperElement {
  static tag = 'td-cyc-home';
  render() {
    return Cyclic.href('item', { params: { id: 1 } });
  }
}
class CyclicItem extends SuperElement {
  static tag = 'td-cyc-item';
  render() {
    return Cyclic.href('home');
  }
}
class CyclicMissing extends SuperElement {
  static tag = 'td-cyc-missing';
  render() {
    return Cyclic.href('home');
  }
}

test('screens can use the router that declares them, without losing typing', () => {
  // @ts-expect-error parameter `id` required
  Cyclic.href('item');
  expectTypeOf(Cyclic.href).returns.toEqualTypeOf<string>();
  const router = createRouter(Cyclic, { mode: 'memory' });
  expectTypeOf(router.state().name).toEqualTypeOf<'home' | 'item' | null>();
  // @ts-expect-error params required
  void router.send('navigate', { to: 'item' });
});

test('redirect: the target is an existing route, with its parameters', () => {
  const declared = defineRouter({ home: '/', item: COUNTER, stats: '/stats' });

  declared.screens(() => ({ home: Screen, item: Screen, stats: redirect({ to: 'home' }) }));
  declared.screens(() => ({ home: Screen, item: Screen, stats: redirect({ to: 'item', params: { id: 1 } }) }));
  // @ts-expect-error unknown route
  declared.screens(() => ({ home: Screen, item: Screen, stats: redirect({ to: 'nope' }) }));
  // @ts-expect-error parameter `id` missing
  declared.screens(() => ({ home: Screen, item: Screen, stats: redirect({ to: 'item' }) }));
});

test('guards: the typed route, typed targets, reading stores by contract name', () => {
  const declared = defineRouter({ home: '/', item: COUNTER, list: COUNTERS });

  declared
    .guards(({ read }) => ({
      home: () => {
        expectTypeOf(read('rt-session').isLoggedIn()).toBeBoolean();
        return true;
      },
      item: ({ params }) => {
        expectTypeOf(params.id()).toEqualTypeOf<number | undefined>();
        if (params.id.isValid()) expectTypeOf(params.id()).toEqualTypeOf<number>();
        return params.id.isValid() || { to: 'list' };
      },
      list: ({ query }) => {
        expectTypeOf(query.sort()).toEqualTypeOf<'label' | 'value'>();
        expectTypeOf(query.tag()).toEqualTypeOf<string[]>();
        expectTypeOf(query.search()).toEqualTypeOf<string | undefined>();
        return true;
      },
    }))
    .screens(() => ({ home: Screen, item: Screen, list: Screen }));
  // @ts-expect-error unknown contract
  declared.guards(({ read }) => ({ home: () => read('rt-nope') && true }));
  // @ts-expect-error unknown redirect target
  declared.guards(() => ({ home: () => ({ to: 'nope' }) }));
  // @ts-expect-error guard for an unknown route
  declared.guards(() => ({ nope: () => true }));
  // @ts-expect-error guards are declared before the screens: .screens() stays the last call
  declared.screens(() => ({ home: Screen, item: Screen, list: Screen })).guards(() => ({}));
});

test("'!' screen: receives { error, path }", () => {
  class Oops extends SuperElement<{ props: { error: Error; path: string } }> {
    static tag = 'td-e-oops';
    render() {
      return null;
    }
  }
  const declared = defineRouter({ home: '/' });

  declared.screens(() => ({ home: Screen, '!': Oops }));
  // @ts-expect-error the '!' screen must accept { error, path }
  declared.screens(() => ({ home: Screen, '!': IdScreen }));
});

test('renderError receives the error, and reads the typed props', () => {
  class WithFallback extends SuperElement<{ props: { id: string } }> {
    static tag = 'td-fallback';
    render() {
      return null;
    }
    override renderError(error: Error) {
      expectTypeOf(this.props.id).toBeString();
      expectTypeOf(error).toEqualTypeOf<Error>();
      return null;
    }
  }
  void WithFallback;
});
