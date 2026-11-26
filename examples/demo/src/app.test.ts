import { createRouter } from '@super-ts/dom';
import { flush, mount } from '@super-ts/testing';
import { AppShell } from '@components/app-shell';
import { CartStore } from '@core/cart/store';
import { CheckoutStore } from '@core/checkout/store';
import { CounterStore } from '@core/counter/store';
import { ErrorLogStore } from '@core/error-log/store';
import { ProfileStore } from '@core/profile/store';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { createFakeOrderClient } from './adapters/fake-order-client';
import { createFakeProfileClient } from './adapters/fake-profile-client';
import { createLocalStorageCounterRepository } from './adapters/local-storage-counter-repository';
import { Router } from './routes';

// L'app entière, assemblée comme dans main.ts : vrais stores, adapters (serveurs simulés sans latence),
// router en mémoire, et onError qui alimente le journal de l'exemple « Erreurs ».
async function startApp(initialPath = '/') {
  const counter = CounterStore.create({ counterRepository: createLocalStorageCounterRepository() });
  const profileClient = createFakeProfileClient({ delay: 0 });
  const profile = ProfileStore.create({ profileClient });
  const cart = CartStore.create();
  const orderClient = createFakeOrderClient({ delay: 0 });
  const checkout = CheckoutStore.create({ cart, orderClient });
  const errorLog = ErrorLogStore.create();
  const router = createRouter(Router, { mode: 'memory', initialPath, title: { default: 'Super · exemples', suffix: ' · Super' } });
  const { container } = await mount(AppShell, {
    stores: [counter, profile, cart, checkout, errorLog],
    router,
    onError: (error, { tag, phase, caughtBy }) => errorLog.send('record', { message: error.message, tag, phase, caughtBy }),
  });
  await flush(); // laisse `load` se terminer
  return { router, profileClient, orderClient, cart, ui: within(container) };
}

describe('app d’exemples', () => {
  beforeEach(() => localStorage.clear());

  test('l’accueil liste les exemples et mène à chacun', async () => {
    const { router, ui } = await startApp();

    expect(ui.getByRole('heading', { name: 'Exemples Super' })).toBeTruthy();
    await userEvent.click(ui.getByRole('link', { name: 'Formulaire de profil' }));
    expect(router.state().name).toBe('profile');
  });

  test('le titre de l’onglet suit l’écran affiché, et le panier sur la boutique', async () => {
    const { router, cart } = await startApp('/shop');
    expect(document.title).toBe('Boutique · Super');
    await cart.send('add', { sku: 'mug' });
    await flush();
    expect(document.title).toBe('Boutique (1 au panier) · Super');
    router.send('navigate', { to: 'kit-forms' });
    await flush();
    expect(document.title).toBe('Formulaires et commandes · Super'); // posé par KitPage, qui n'est pas un écran
  });

  test('la liste des compteurs affiche les valeurs persistées', async () => {
    localStorage.setItem('super.counters', JSON.stringify({ pompes: 12 }));
    const { ui } = await startApp('/counters');

    expect(ui.getByRole('heading', { name: 'Mes compteurs' })).toBeTruthy();
    const pompes = ui.getByRole('link', { name: 'Pompes' });
    expect(pompes.getAttribute('href')).toBe('/counters/pompes');
    expect(pompes.parentElement!.textContent).toContain('12');
  });

  test('parcours complet des compteurs : liste, détail, incrément, retour', async () => {
    const { router, ui } = await startApp('/counters');

    await userEvent.click(ui.getByRole('link', { name: 'Cafés' }));
    expect(router.state()).toMatchObject({ path: '/counters/cafes', name: 'counter', params: { id: 'cafes' } });
    expect(ui.getByRole('heading', { name: 'Cafés' })).toBeTruthy();

    await userEvent.click(ui.getByRole('button', { name: 'Incrémenter' }));
    await userEvent.click(ui.getByRole('button', { name: 'Incrémenter' }));
    expect(await ui.findByText('Incrémenté : 2')).toBeTruthy();

    await userEvent.click(ui.getByRole('link', { name: '← Tous les compteurs' }));
    expect(ui.getByRole('link', { name: 'Cafés' }).parentElement!.textContent).toContain('2');
    expect(JSON.parse(localStorage.getItem('super.counters')!)).toEqual({ cafes: 2 });
  });

  test('back revient à l’écran précédent', async () => {
    const { router, ui } = await startApp('/counters');
    await userEvent.click(ui.getByRole('link', { name: 'Livres lus' }));

    await router.send('back');
    await flush();

    expect(ui.getByRole('heading', { name: 'Mes compteurs' })).toBeTruthy();
  });

  test('un chemin inconnu affiche l’écran introuvable, qui ramène aux exemples', async () => {
    const { router, ui } = await startApp('/nulle-part');

    expect(ui.getByRole('heading', { name: 'Page introuvable' })).toBeTruthy();
    await userEvent.click(ui.getByRole('button', { name: 'Retour aux exemples' }));
    await flush();

    expect(router.state().name).toBe('examples');
  });

  test('/form redirige vers le formulaire de profil', async () => {
    const { router, ui } = await startApp('/form');

    expect(router.state()).toMatchObject({ path: '/profile', name: 'profile' });
    expect(ui.getByRole('heading', { name: 'Formulaire de profil' })).toBeTruthy();
  });

  test('la navigation marque la section courante, y compris sur le détail d’un compteur', async () => {
    const { ui } = await startApp('/counters/cafes');
    const nav = within(ui.getByRole('navigation', { name: 'Exemples' }));

    expect(nav.getByRole('link', { name: 'Compteurs' }).getAttribute('aria-current')).toBe('page');
    expect(nav.getByRole('link', { name: 'Exemples' }).hasAttribute('aria-current')).toBe(false);
  });

  test('le formulaire s’enregistre auprès du serveur simulé', async () => {
    const { profileClient, ui } = await startApp('/profile');

    await userEvent.type(ui.getByLabelText('Nom'), 'Ada');
    await userEvent.type(ui.getByLabelText('E-mail'), 'ada@example.com');
    await userEvent.type(ui.getByLabelText('Mot de passe'), 'longpassword');
    await userEvent.type(ui.getByLabelText('Confirmation'), 'longpassword');
    await userEvent.selectOptions(ui.getByLabelText('Langues'), ['fr']);
    await userEvent.type(ui.getByLabelText('Numéro'), '06 12 34 56 78');
    await new Promise((resolve) => setTimeout(resolve, 450)); // la vérification de l'adresse
    await userEvent.click(ui.getByRole('button', { name: 'Enregistrer' }));

    expect(await ui.findByText('Profil enregistré (n° p1).')).toBeTruthy();
    expect(profileClient.saved[0]).toMatchObject({ name: 'Ada', email: 'ada@example.com', languages: ['fr'] });
  });

  test('boutique : on ne commande pas un panier vide (guard), puis une commande vide le panier', async () => {
    const { router, orderClient, ui } = await startApp('/shop/checkout');
    expect(router.state().name).toBe('shop'); // redirigé par le guard

    await userEvent.click(ui.getByRole('button', { name: 'Ajouter Mug Super' }));
    await userEvent.click(ui.getByRole('link', { name: 'Commander' }));
    expect(router.state().name).toBe('checkout');

    await userEvent.type(ui.getByLabelText('Adresse de livraison'), '12 rue des Lilas, Paris');
    await userEvent.click(ui.getByRole('button', { name: 'Payer' }));

    expect(await ui.findByText('Commande n° C0001, 12,00 €.')).toBeTruthy();
    expect(orderClient.orders[0]).toMatchObject({ lines: [{ sku: 'mug', quantity: 1 }], total: 1200 });
    await userEvent.click(ui.getByRole('link', { name: 'Retour à la boutique' }));
    expect(ui.getByText('Aucun article pour l’instant.')).toBeTruthy(); // le panier a été vidé par Checkout
  });

  test('erreurs : chaque cas est rattrapé au bon niveau et apparaît dans le journal', async () => {
    const { router, ui } = await startApp('/errors');
    const log = () => within(ui.getByRole('region', { name: 'Journal onError' }));

    await userEvent.click(ui.getByRole('button', { name: 'Casser le bloc' }));
    expect(await ui.findByText(/Ce bloc a planté/)).toBeTruthy();
    expect(
      log()
        .getAllByText(/fragile-card/)[0]!
        .closest('li')!.textContent,
    ).toContain('rattrapée par fragile-card');

    await userEvent.click(ui.getByRole('button', { name: "Afficher l'enfant cassé" }));
    expect(await ui.findByText(/Le parent a rattrapé l'erreur de son enfant/)).toBeTruthy();
    expect(
      log()
        .getByText(/broken-child/)
        .closest('li')!.textContent,
    ).toContain('rattrapée par guarded-panel');

    await userEvent.click(ui.getByRole('button', { name: 'Clic qui plante' }));
    await flush();
    expect(
      log()
        .getByText(/le gestionnaire de clic a planté/)
        .closest('li')!.textContent,
    ).toContain('phase event');

    await userEvent.click(ui.getByRole('button', { name: "Tout casser (écran '!')" }));
    await flush();
    expect(ui.getByRole('heading', { name: 'Cette page a rencontré un problème' })).toBeTruthy();
    expect(router.state().name).toBe('errors'); // toujours sur la même route : l'écran '!' remplace l'écran
  });

  test("erreurs : après l'écran '!', recliquer sur « Erreurs » ou passer par une autre page ramène l'écran d'origine", async () => {
    const { ui } = await startApp('/errors');
    const nav = () => within(ui.getByRole('navigation', { name: 'Exemples' }));
    const crash = async () => {
      await userEvent.click(ui.getByRole('button', { name: "Tout casser (écran '!')" }));
      await flush();
      expect(ui.getByRole('heading', { name: 'Cette page a rencontré un problème' })).toBeTruthy();
    };

    await crash();
    await userEvent.click(nav().getByRole('link', { name: 'Erreurs' })); // même chemin
    await flush();
    expect(ui.getByRole('heading', { name: 'Erreurs' })).toBeTruthy();

    await crash();
    await userEvent.click(nav().getByRole('link', { name: 'Widget' }));
    await userEvent.click(nav().getByRole('link', { name: 'Erreurs' }));
    await flush();
    expect(ui.getByRole('heading', { name: 'Erreurs' })).toBeTruthy();
    expect(ui.getByText('Prêt.')).toBeTruthy(); // un écran neuf : le bloc n'est plus cassé
  });
});
