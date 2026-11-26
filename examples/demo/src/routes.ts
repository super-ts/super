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

// The query of the counter list: its type, then its description for reading the URL. An unknown
// value (`?sort=whatever`) is replaced by the default value.
type CountersQuery = { sort: 'original' | 'label' };
// The sort and page of the kit's connected table: they live in the URL.
type KitTableQuery = { sort?: ProductSort; order: 'asc' | 'desc'; page: number; size: 5 | 10 | 20 | 50 };

// The app's router: typed by these routes (`this.router` in a component) and the source of links outside components (`Router.href`).
// `Router.href('counter')` without `id`, or `navigate({ to: 'counterz' })`, do not compile.
// Each screen reads its route through `this.router.current`, typed by its route (`/counters/:id` -> `params.id`).
// `'*'` is the screen shown when no path matches, `'!'` the one for a screen that crashes.
export const Router = defineRouter({
  examples: '/',
  // `?sort=label` sorts the list: changing the sort does not remount the screen.
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
  // A guard reads stores through their contract: you cannot order an empty cart.
  // Guards come before .screens(), which must remain the last call.
  .guards(({ read }) => ({
    checkout: () => !read('cart').isEmpty() || { to: 'shop' },
  }))
  .screens(() => ({
    examples: ExamplesScreen,
    counters: CounterListScreen,
    counter: CounterScreen,
    profile: ProfileScreen,
    form: redirect({ to: 'profile' }), // a shortcut: /form leads to the form
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
