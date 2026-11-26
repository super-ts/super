import './styles.css'; // global references first: component stylesheets come after
import './kit-theme.css'; // the @super-ts/ui theme for the whole app
import { createApp, createRouter } from '@super-ts/dom';
import { AppShell } from '@components/app-shell';
import { CartStore } from '@core/cart/store';
import { CatalogStore } from '@core/catalog/store';
import { CheckoutStore } from '@core/checkout/store';
import { CounterStore } from '@core/counter/store';
import { ErrorLogStore } from '@core/error-log/store';
import { ProfileStore } from '@core/profile/store';
import { createDummyJsonProductCatalog } from './adapters/dummyjson-product-catalog';
import { createFakeOrderClient } from './adapters/fake-order-client';
import { createFakeProfileClient } from './adapters/fake-profile-client';
import { createLocalStorageCounterRepository } from './adapters/local-storage-counter-repository';
import { createSavedCart } from './adapters/saved-cart';
import { Router } from './routes';

// Composition root (user-land): this is where you choose the adapters and assemble the stores.
const counter = CounterStore.create({ counterRepository: createLocalStorageCounterRepository() });
const profile = ProfileStore.create({ profileClient: createFakeProfileClient() }); // simulated server, with latency
const savedCart = createSavedCart();
const cart = CartStore.create({ quantities: savedCart.load() }); // the cart from before the reload
const checkout = CheckoutStore.create({ cart, orderClient: createFakeOrderClient() }); // a store that depends on another
const errorLog = ErrorLogStore.create();
const catalog = CatalogStore.create({ productCatalog: createDummyJsonProductCatalog() }); // the public test API dummyjson.com
// The tab title: the one set by the displayed screen (`@title`), followed by the app name.
const router = createRouter(Router, { title: { default: 'Super · examples', suffix: ' · Super' } });

// subscribe: the cart is saved on every change, and survives a page reload.
// The store knows nothing about storage: the composition root wires it in.
cart.subscribe((state) => savedCart.save(state.quantities));

createApp({
  root: document.querySelector<HTMLElement>('#app')!,
  stores: [counter, profile, cart, checkout, errorLog, catalog],
  router,
  // Every component error, caught or not: the console, and the log shown by the "Errors" example.
  onError: (error, { tag, phase, caughtBy }) => {
    console.error(`[${tag}] ${phase}`, { caughtBy }, error);
    errorLog.send('record', { message: error.message, tag, phase, caughtBy });
  },
}).mount(AppShell.create());
