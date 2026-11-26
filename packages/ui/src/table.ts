import { html, nothing, SuperElement } from '@super-ts/dom';
import { classes, uniqueId } from './shared.ts';

/** A column: its key, its heading, and how to read its value in a row. */
export type Column<Row> = {
  key: string;
  label: string;
  /** The displayed and sorted value (default: `row[key]`). */
  value?: (row: Row) => string | number | boolean | null | undefined;
  sortable?: boolean;
  /** Alignment: `end` for numbers. */
  align?: 'start' | 'end';
};

/** A table's columns, typed by its rows: `columns<Book>([{ key: 'title', label: 'Title' }])`. */
export function columns<Row>(list: readonly Column<Row>[]): readonly Column<any>[] {
  return list;
}

export type Sort = { key: string; direction: 'asc' | 'desc' };
/** What the table asks of its data: the displayed sort and page. */
export type TableRequest = { sort: Sort | null; page: number; pageSize: number | null };

type TableProps = {
  columns: readonly Column<any>[];
  rows: readonly any[];
  /** A row's identity, so that rendering follows its moves. */
  rowKey: (row: any) => string | number;
  /** The table's caption, read by screen readers. */
  caption?: string;
  /** The sort, if the parent drives it (from the route query, for example). `null`: no sort. */
  sort?: Sort | null;
  /** The page (from 1), if the parent drives it. */
  page?: number;
  /** Rows per page; without it, no pagination. */
  pageSize?: number;
  /**
   * The numbers of rows per page offered to the user (`[10, 20, 50]`): a "Rows per page" choice
   * is added to the pagination, and emits `pageSize`. A parent that keeps it in the URL
   * passes the chosen value back as `pageSize`.
   */
  pageSizes?: readonly number[];
  pageSizeLabel?: string;
  /**
   * The total number of rows on the server side. With it, the table is connected: `rows` is the page
   * already sorted, and the table requests data through `request`. Without it, the table is static:
   * it sorts and paginates `rows` itself.
   */
  total?: number;
  loading?: boolean;
  /**
   * When too wide for the available space, the table scrolls horizontally in its own region,
   * cells on one line, the pagination staying in place (default `true`). `false`: the table
   * takes its container's width, and its overflow is left to the app.
   */
  scroll?: boolean;
  emptyLabel?: string;
  class?: string;
};

type TableEmits = { sort: Sort; page: { page: number }; pageSize: { pageSize: number }; request: TableRequest };

const compare = (a: unknown, b: unknown) => {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
};

/**
 * A data table, static or connected.
 *
 * - **Static**: `rows` contains all the rows; the table sorts and paginates itself, without
 *   asking anyone for anything.
 * - **Connected** (`total` given): the table emits `request` (`{ sort, page }`) on mount then on
 *   every sort or page change; the parent binds it to a command, and passes the received page.
 *
 * The sort, the page and the page size are kept by the table, or driven by the parent
 * (`sort`, `page`, `pageSize`), notified
 * through `sort` and `page`: it then writes them into the route query, for example.
 *
 * ```tsx
 * <Table columns={BOOK_COLUMNS} rows={this.books.value} rowKey={(b) => b.id} total={this.total.value} pageSize={20}
 *   sort={this.sort.value} page={this.page.value}
 *   on:sort={(sort) => this.router.send('navigate', { to: 'library', params: { id }, query: { sort: … } })}
 *   on:request={({ sort, page }) => this.library.send('load', { id, sort, page })} />
 * ```
 */
export class Table extends SuperElement<{ props: TableProps; emits: TableEmits }> {
  static tag = 'super-table';
  // `pageSize` chosen here, and the prop as it was at that moment: if the parent changes the
  // prop afterwards (the URL changed), the prop wins.
  #ui = this.state({ sort: null as Sort | null, page: 1, pageSize: null as number | null, pageSizeFrom: undefined as number | undefined });
  #lastRequest: string | null = null;
  // The caption is outside the scrolling region (it stays visible), and names the table through aria-labelledby.
  #captionId = uniqueId('super-table-caption');

  #sort(): Sort | null {
    return this.props.sort !== undefined ? this.props.sort : this.#ui.get().sort;
  }

  #page(): number {
    return this.props.page ?? this.#ui.get().page;
  }

  #pageSize(): number | undefined {
    const { pageSize, pageSizeFrom } = this.#ui.get();
    return pageSize !== null && pageSizeFrom === this.props.pageSize ? pageSize : this.props.pageSize;
  }

  #remote(): boolean {
    return this.props.total !== undefined;
  }

  #pages(): number {
    const { rows, total } = this.props;
    const pageSize = this.#pageSize();
    if (!pageSize) return 1;
    return Math.max(1, Math.ceil((total ?? rows.length) / pageSize));
  }

  #valueOf(column: Column<any>, row: any) {
    return column.value ? column.value(row) : row[column.key];
  }

  /** The displayed rows: as is if the table is connected, sorted and sliced otherwise. */
  #shown(): readonly any[] {
    const { rows, columns } = this.props;
    const pageSize = this.#pageSize();
    if (this.#remote()) return rows;
    const sort = this.#sort();
    const column = sort && columns.find((c) => c.key === sort.key);
    const sorted = column
      ? [...rows].sort((a, b) => compare(this.#valueOf(column, a), this.#valueOf(column, b)) * (sort.direction === 'asc' ? 1 : -1))
      : rows;
    if (!pageSize) return sorted;
    const start = (this.#page() - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }

  #toggleSort(column: Column<any>) {
    const current = this.#sort();
    const next: Sort = { key: column.key, direction: current?.key === column.key && current.direction === 'asc' ? 'desc' : 'asc' };
    // Sorting goes back to the first page.
    this.#ui.set({ sort: next, page: 1 });
    this.emit('sort', next);
  }

  #resize = (event: Event) => {
    const pageSize = Number((event.currentTarget as HTMLSelectElement).value);
    // Changing the page size goes back to the first page.
    this.#ui.set({ pageSize, pageSizeFrom: this.props.pageSize, page: 1 });
    this.emit('pageSize', { pageSize });
  };

  #goTo(page: number) {
    this.#ui.set({ page });
    this.emit('page', { page });
  }

  /** Connected: requests the data when the displayed sort or page changes (and on the first render). */
  #requestIfChanged() {
    if (!this.#remote()) return;
    const request: TableRequest = { sort: this.#sort(), page: this.#page(), pageSize: this.#pageSize() ?? null };
    const key = JSON.stringify(request);
    if (key === this.#lastRequest) return;
    this.#lastRequest = key;
    // Emitted after rendering: a render triggers nothing itself.
    queueMicrotask(() => this.emit('request', request));
  }

  render() {
    const {
      columns,
      rowKey,
      caption,
      loading = false,
      scroll = true,
      emptyLabel = 'No data',
      pageSizes,
      pageSizeLabel = 'Rows per page',
    } = this.props;
    const pageSize = this.#pageSize();
    this.#requestIfChanged();
    const sort = this.#sort();
    const page = this.#page();
    const pages = this.#pages();
    const shown = this.#shown();
    const ariaSort = (column: Column<any>) =>
      sort?.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : column.sortable ? 'none' : nothing;
    const table = html`<table aria-labelledby=${caption ? this.#captionId : nothing}>
        <thead>
          <tr>
            ${columns.map(
              (column) => html`<th scope="col" data-align=${column.align ?? 'start'} aria-sort=${ariaSort(column)}>
                ${
                  column.sortable
                    ? html`<button type="button" class="super-table-sort" @click=${() => this.#toggleSort(column)}>${column.label}</button>`
                    : column.label
                }
              </th>`,
            )}
          </tr>
        </thead>
        <tbody>
          ${
            shown.length === 0
              ? html`<tr><td class="super-table-empty" colspan=${columns.length}>${loading ? 'Loading…' : emptyLabel}</td></tr>`
              : shown.map(
                  (row) => html`<tr data-key=${rowKey(row)}>
                    ${columns.map((column) => html`<td data-align=${column.align ?? 'start'}>${this.#valueOf(column, row) ?? ''}</td>`)}
                  </tr>`,
                )
          }
        </tbody>
      </table>`;
    return html`<div class=${classes('super-table', this.props.class)} aria-busy=${loading ? 'true' : nothing}>
      ${caption ? html`<p class="super-table-caption" id=${this.#captionId}>${caption}</p>` : nothing}
      ${
        scroll
          ? html`<div class="super-table-scroll" tabindex="0" role="region" aria-labelledby=${caption ? this.#captionId : nothing} aria-label=${caption ? nothing : 'Table'}>
              ${table}
            </div>`
          : table
      }
      ${
        pages > 1 || pageSizes
          ? html`<nav class="super-table-pages" aria-label="Pagination">
              ${
                pageSizes
                  ? html`<label class="super-table-size">
                      ${pageSizeLabel}
                      <select class="super-input" .value=${String(pageSize ?? '')} @change=${this.#resize}>
                        ${pageSizes.map((size) => html`<option value=${size} ?selected=${size === pageSize}>${size}</option>`)}
                      </select>
                    </label>`
                  : nothing
              }
              <button type="button" class="super-button" data-variant="secondary" ?disabled=${page <= 1} @click=${() => this.#goTo(page - 1)}>
                Previous
              </button>
              <span class="super-table-page" aria-current="page">Page ${page} of ${pages}</span>
              <button type="button" class="super-button" data-variant="secondary" ?disabled=${page >= pages} @click=${() => this.#goTo(page + 1)}>
                Next
              </button>
            </nav>`
          : nothing
      }
    </div>`;
  }
}
