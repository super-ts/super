import { type Children, html } from '@super-ts/dom';
import { flush, mount } from '@super-ts/testing';
import { Badge, Button, columns, EmptyState, Skeleton, Spinner, Table } from '@super-ts/ui';
import { describe, expect, test, vi } from 'vitest';
import type { Book } from './__fixtures__/ui-contracts';

const text = (strings: TemplateStringsArray, ...values: unknown[]) => html(strings, ...values) as unknown as Children;

describe('affichage', () => {
  test('Button : variante, type, et press au clic', async () => {
    const press = vi.fn();
    const { container } = await mount(Button, { props: { content: text`Supprimer`, variant: 'danger', type: 'submit' }, on: { press } });
    const button = container.querySelector('button')!;
    expect([button.type, button.dataset.variant]).toEqual(['submit', 'danger']);
    button.click();
    expect(press).toHaveBeenCalledOnce();
  });

  test('Badge, Spinner, Skeleton, EmptyState', async () => {
    expect(
      (await mount(Badge, { props: { content: text`3`, tone: 'info' } })).container
        .querySelector('.super-badge')!
        .getAttribute('data-tone'),
    ).toBe('info');

    const spinner = (await mount(Spinner, {})).container;
    expect(spinner.querySelector('[role=status]')!.textContent!.trim()).toBe('Chargement…');

    const skeleton = (await mount(Skeleton, { props: { lines: 3, width: '60%' } })).container;
    expect(skeleton.querySelectorAll('.super-skeleton-line')).toHaveLength(3);
    expect(skeleton.querySelector('.super-skeleton')!.getAttribute('aria-hidden')).toBe('true');

    const empty = (
      await mount(EmptyState, { props: { title: 'Aucun livre', content: text`Ajoute-en un.`, action: text`<button>Ajouter</button>` } })
    ).container;
    expect(empty.textContent!.replace(/\s+/g, ' ').trim()).toBe('Aucun livre Ajoute-en un. Ajouter');
  });
});

const BOOKS: Book[] = [
  { id: 1, title: 'Dune', year: 1965 },
  { id: 2, title: 'Akira', year: 1982 },
  { id: 3, title: 'Neuromancien', year: 1984 },
  { id: 4, title: 'Fondation', year: 1951 },
];
const COLUMNS = columns<Book>([
  { key: 'title', label: 'Titre', sortable: true },
  { key: 'year', label: 'Année', sortable: true, align: 'end' },
  { key: 'decade', label: 'Décennie', value: (b) => `${Math.floor(b.year / 10) * 10}s` },
]);
const titles = (container: HTMLElement) => [...container.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')!.textContent);
const header = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('th button')].find((b) => b.textContent!.trim() === label)!;

describe('Table statique', () => {
  test('affiche les lignes ; trier sur un en-tête, puis l’inverser', async () => {
    const sort = vi.fn();
    const { container } = await mount(Table, {
      props: { columns: COLUMNS, rows: BOOKS, rowKey: (b) => b.id, caption: 'Livres' },
      on: { sort },
    });
    expect(titles(container)).toEqual(['Dune', 'Akira', 'Neuromancien', 'Fondation']);
    expect(container.querySelector('tbody td:nth-child(3)')!.textContent).toBe('1960s');

    header(container, 'Année').click();
    await flush();
    expect(titles(container)).toEqual(['Fondation', 'Dune', 'Akira', 'Neuromancien']);
    expect(container.querySelector('th[aria-sort=ascending]')!.textContent!.trim()).toBe('Année');

    header(container, 'Année').click();
    await flush();
    expect(titles(container)).toEqual(['Neuromancien', 'Akira', 'Dune', 'Fondation']);
    expect(sort.mock.calls).toEqual([[{ key: 'year', direction: 'asc' }], [{ key: 'year', direction: 'desc' }]]);
  });

  test('pagine elle-même, sans rien demander', async () => {
    const request = vi.fn();
    const { container } = await mount(Table, {
      props: { columns: COLUMNS, rows: BOOKS, rowKey: (b) => b.id, pageSize: 3 },
      on: { request },
    });
    expect(titles(container)).toEqual(['Dune', 'Akira', 'Neuromancien']);
    expect(container.querySelector('.super-table-page')!.textContent).toBe('Page 1 sur 2');

    [...container.querySelectorAll<HTMLButtonElement>('.super-table-pages button')].at(-1)!.click();
    await flush();
    expect(titles(container)).toEqual(['Fondation']);
    expect(request).not.toHaveBeenCalled();
  });

  test('le nombre de lignes par page se choisit, et ramène à la première page', async () => {
    const pageSize = vi.fn();
    const { container } = await mount(Table, {
      props: { columns: COLUMNS, rows: BOOKS, rowKey: (b) => b.id, pageSize: 2, pageSizes: [2, 4] },
      on: { pageSize },
    });
    [...container.querySelectorAll<HTMLButtonElement>('.super-table-pages button')].at(-1)!.click();
    await flush();
    expect(container.querySelector('.super-table-page')!.textContent).toBe('Page 2 sur 2');

    const select = container.querySelector<HTMLSelectElement>('.super-table-size select')!;
    expect(select.value).toBe('2');
    select.value = '4';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    expect(pageSize).toHaveBeenCalledWith({ pageSize: 4 });
    expect(titles(container)).toEqual(['Dune', 'Akira', 'Neuromancien', 'Fondation']);
    expect(container.querySelector('.super-table-page')!.textContent).toBe('Page 1 sur 1');
  });

  test('une taille de page repassée par le parent l’emporte sur le dernier choix', async () => {
    const props = { columns: COLUMNS, rows: BOOKS, rowKey: (b: Book) => b.id, pageSizes: [1, 2, 4] };
    const { container, setProps } = await mount(Table, { props: { ...props, pageSize: 2 } });
    const select = container.querySelector<HTMLSelectElement>('.super-table-size select')!;
    select.value = '4';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(titles(container)).toHaveLength(4);

    await setProps({ ...props, pageSize: 1 }); // l'URL a changé (retour arrière, par exemple)
    expect(titles(container)).toHaveLength(1);
  });

  test('par défaut, la table défile dans sa propre zone, nommée par son titre ; scroll={false} l’en retire', async () => {
    const { container } = await mount(Table, { props: { columns: COLUMNS, rows: BOOKS, rowKey: (b) => b.id, caption: 'Livres' } });
    const zone = container.querySelector<HTMLElement>('.super-table-scroll')!;
    const caption = container.querySelector('.super-table-caption')!;
    expect(zone.getAttribute('role')).toBe('region');
    expect(zone.tabIndex).toBe(0); // atteignable au clavier, pour défiler avec les flèches
    expect(zone.getAttribute('aria-labelledby')).toBe(caption.id);
    expect(zone.contains(caption)).toBe(false); // le titre reste visible pendant le défilement
    expect(container.querySelector('table')!.getAttribute('aria-labelledby')).toBe(caption.id);

    const plain = await mount(Table, { props: { columns: COLUMNS, rows: BOOKS, rowKey: (b) => b.id, scroll: false } });
    expect(plain.container.querySelector('.super-table-scroll')).toBeNull();
    expect(plain.container.querySelector('table')).not.toBeNull();
  });

  test('aucune ligne : le message vide', async () => {
    const { container } = await mount(Table, { props: { columns: COLUMNS, rows: [], rowKey: (b) => b.id, emptyLabel: 'Aucun livre' } });
    expect(container.querySelector('tbody')!.textContent!.trim()).toBe('Aucun livre');
  });
});

describe('Table branchée', () => {
  test('demande ses données au montage, puis à chaque changement de tri ou de page ; affiche la page reçue telle quelle', async () => {
    const request = vi.fn();
    const props = { columns: COLUMNS, rows: BOOKS.slice(0, 2), rowKey: (b: Book) => b.id, total: 4, pageSize: 2 };
    const { container } = await mount(Table, { props, on: { request } });
    await flush();
    expect(request.mock.calls).toEqual([[{ sort: null, page: 1, pageSize: 2 }]]);
    expect(titles(container)).toEqual(['Dune', 'Akira']);

    header(container, 'Titre').click();
    await flush();
    expect(request.mock.lastCall).toEqual([{ sort: { key: 'title', direction: 'asc' }, page: 1, pageSize: 2 }]);
    expect(titles(container)).toEqual(['Dune', 'Akira']); // pas de tri local : le serveur trie

    [...container.querySelectorAll<HTMLButtonElement>('.super-table-pages button')].at(-1)!.click();
    await flush();
    expect(request.mock.lastCall).toEqual([{ sort: { key: 'title', direction: 'asc' }, page: 2, pageSize: 2 }]);
  });

  test('pilotée par le parent (la query de la route) : un nouveau tri ou une nouvelle page en props redemande', async () => {
    const request = vi.fn();
    const sort = vi.fn();
    const base = { columns: COLUMNS, rows: BOOKS, rowKey: (b: Book) => b.id, total: 40, pageSize: 10 };
    const { container, setProps } = await mount(Table, { props: { ...base, sort: null, page: 1 }, on: { request, sort } });
    await flush();

    // Le clic prévient le parent ; c'est lui qui change la route, puis les props.
    header(container, 'Titre').click();
    await flush();
    expect(sort).toHaveBeenCalledWith({ key: 'title', direction: 'asc' });
    expect(request).toHaveBeenCalledTimes(1);

    await setProps({ ...base, sort: { key: 'title', direction: 'asc' }, page: 3 });
    await flush();
    expect(request.mock.lastCall).toEqual([{ sort: { key: 'title', direction: 'asc' }, page: 3, pageSize: 10 }]);
    expect(container.querySelector('.super-table-page')!.textContent).toBe('Page 3 sur 4');
  });
});
