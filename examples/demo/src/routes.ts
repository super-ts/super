import { defineRouter, query, redirect } from '@super-ts/dom';
import { CheckoutScreen } from '@components/checkout';
import { CompositionScreen } from '@components/composition';
import { CounterScreen } from '@components/counter';
import { CounterListScreen } from '@components/counter-list';
import { ErrorScreen } from '@components/error';
import { ErrorsScreen } from '@components/errors';
import { ExamplesScreen } from '@components/examples';
import { KitScreen } from '@components/kit';
import { KitDisplayScreen } from '@components/kit/display';
import { KitFormsScreen } from '@components/kit/forms';
import { KitPrimitivesScreen } from '@components/kit/primitives';
import { KitTableScreen } from '@components/kit/table';
import { KitThemeScreen } from '@components/kit/theme';
import { KitWindowsScreen } from '@components/kit/windows';
import { NotFoundScreen } from '@components/not-found';
import { ProfileScreen } from '@components/profile';
import { ShopScreen } from '@components/shop';
import { WidgetScreen } from '@components/widget';
import { PRODUCT_SORTS, type ProductSort } from './domain/catalog';

// La query de la liste des compteurs : son type, puis sa description pour lire l'URL. Une valeur
// inconnue (`?sort=nimporte`) est remplacée par la valeur par défaut.
type CountersQuery = { sort: 'original' | 'label' };
// Le tri et la page de la table branchée du kit : ils vivent dans l'URL.
type KitTableQuery = { sort?: ProductSort; order: 'asc' | 'desc'; page: number; size: 5 | 10 | 20 | 50 };

// Le router de l'app : typé par ces routes (`this.router` dans un composant) et source des liens hors composants (`Router.href`).
// `Router.href('counter')` sans `id`, ou `navigate({ to: 'compteur' })`, ne compilent pas.
// Chaque écran lit sa route par `this.router.current`, typé par sa route (`/counters/:id` -> `params.id`).
// `'*'` est l'écran affiché quand aucun chemin ne correspond, `'!'` celui d'un écran qui plante.
export const Router = defineRouter({
  examples: '/',
  // `?sort=label` trie la liste : changer de tri ne remonte pas l'écran.
  counters: {
    path: '/counters',
    query: query<CountersQuery>({ sort: { oneOf: ['original', 'label'], default: 'original' } }),
  },
  counter: '/counters/:id',
  profile: '/profile',
  form: '/form',
  shop: '/shop',
  checkout: '/shop/checkout',
  errors: '/errors',
  widget: '/widget',
  composition: '/composition',
  kit: '/kit',
  'kit-forms': '/kit/forms',
  'kit-windows': '/kit/windows',
  'kit-primitives': '/kit/primitives',
  'kit-display': '/kit/display',
  'kit-table': {
    path: '/kit/table',
    query: query<KitTableQuery>({
      sort: { oneOf: PRODUCT_SORTS },
      order: { oneOf: ['asc', 'desc'], default: 'asc' },
      page: { type: Number, default: 1 },
      size: { oneOf: [5, 10, 20, 50], default: 10 },
    }),
  },
  'kit-theme': '/kit/theme',
})
  // Un guard lit les stores par leur contrat : on ne commande pas un panier vide.
  // Les guards viennent avant .screens(), qui doit rester le dernier appel.
  .guards(({ read }) => ({
    checkout: () => !read('cart').isEmpty() || { to: 'shop' },
  }))
  .screens(() => ({
    examples: ExamplesScreen,
    counters: CounterListScreen,
    counter: CounterScreen,
    profile: ProfileScreen,
    form: redirect({ to: 'profile' }), // un raccourci : /form mène au formulaire
    shop: ShopScreen,
    checkout: CheckoutScreen,
    errors: ErrorsScreen,
    widget: WidgetScreen,
    composition: CompositionScreen,
    kit: KitScreen,
    'kit-forms': KitFormsScreen,
    'kit-windows': KitWindowsScreen,
    'kit-primitives': KitPrimitivesScreen,
    'kit-display': KitDisplayScreen,
    'kit-table': KitTableScreen,
    'kit-theme': KitThemeScreen,
    '*': NotFoundScreen,
    '!': ErrorScreen,
  }));
