/**
 * Router d'essai pour les tests de types : dans une app, le plugin Vite l'inscrit lui-même dans
 * le dictionnaire des contrats, et relie chaque écran à sa route.
 */
import { type AppRouterContractOf, defineRouter, params, query } from '@super-ts/dom';

export const AppRouter = defineRouter({
  home: '/',
  item: { path: '/items/:id', params: params<{ id: number }>({ id: Number }) },
  list: {
    path: '/list',
    query: query<{ sort: 'label' | 'value'; tag: string[]; search?: string }>({
      sort: { oneOf: ['label', 'value'], default: 'label' },
      tag: [String],
      search: String,
    }),
  },
  page: '/pages/:slug?tab',
});

declare module '@super-ts/core' {
  interface Contracts {
    router: AppRouterContractOf<typeof AppRouter>;
  }
}

declare module '@super-ts/dom' {
  interface ScreenRoutes {
    't-item-screen': 'item';
    't-twice-screen': 'item' | 'page';
  }
}
