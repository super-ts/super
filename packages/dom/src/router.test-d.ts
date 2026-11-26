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

test('chaînes : paramètres et query extraits du chemin', () => {
  expectTypeOf<PathParams<'/'>>().toEqualTypeOf<{}>();
  expectTypeOf<PathParams<'/items/:id'>>().toEqualTypeOf<{ id: string }>();
  expectTypeOf<PathParams<'/a/:x/b/:y'>>().toEqualTypeOf<{ x: string; y: string }>();
  expectTypeOf<PathParams<'/items/:id?tab'>>().toEqualTypeOf<{ id: string }>();
  expectTypeOf<QueryParams<'/list?sort&tag[]'>>().toEqualTypeOf<{ sort?: string; tag: string[] }>();
  expectTypeOf<QueryParams<'/list'>>().toEqualTypeOf<{}>();
});

test('routes décrites : les types écrits par l’app', () => {
  expectTypeOf<ParamsOf<typeof COUNTER>>().toEqualTypeOf<CounterParams>();
  expectTypeOf<QueryOf<typeof COUNTERS>>().toEqualTypeOf<CountersQuery>();
  expectTypeOf<ParamsOf<{ path: '/x/:slug' }>>().toEqualTypeOf<{ slug: string }>();
});

test('descriptions vérifiées contre le type', () => {
  query<{ page: number }>({ page: { type: Number, default: 1 } });
  // @ts-expect-error une clé obligatoire exige sa valeur par défaut
  query<{ page: number }>({ page: Number });
  // @ts-expect-error une clé facultative n'a pas de défaut
  query<{ page?: number }>({ page: { type: Number, default: 1 } });
  // @ts-expect-error mauvais type
  query<{ page?: number }>({ page: String });
  // @ts-expect-error valeur hors de l'union
  query<{ sort?: 'a' | 'b' }>({ sort: { oneOf: ['a', 'c'] } });
  // @ts-expect-error défaut hors de l'union
  query<{ sort: 'a' | 'b' }>({ sort: { oneOf: ['a', 'b'], default: 'c' } });
  // @ts-expect-error une liste se décrit entre crochets
  query<{ tag: string[] }>({ tag: String });
  // @ts-expect-error clé manquante
  query<{ a?: string; b?: string }>({ a: String });
  // @ts-expect-error clé en trop
  query<{ a?: string }>({ a: String, b: String });
  params<{ id: number; slug: string; kind: 'a' | 'b' }>({ id: Number, slug: String, kind: { oneOf: ['a', 'b'] } });
  // @ts-expect-error un paramètre de chemin est toujours présent : pas de défaut
  params<{ id: number }>({ id: { type: Number, default: 1 } });
});

test('defineRouter : params décrits = paramètres du chemin, query hors du chemin', () => {
  defineRouter({ counter: COUNTER });
  // @ts-expect-error `slug` n'est pas un paramètre du chemin
  void (() => defineRouter({ counter: { path: '/counters/:id', params: params<{ slug: string }>({ slug: String }) } }));
  // @ts-expect-error la query se décrit par query<T>
  void (() => defineRouter({ counters: { path: '/counters?sort' } }));
  // @ts-expect-error '*' est réservé, ce n'est pas un nom de route
  defineRouter({ '*': '/x' });
  // @ts-expect-error '!' n'est pas un nom de route
  defineRouter({ '!': '/oops' });
});

test('NavigateTargetOf : params requis seulement si la route en a, query à part', () => {
  type Target = NavigateTargetOf<{ home: '/'; item: typeof COUNTER; list: typeof COUNTERS }>;
  expectTypeOf<{ to: 'home' }>().toExtend<Target>();
  expectTypeOf<{ to: 'item'; params: { id: number } }>().toExtend<Target>();
  expectTypeOf<{ to: 'list'; query: { sort: 'value'; tag: readonly string[] } }>().toExtend<Target>();
  expectTypeOf<{ to: 'item' }>().not.toExtend<Target>();
  expectTypeOf<{ to: 'item'; params: { id: string } }>().not.toExtend<Target>();
  expectTypeOf<{ to: 'list'; query: { sort: 'nope' } }>().not.toExtend<Target>();
  expectTypeOf<{ to: 'nope' }>().not.toExtend<Target>();
});

test('screens : un écran par route, sans props obligatoire', () => {
  const declared = defineRouter({ home: '/', item: '/items/:id' });
  declared.screens(() => ({ home: Screen, item: Screen }));
  declared.screens(() => ({ home: Screen, item: Screen, '*': Screen }));
  // @ts-expect-error écran manquant
  declared.screens(() => ({ home: Screen }));
  // @ts-expect-error un écran ne reçoit plus de props de route
  declared.screens(() => ({ home: Screen, item: IdScreen }));
});

test('createRouter exige un router dont les écrans sont déclarés', () => {
  const declared = defineRouter({ home: '/' });
  // @ts-expect-error .screens() pas encore appelé
  createRouter(declared, { mode: 'memory' });
  createRouter(
    declared.screens(() => ({ home: Screen })),
    { mode: 'memory' },
  );
});

test('href et navigate : params et query séparés, typés', () => {
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
  // @ts-expect-error paramètre `id` requis
  Router.href('item');
  // @ts-expect-error `id` est un nombre
  Router.href('item', { params: { id: '1' } });
  // @ts-expect-error valeur hors de l'union
  Router.href('list', { query: { sort: 'nope' } });
  // @ts-expect-error `nope` n'est pas déclaré
  Router.href('list', { query: { nope: 'x' } });
  // @ts-expect-error `/` n'a pas de query
  Router.href('home', { query: { sort: 'value' } });
  // @ts-expect-error route inconnue
  Router.href('nope');

  const router = createRouter(Router, { mode: 'memory' });
  void router.send('navigate', { to: 'item', params: { id: 1 } });
  void router.send('navigate', { to: 'list', query: { page: 3 } });
  // @ts-expect-error params requis
  void router.send('navigate', { to: 'item' });
  // @ts-expect-error route inconnue
  void router.send('navigate', { to: 'nope' });
  expectTypeOf(router.state().name).toEqualTypeOf<'home' | 'item' | 'list' | 'legacy' | null>();
  expectTypeOf(router).toEqualTypeOf<RouterHandle<(typeof Router)['paths']>>();
  createApp({ root: document.body, router });
});

// Le cas réel : des écrans qui utilisent le router dont la déclaration les contient. Si le
// compilateur ne parvenait plus à typer `Cyclic` sans lire ses écrans, tout ceci tomberait en `any`
// et les `@ts-expect-error` ci-dessous échoueraient.
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

test('les écrans peuvent utiliser le router qui les déclare, sans perdre le typage', () => {
  // @ts-expect-error paramètre `id` requis
  Cyclic.href('item');
  expectTypeOf(Cyclic.href).returns.toEqualTypeOf<string>();
  const router = createRouter(Cyclic, { mode: 'memory' });
  expectTypeOf(router.state().name).toEqualTypeOf<'home' | 'item' | null>();
  // @ts-expect-error params requis
  void router.send('navigate', { to: 'item' });
});

test('redirect : la cible est une route existante, avec ses paramètres', () => {
  const declared = defineRouter({ home: '/', item: COUNTER, stats: '/stats' });

  declared.screens(() => ({ home: Screen, item: Screen, stats: redirect({ to: 'home' }) }));
  declared.screens(() => ({ home: Screen, item: Screen, stats: redirect({ to: 'item', params: { id: 1 } }) }));
  // @ts-expect-error route inconnue
  declared.screens(() => ({ home: Screen, item: Screen, stats: redirect({ to: 'nope' }) }));
  // @ts-expect-error paramètre `id` manquant
  declared.screens(() => ({ home: Screen, item: Screen, stats: redirect({ to: 'item' }) }));
});

test('guards : la route typée, cibles typées, lecture des stores par nom de contrat', () => {
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
  // @ts-expect-error contrat inconnu
  declared.guards(({ read }) => ({ home: () => read('rt-nope') && true }));
  // @ts-expect-error cible de redirection inconnue
  declared.guards(() => ({ home: () => ({ to: 'nope' }) }));
  // @ts-expect-error guard pour une route inconnue
  declared.guards(() => ({ nope: () => true }));
  // @ts-expect-error les guards se déclarent avant les écrans : .screens() reste le dernier appel
  declared.screens(() => ({ home: Screen, item: Screen, list: Screen })).guards(() => ({}));
});

test("écran '!' : reçoit { error, path }", () => {
  class Oops extends SuperElement<{ props: { error: Error; path: string } }> {
    static tag = 'td-e-oops';
    render() {
      return null;
    }
  }
  const declared = defineRouter({ home: '/' });

  declared.screens(() => ({ home: Screen, '!': Oops }));
  // @ts-expect-error l'écran '!' doit accepter { error, path }
  declared.screens(() => ({ home: Screen, '!': IdScreen }));
});

test('renderError reçoit l’erreur, et lit les props typées', () => {
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
