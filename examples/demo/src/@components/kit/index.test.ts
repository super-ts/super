import { createRouter, RouterOutlet } from '@super-ts/dom';
import { fakeStore, flush, mount } from '@super-ts/testing';
import { CatalogStore } from '@core/catalog/store';
import type { CounterState } from '@core/counter/contract';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { createInMemoryProductCatalog } from '../../adapters/in-memory-product-catalog';
import type { Product } from '../../domain/catalog';
import { Router } from '../../routes';

const idle: CounterState = { counts: { cafes: 2, pompes: 0, livres: 1 }, loadErrorMessage: null };
const PRODUCTS: Product[] = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1,
  title: `Produit ${String(i + 1).padStart(2, '0')}`,
  brand: i % 2 ? 'Acme' : null,
  price: (i * 7) % 20,
  rating: 4,
}));

async function setup(initialPath: string) {
  const counter = fakeStore('counter', { state: idle, commands: { reset: async () => ({ count: 0 }) } });
  const profile = fakeStore('profile', {
    state: {},
    commands: { save: async () => ({ id: '42' }), checkEmail: async () => ({ available: true }) },
  });
  const productCatalog = createInMemoryProductCatalog({ products: PRODUCTS });
  const catalog = CatalogStore.create({ productCatalog, searchDelay: 0 });
  const router = createRouter(Router, { mode: 'memory', initialPath });
  const { container } = await mount(RouterOutlet, { stores: [counter, profile, catalog], router });
  await flush();
  return { counter, profile, productCatalog, router, ui: within(container) };
}

const cells = (ui: ReturnType<typeof within>, column = 0) =>
  ui
    .getAllByRole('row')
    .slice(1)
    .map((row: HTMLElement) => row.querySelectorAll('td')[column]!.textContent);

describe('kit : le sommaire', () => {
  test('mène à chaque famille de composants', async () => {
    const { router, ui } = await setup('/kit');
    const families = ['Formulaires et commandes', 'Fenêtres', 'Primitives', 'Affichage', 'Table', 'Thème'];
    expect(families.map((name) => ui.getByRole('link', { name }).getAttribute('href'))).toEqual([
      '/kit/forms',
      '/kit/windows',
      '/kit/primitives',
      '/kit/display',
      '/kit/table',
      '/kit/theme',
    ]);
    await userEvent.click(ui.getByRole('link', { name: 'Fenêtres' }));
    await flush();
    expect(router.state().name).toBe('kit-windows');
    expect(ui.getByRole('link', { name: '← Le kit' }).getAttribute('href')).toBe('/kit');
  });
});

describe('kit : formulaires et commandes', () => {
  test('les champs valident et soumettent le formulaire, puis un message confirme', async () => {
    const { profile, ui } = await setup('/kit/forms');
    await userEvent.click(ui.getByRole('button', { name: 'Enregistrer' }));
    await flush();
    expect(ui.getByText('Nom obligatoire')).toBeTruthy();
    expect(ui.getByLabelText('Nom').getAttribute('aria-invalid')).toBe('true');

    await userEvent.type(ui.getByLabelText('Nom'), 'Ada');
    await userEvent.type(ui.getByLabelText('E-mail'), 'ada@example.com');
    await userEvent.click(ui.getByLabelText('Pro'));
    await userEvent.click(ui.getByRole('button', { name: 'Enregistrer' }));
    await new Promise((resolve) => setTimeout(resolve, 450)); // la vérification de l'adresse attend 400 ms
    await flush();

    expect(profile.sent.at(-1)).toMatchObject({ name: 'save', args: [{ name: 'Ada', email: 'ada@example.com', plan: 'pro' }] });
    expect(ui.getByText('Profil enregistré.')).toBeTruthy();
  });
  test('le bouton de commande affiche le compteur et envoie reset avec son entrée', async () => {
    const { counter, ui } = await setup('/kit/forms');
    expect(ui.getByText('Cafés :').textContent).toContain('2');
    await userEvent.click(ui.getByRole('button', { name: 'Remettre les cafés à zéro' }));
    await flush();
    expect(counter.sent.at(-1)).toMatchObject({ name: 'reset', args: [{ id: 'cafes' }] });
  });
});

describe('kit : fenêtres et primitives', () => {
  test('la modale s’ouvre et se ferme avec Échap', async () => {
    const { ui } = await setup('/kit/windows');
    await userEvent.click(ui.getByRole('button', { name: 'Ouvrir une modale' }));
    await flush();
    expect(ui.getByRole('heading', { name: 'À propos' })).toBeTruthy();

    await userEvent.keyboard('{Escape}');
    await flush();
    expect(ui.queryByRole('heading', { name: 'À propos' })).toBeNull();
  });

  test('le menu pousse un message', async () => {
    const { ui } = await setup('/kit/primitives');
    await userEvent.click(ui.getByRole('button', { name: 'Actions' }));
    await userEvent.click(ui.getByRole('menuitem', { name: 'Dire bonjour' }));
    await flush();
    expect(ui.getByText('Bonjour !')).toBeTruthy();
  });

  test('le combobox à valeurs en dur filtre lui-même, sans accents ni casse', async () => {
    const { ui } = await setup('/kit/primitives');
    await userEvent.type(ui.getByRole('combobox', { name: 'Fruit' }), 'peche');
    const options = ui.getAllByRole('option').map((option) => option.textContent!.trim());
    expect(options).toEqual(['Pêche']);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await flush();
    expect(ui.getByText('Fruit choisi : Pêche')).toBeTruthy();
  });

  test('le combobox branché cherche dans le catalogue et propose ce qu’il trouve', async () => {
    const { productCatalog, ui } = await setup('/kit/primitives');
    await userEvent.type(ui.getByRole('combobox', { name: 'Produit' }), 'produit 1');
    await flush();
    expect(productCatalog.searches.at(-1)).toBe('produit 1');
    const listbox = within(ui.getByRole('listbox', { name: 'Produit' }));
    expect(listbox.getAllByRole('option').map((option) => option.textContent!.trim())).toEqual([
      'Produit 10',
      'Produit 11',
      'Produit 12',
      'Produit 13',
      'Produit 14',
      'Produit 15',
      'Produit 16',
      'Produit 17',
    ]);
    await userEvent.click(listbox.getByRole('option', { name: 'Produit 12' }));
    await flush();
    expect(ui.getByText('Produit choisi : Produit 12')).toBeTruthy();
  });
});

describe('kit : table', () => {
  test('la table statique trie elle-même', async () => {
    const { ui } = await setup('/kit/table');
    const table = within(ui.getByRole('table', { name: 'Compteurs' }));
    await userEvent.click(table.getByRole('button', { name: 'Valeur' }));
    await flush();
    expect(cells(table, 1)).toEqual(['0', '1']);
  });

  test('la table branchée charge la page de l’URL, et trier ou paginer passe par l’URL', async () => {
    const { productCatalog, router, ui } = await setup('/kit/table?sort=price&order=desc&page=2&size=5');
    const table = within(ui.getByRole('table', { name: 'Produits' }));
    expect(productCatalog.queries.at(-1)).toEqual({ page: 2, pageSize: 5, sort: 'price', order: 'desc' });
    expect(ui.getByText('Page 2 sur 4')).toBeTruthy();
    expect(table.getAllByRole('row')).toHaveLength(6);

    await userEvent.click(table.getByRole('button', { name: 'Produit' }));
    await flush();
    expect(router.state().path).toBe('/kit/table?sort=title&order=asc&page=1&size=5');
    expect(productCatalog.queries.at(-1)).toEqual({ page: 1, pageSize: 5, sort: 'title', order: 'asc' });
    expect(cells(table)[0]).toBe('Produit 01');

    const products = within(ui.getByRole('table', { name: 'Produits' }).closest<HTMLElement>('.super-table')!);
    await userEvent.click(products.getByRole('button', { name: 'Suivant' }));
    await flush();
    expect(router.state().path).toBe('/kit/table?sort=title&order=asc&page=2&size=5');
    expect(cells(table)[0]).toBe('Produit 06');

    // Le nombre de lignes par page passe aussi par l'URL, et ramène à la première page.
    const size = products.getByLabelText('Lignes par page') as HTMLSelectElement;
    expect(size.value).toBe('5');
    await userEvent.selectOptions(size, '20');
    await flush();
    expect(router.state().path).toBe('/kit/table?sort=title&order=asc&page=1&size=20');
    expect(productCatalog.queries.at(-1)).toEqual({ page: 1, pageSize: 20, sort: 'title', order: 'asc' });
    expect(table.getAllByRole('row')).toHaveLength(21);
  });

  test('une valeur inconnue dans l’URL est ignorée : pas de tri, page 1', async () => {
    const { productCatalog } = await setup('/kit/table?sort=nimporte&page=abc&size=7');
    expect(productCatalog.queries.at(-1)).toEqual({ page: 1, pageSize: 10, sort: null, order: 'asc' });
  });
});

describe('kit : thème', () => {
  test('chaque exemple affiche le CSS qui le produit', async () => {
    const { ui } = await setup('/kit/theme');
    const code = [...document.querySelectorAll('.kit-code')].map((pre) => pre.textContent);
    expect(code.some((css) => css!.includes('.kit-ocean'))).toBe(true);
    expect(code.some((css) => css!.includes('color-scheme: dark'))).toBe(true);
    expect(ui.getByRole('button', { name: 'Avec class="kit-violet"' }).classList.contains('kit-violet')).toBe(true);
  });
});
