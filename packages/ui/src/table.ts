import { html, nothing, SuperElement } from '@super-ts/dom';
import { classes, uniqueId } from './shared.ts';

/** Une colonne : sa clé, son titre, et comment lire sa valeur dans une ligne. */
export type Column<Row> = {
  key: string;
  label: string;
  /** La valeur affichée et triée (défaut : `row[key]`). */
  value?: (row: Row) => string | number | boolean | null | undefined;
  sortable?: boolean;
  /** Alignement : `end` pour les nombres. */
  align?: 'start' | 'end';
};

/** Les colonnes d'une table, typées par ses lignes : `columns<Book>([{ key: 'title', label: 'Titre' }])`. */
export function columns<Row>(list: readonly Column<Row>[]): readonly Column<any>[] {
  return list;
}

export type Sort = { key: string; direction: 'asc' | 'desc' };
/** Ce que la table demande à ses données : le tri et la page affichés. */
export type TableRequest = { sort: Sort | null; page: number; pageSize: number | null };

type TableProps = {
  columns: readonly Column<any>[];
  rows: readonly any[];
  /** L'identité d'une ligne, pour que le rendu suive ses déplacements. */
  rowKey: (row: any) => string | number;
  /** Le titre de la table, lu par les lecteurs d'écran. */
  caption?: string;
  /** Le tri, si le parent le pilote (depuis la query de la route, par exemple). `null` : aucun tri. */
  sort?: Sort | null;
  /** La page (à partir de 1), si le parent la pilote. */
  page?: number;
  /** Lignes par page ; sans elle, pas de pagination. */
  pageSize?: number;
  /**
   * Les nombres de lignes par page proposés à l'utilisateur (`[10, 20, 50]`) : un choix « Lignes
   * par page » s'ajoute à la pagination, et émet `pageSize`. Le parent qui le garde dans l'URL
   * repasse la valeur choisie en `pageSize`.
   */
  pageSizes?: readonly number[];
  pageSizeLabel?: string;
  /**
   * Le nombre total de lignes côté serveur. Avec lui, la table est branchée : `rows` est la page
   * déjà triée, et la table demande les données par `request`. Sans lui, la table est statique :
   * elle trie et pagine `rows` elle-même.
   */
  total?: number;
  loading?: boolean;
  /**
   * Trop large pour la place disponible, la table défile de gauche à droite dans sa propre zone,
   * cellules sur une ligne, la pagination restant en place (défaut `true`). `false` : la table
   * prend la largeur de son conteneur, et son débordement est laissé à l'app.
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
 * Une table de données, statique ou branchée.
 *
 * - **Statique** : `rows` contient toutes les lignes ; la table trie et pagine elle-même, sans
 *   rien demander à personne.
 * - **Branchée** (`total` donné) : la table émet `request` (`{ sort, page }`) au montage puis à
 *   chaque changement de tri ou de page ; le parent la relie à une commande, et passe la page reçue.
 *
 * Le tri, la page et la taille des pages sont gardés par la table, ou pilotés par le parent
 * (`sort`, `page`, `pageSize`), prévenu
 * par `sort` et `page` : il les écrit alors dans la query de la route, par exemple.
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
  // `pageSize` choisi ici, et la prop telle qu'elle était à ce moment : si le parent change la
  // prop ensuite (l'URL a changé), c'est elle qui l'emporte.
  #ui = this.state({ sort: null as Sort | null, page: 1, pageSize: null as number | null, pageSizeFrom: undefined as number | undefined });
  #lastRequest: string | null = null;
  // Le titre est hors de la zone qui défile (il reste visible), et nomme la table par aria-labelledby.
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

  /** Les lignes affichées : telles quelles si la table est branchée, triées et découpées sinon. */
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
    // Trier ramène à la première page.
    this.#ui.set({ sort: next, page: 1 });
    this.emit('sort', next);
  }

  #resize = (event: Event) => {
    const pageSize = Number((event.currentTarget as HTMLSelectElement).value);
    // Changer la taille des pages ramène à la première.
    this.#ui.set({ pageSize, pageSizeFrom: this.props.pageSize, page: 1 });
    this.emit('pageSize', { pageSize });
  };

  #goTo(page: number) {
    this.#ui.set({ page });
    this.emit('page', { page });
  }

  /** Branchée : demande les données quand le tri ou la page affichés changent (et au premier rendu). */
  #requestIfChanged() {
    if (!this.#remote()) return;
    const request: TableRequest = { sort: this.#sort(), page: this.#page(), pageSize: this.#pageSize() ?? null };
    const key = JSON.stringify(request);
    if (key === this.#lastRequest) return;
    this.#lastRequest = key;
    // Émis après le rendu : un rendu ne déclenche rien lui-même.
    queueMicrotask(() => this.emit('request', request));
  }

  render() {
    const {
      columns,
      rowKey,
      caption,
      loading = false,
      scroll = true,
      emptyLabel = 'Aucune donnée',
      pageSizes,
      pageSizeLabel = 'Lignes par page',
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
              ? html`<tr><td class="super-table-empty" colspan=${columns.length}>${loading ? 'Chargement…' : emptyLabel}</td></tr>`
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
                Précédent
              </button>
              <span class="super-table-page" aria-current="page">Page ${page} sur ${pages}</span>
              <button type="button" class="super-button" data-variant="secondary" ?disabled=${page >= pages} @click=${() => this.#goTo(page + 1)}>
                Suivant
              </button>
            </nav>`
          : nothing
      }
    </div>`;
  }
}
