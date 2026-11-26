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

const idle: CounterState = { counts: { coffees: 2, pushups: 0, books: 1 }, loadErrorMessage: null };
const PRODUCTS: Product[] = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1,
  title: `Product ${String(i + 1).padStart(2, '0')}`,
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

describe('kit: table of contents', () => {
  test('leads to each component family', async () => {
    const { router, ui } = await setup('/kit');
    const families = ['Forms and commands', 'Windows', 'Primitives', 'Display', 'Table', 'Theme'];
    expect(families.map((name) => ui.getByRole('link', { name }).getAttribute('href'))).toEqual([
      '/kit/forms',
      '/kit/windows',
      '/kit/primitives',
      '/kit/display',
      '/kit/table',
      '/kit/theme',
    ]);
    await userEvent.click(ui.getByRole('link', { name: 'Windows' }));
    await flush();
    expect(router.state().name).toBe('kit-windows');
    expect(ui.getByRole('link', { name: '← The kit' }).getAttribute('href')).toBe('/kit');
  });
});

describe('kit: forms and commands', () => {
  test('the fields validate and submit the form, then a message confirms', async () => {
    const { profile, ui } = await setup('/kit/forms');
    await userEvent.click(ui.getByRole('button', { name: 'Save' }));
    await flush();
    expect(ui.getByText('Name required')).toBeTruthy();
    expect(ui.getByLabelText('Name').getAttribute('aria-invalid')).toBe('true');

    await userEvent.type(ui.getByLabelText('Name'), 'Ada');
    await userEvent.type(ui.getByLabelText('Email'), 'ada@example.com');
    await userEvent.click(ui.getByLabelText('Pro'));
    await userEvent.click(ui.getByRole('button', { name: 'Save' }));
    await new Promise((resolve) => setTimeout(resolve, 450)); // the address check waits 400 ms
    await flush();

    expect(profile.sent.at(-1)).toMatchObject({ name: 'save', args: [{ name: 'Ada', email: 'ada@example.com', plan: 'pro' }] });
    expect(ui.getByText('Profile saved.')).toBeTruthy();
  });
  test('the command button shows the counter and sends reset with its input', async () => {
    const { counter, ui } = await setup('/kit/forms');
    expect(ui.getByText('Coffees:').textContent).toContain('2');
    await userEvent.click(ui.getByRole('button', { name: 'Reset the coffees to zero' }));
    await flush();
    expect(counter.sent.at(-1)).toMatchObject({ name: 'reset', args: [{ id: 'coffees' }] });
  });
});

describe('kit: windows and primitives', () => {
  test('the modal opens and closes with Escape', async () => {
    const { ui } = await setup('/kit/windows');
    await userEvent.click(ui.getByRole('button', { name: 'Open a modal' }));
    await flush();
    expect(ui.getByRole('heading', { name: 'About' })).toBeTruthy();

    await userEvent.keyboard('{Escape}');
    await flush();
    expect(ui.queryByRole('heading', { name: 'About' })).toBeNull();
  });

  test('the menu pushes a message', async () => {
    const { ui } = await setup('/kit/primitives');
    await userEvent.click(ui.getByRole('button', { name: 'Actions' }));
    await userEvent.click(ui.getByRole('menuitem', { name: 'Say hello' }));
    await flush();
    expect(ui.getByText('Hello!')).toBeTruthy();
  });

  test('the hard-coded combobox filters by itself, ignoring case', async () => {
    const { ui } = await setup('/kit/primitives');
    await userEvent.type(ui.getByRole('combobox', { name: 'Fruit' }), 'PEACH');
    const options = ui.getAllByRole('option').map((option) => option.textContent!.trim());
    expect(options).toEqual(['Peach']);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await flush();
    expect(ui.getByText('Fruit chosen: Peach')).toBeTruthy();
  });

  test('the connected combobox searches the catalogue and suggests what it finds', async () => {
    const { productCatalog, ui } = await setup('/kit/primitives');
    await userEvent.type(ui.getByRole('combobox', { name: 'Product' }), 'product 1');
    await flush();
    expect(productCatalog.searches.at(-1)).toBe('product 1');
    const listbox = within(ui.getByRole('listbox', { name: 'Product' }));
    expect(listbox.getAllByRole('option').map((option) => option.textContent!.trim())).toEqual([
      'Product 10',
      'Product 11',
      'Product 12',
      'Product 13',
      'Product 14',
      'Product 15',
      'Product 16',
      'Product 17',
    ]);
    await userEvent.click(listbox.getByRole('option', { name: 'Product 12' }));
    await flush();
    expect(ui.getByText('Product chosen: Product 12')).toBeTruthy();
  });
});

describe('kit: table', () => {
  test('the static table sorts by itself', async () => {
    const { ui } = await setup('/kit/table');
    const table = within(ui.getByRole('table', { name: 'Counters' }));
    await userEvent.click(table.getByRole('button', { name: 'Value' }));
    await flush();
    expect(cells(table, 1)).toEqual(['0', '1']);
  });

  test('the connected table loads the page from the URL, and sorting or paging goes through the URL', async () => {
    const { productCatalog, router, ui } = await setup('/kit/table?sort=price&order=desc&page=2&size=5');
    const table = within(ui.getByRole('table', { name: 'Products' }));
    expect(productCatalog.queries.at(-1)).toEqual({ page: 2, pageSize: 5, sort: 'price', order: 'desc' });
    expect(ui.getByText('Page 2 of 4')).toBeTruthy();
    expect(table.getAllByRole('row')).toHaveLength(6);

    await userEvent.click(table.getByRole('button', { name: 'Product' }));
    await flush();
    expect(router.state().path).toBe('/kit/table?sort=title&order=asc&page=1&size=5');
    expect(productCatalog.queries.at(-1)).toEqual({ page: 1, pageSize: 5, sort: 'title', order: 'asc' });
    expect(cells(table)[0]).toBe('Product 01');

    const products = within(ui.getByRole('table', { name: 'Products' }).closest<HTMLElement>('.super-table')!);
    await userEvent.click(products.getByRole('button', { name: 'Next' }));
    await flush();
    expect(router.state().path).toBe('/kit/table?sort=title&order=asc&page=2&size=5');
    expect(cells(table)[0]).toBe('Product 06');

    // The number of rows per page also goes through the URL, and brings back the first page.
    const size = products.getByLabelText('Rows per page') as HTMLSelectElement;
    expect(size.value).toBe('5');
    await userEvent.selectOptions(size, '20');
    await flush();
    expect(router.state().path).toBe('/kit/table?sort=title&order=asc&page=1&size=20');
    expect(productCatalog.queries.at(-1)).toEqual({ page: 1, pageSize: 20, sort: 'title', order: 'asc' });
    expect(table.getAllByRole('row')).toHaveLength(21);
  });

  test('an unknown value in the URL is ignored: no sort, page 1', async () => {
    const { productCatalog } = await setup('/kit/table?sort=whatever&page=abc&size=7');
    expect(productCatalog.queries.at(-1)).toEqual({ page: 1, pageSize: 10, sort: null, order: 'asc' });
  });
});

describe('kit: theme', () => {
  test('each example shows the CSS that produces it', async () => {
    const { ui } = await setup('/kit/theme');
    const code = [...document.querySelectorAll('.kit-code')].map((pre) => pre.textContent);
    expect(code.some((css) => css!.includes('.kit-ocean'))).toBe(true);
    expect(code.some((css) => css!.includes('color-scheme: dark'))).toBe(true);
    expect(ui.getByRole('button', { name: 'With class="kit-violet"' }).classList.contains('kit-violet')).toBe(true);
  });
});
