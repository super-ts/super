import { type Children, html } from '@super-ts/dom';
import { flush, mount } from '@super-ts/testing';
import { Badge, Button, columns, EmptyState, Skeleton, Spinner, Table } from '@super-ts/ui';
import { describe, expect, test, vi } from 'vitest';
import type { Book } from './__fixtures__/ui-contracts.ts';

const text = (strings: TemplateStringsArray, ...values: unknown[]) => html(strings, ...values) as unknown as Children;

describe('display', () => {
  test('Button: variant, type, and press on click', async () => {
    const press = vi.fn();
    const { container } = await mount(Button, { props: { content: text`Delete`, variant: 'danger', type: 'submit' }, on: { press } });
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
    expect(spinner.querySelector('[role=status]')!.textContent!.trim()).toBe('Loading…');

    const skeleton = (await mount(Skeleton, { props: { lines: 3, width: '60%' } })).container;
    expect(skeleton.querySelectorAll('.super-skeleton-line')).toHaveLength(3);
    expect(skeleton.querySelector('.super-skeleton')!.getAttribute('aria-hidden')).toBe('true');

    const empty = (await mount(EmptyState, { props: { title: 'No books', content: text`Add one.`, action: text`<button>Add</button>` } }))
      .container;
    expect(empty.textContent!.replace(/\s+/g, ' ').trim()).toBe('No books Add one. Add');
  });
});

const BOOKS: Book[] = [
  { id: 1, title: 'Dune', year: 1965 },
  { id: 2, title: 'Akira', year: 1982 },
  { id: 3, title: 'Neuromancer', year: 1984 },
  { id: 4, title: 'Foundation', year: 1951 },
];
const COLUMNS = columns<Book>([
  { key: 'title', label: 'Title', sortable: true },
  { key: 'year', label: 'Year', sortable: true, align: 'end' },
  { key: 'decade', label: 'Decade', value: (b) => `${Math.floor(b.year / 10) * 10}s` },
]);
const titles = (container: HTMLElement) => [...container.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')!.textContent);
const header = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('th button')].find((b) => b.textContent!.trim() === label)!;

describe('Static table', () => {
  test('displays the rows; sort on a header, then reverse it', async () => {
    const sort = vi.fn();
    const { container } = await mount(Table, {
      props: { columns: COLUMNS, rows: BOOKS, rowKey: (b) => b.id, caption: 'Books' },
      on: { sort },
    });
    expect(titles(container)).toEqual(['Dune', 'Akira', 'Neuromancer', 'Foundation']);
    expect(container.querySelector('tbody td:nth-child(3)')!.textContent).toBe('1960s');

    header(container, 'Year').click();
    await flush();
    expect(titles(container)).toEqual(['Foundation', 'Dune', 'Akira', 'Neuromancer']);
    expect(container.querySelector('th[aria-sort=ascending]')!.textContent!.trim()).toBe('Year');

    header(container, 'Year').click();
    await flush();
    expect(titles(container)).toEqual(['Neuromancer', 'Akira', 'Dune', 'Foundation']);
    expect(sort.mock.calls).toEqual([[{ key: 'year', direction: 'asc' }], [{ key: 'year', direction: 'desc' }]]);
  });

  test('paginates by itself, without requesting anything', async () => {
    const request = vi.fn();
    const { container } = await mount(Table, {
      props: { columns: COLUMNS, rows: BOOKS, rowKey: (b) => b.id, pageSize: 3 },
      on: { request },
    });
    expect(titles(container)).toEqual(['Dune', 'Akira', 'Neuromancer']);
    expect(container.querySelector('.super-table-page')!.textContent).toBe('Page 1 of 2');

    [...container.querySelectorAll<HTMLButtonElement>('.super-table-pages button')].at(-1)!.click();
    await flush();
    expect(titles(container)).toEqual(['Foundation']);
    expect(request).not.toHaveBeenCalled();
  });

  test('the number of rows per page can be chosen, and goes back to the first page', async () => {
    const pageSize = vi.fn();
    const { container } = await mount(Table, {
      props: { columns: COLUMNS, rows: BOOKS, rowKey: (b) => b.id, pageSize: 2, pageSizes: [2, 4] },
      on: { pageSize },
    });
    [...container.querySelectorAll<HTMLButtonElement>('.super-table-pages button')].at(-1)!.click();
    await flush();
    expect(container.querySelector('.super-table-page')!.textContent).toBe('Page 2 of 2');

    const select = container.querySelector<HTMLSelectElement>('.super-table-size select')!;
    expect(select.value).toBe('2');
    select.value = '4';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    expect(pageSize).toHaveBeenCalledWith({ pageSize: 4 });
    expect(titles(container)).toEqual(['Dune', 'Akira', 'Neuromancer', 'Foundation']);
    expect(container.querySelector('.super-table-page')!.textContent).toBe('Page 1 of 1');
  });

  test('a page size passed again by the parent takes precedence over the last choice', async () => {
    const props = { columns: COLUMNS, rows: BOOKS, rowKey: (b: Book) => b.id, pageSizes: [1, 2, 4] };
    const { container, setProps } = await mount(Table, { props: { ...props, pageSize: 2 } });
    const select = container.querySelector<HTMLSelectElement>('.super-table-size select')!;
    select.value = '4';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(titles(container)).toHaveLength(4);

    await setProps({ ...props, pageSize: 1 }); // the URL changed (going back, for example)
    expect(titles(container)).toHaveLength(1);
  });

  test('by default, the table scrolls in its own region, named by its caption; scroll={false} removes it', async () => {
    const { container } = await mount(Table, { props: { columns: COLUMNS, rows: BOOKS, rowKey: (b) => b.id, caption: 'Books' } });
    const zone = container.querySelector<HTMLElement>('.super-table-scroll')!;
    const caption = container.querySelector('.super-table-caption')!;
    expect(zone.getAttribute('role')).toBe('region');
    expect(zone.tabIndex).toBe(0); // reachable with the keyboard, to scroll with the arrow keys
    expect(zone.getAttribute('aria-labelledby')).toBe(caption.id);
    expect(zone.contains(caption)).toBe(false); // the caption stays visible while scrolling
    expect(container.querySelector('table')!.getAttribute('aria-labelledby')).toBe(caption.id);

    const plain = await mount(Table, { props: { columns: COLUMNS, rows: BOOKS, rowKey: (b) => b.id, scroll: false } });
    expect(plain.container.querySelector('.super-table-scroll')).toBeNull();
    expect(plain.container.querySelector('table')).not.toBeNull();
  });

  test('no rows: the empty message', async () => {
    const { container } = await mount(Table, { props: { columns: COLUMNS, rows: [], rowKey: (b) => b.id, emptyLabel: 'No books' } });
    expect(container.querySelector('tbody')!.textContent!.trim()).toBe('No books');
  });
});

describe('Connected table', () => {
  test('requests its data on mount, then on every sort or page change; displays the received page as is', async () => {
    const request = vi.fn();
    const props = { columns: COLUMNS, rows: BOOKS.slice(0, 2), rowKey: (b: Book) => b.id, total: 4, pageSize: 2 };
    const { container } = await mount(Table, { props, on: { request } });
    await flush();
    expect(request.mock.calls).toEqual([[{ sort: null, page: 1, pageSize: 2 }]]);
    expect(titles(container)).toEqual(['Dune', 'Akira']);

    header(container, 'Title').click();
    await flush();
    expect(request.mock.lastCall).toEqual([{ sort: { key: 'title', direction: 'asc' }, page: 1, pageSize: 2 }]);
    expect(titles(container)).toEqual(['Dune', 'Akira']); // no local sort: the server sorts

    [...container.querySelectorAll<HTMLButtonElement>('.super-table-pages button')].at(-1)!.click();
    await flush();
    expect(request.mock.lastCall).toEqual([{ sort: { key: 'title', direction: 'asc' }, page: 2, pageSize: 2 }]);
  });

  test('driven by the parent (the route query): a new sort or a new page in props requests again', async () => {
    const request = vi.fn();
    const sort = vi.fn();
    const base = { columns: COLUMNS, rows: BOOKS, rowKey: (b: Book) => b.id, total: 40, pageSize: 10 };
    const { container, setProps } = await mount(Table, { props: { ...base, sort: null, page: 1 }, on: { request, sort } });
    await flush();

    // The click notifies the parent; the parent changes the route, then the props.
    header(container, 'Title').click();
    await flush();
    expect(sort).toHaveBeenCalledWith({ key: 'title', direction: 'asc' });
    expect(request).toHaveBeenCalledTimes(1);

    await setProps({ ...base, sort: { key: 'title', direction: 'asc' }, page: 3 });
    await flush();
    expect(request.mock.lastCall).toEqual([{ sort: { key: 'title', direction: 'asc' }, page: 3, pageSize: 10 }]);
    expect(container.querySelector('.super-table-page')!.textContent).toBe('Page 3 of 4');
  });
});
