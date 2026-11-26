import './styles.css'; // références globales d'abord : les feuilles des composants passent après
import './kit-theme.css'; // le thème de @super-ts/ui pour toute l'app
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

// Racine de composition (user-land) : on choisit ici les adapters et on assemble les stores.
const counter = CounterStore.create({ counterRepository: createLocalStorageCounterRepository() });
const profile = ProfileStore.create({ profileClient: createFakeProfileClient() }); // serveur simulé, avec latence
const savedCart = createSavedCart();
const cart = CartStore.create({ quantities: savedCart.load() }); // le panier d'avant le rechargement
const checkout = CheckoutStore.create({ cart, orderClient: createFakeOrderClient() }); // un store qui dépend d'un autre
const errorLog = ErrorLogStore.create();
const catalog = CatalogStore.create({ productCatalog: createDummyJsonProductCatalog() }); // l'API publique de test dummyjson.com
// Le titre de l'onglet : celui que pose l'écran affiché (`@title`), suivi du nom de l'app.
const router = createRouter(Router, { title: { default: 'Super · exemples', suffix: ' · Super' } });

// subscribe : le panier est enregistré à chaque changement, et survit au rechargement de la page.
// Le store ne sait rien du stockage : c'est la racine de composition qui le branche.
cart.subscribe((state) => savedCart.save(state.quantities));

createApp({
  root: document.querySelector<HTMLElement>('#app')!,
  stores: [counter, profile, cart, checkout, errorLog, catalog],
  router,
  // Toute erreur de composant, rattrapée ou non : la console, et le journal affiché par l'exemple « Erreurs ».
  onError: (error, { tag, phase, caughtBy }) => {
    console.error(`[${tag}] ${phase}`, { caughtBy }, error);
    errorLog.send('record', { message: error.message, tag, phase, caughtBy });
  },
}).mount(AppShell.create());
