// Généré par le plugin Vite de Super depuis les contrats de src/@core/ et le router : ne pas modifier.
import type { AppRouterContractOf } from '@super-ts/dom';
import type { Router } from '../routes';
import type { CartContract } from './cart/contract';
import type { CatalogContract } from './catalog/contract';
import type { CheckoutContract } from './checkout/contract';
import type { CounterContract } from './counter/contract';
import type { ErrorLogContract } from './error-log/contract';
import type { ProfileContract } from './profile/contract';
import type { TimerContract } from './timer/contract';

declare module '@super-ts/core' {
  interface Contracts {
    cart: CartContract;
    catalog: CatalogContract;
    checkout: CheckoutContract;
    counter: CounterContract;
    'error-log': ErrorLogContract;
    profile: ProfileContract;
    timer: TimerContract;
    router: AppRouterContractOf<typeof Router>;
  }
}

declare module '@super-ts/dom' {
  interface ScreenRoutes {
    'checkout-screen': 'checkout';
    'composition-screen': 'composition';
    'counter-list-screen': 'counters';
    'counter-screen': 'counter';
    'errors-screen': 'errors';
    'examples-screen': 'examples';
    'kit-display-screen': 'kit-display';
    'kit-forms-screen': 'kit-forms';
    'kit-primitives-screen': 'kit-primitives';
    'kit-screen': 'kit';
    'kit-table-screen': 'kit-table';
    'kit-theme-screen': 'kit-theme';
    'kit-windows-screen': 'kit-windows';
    'profile-screen': 'profile';
    'shop-screen': 'shop';
    'widget-screen': 'widget';
  }
}

export {};
