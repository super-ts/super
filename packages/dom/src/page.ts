/*
 * Le titre de la page (`document.title`), posé par les composants (`@title`, `this.page.title`).
 *
 * Chaque composant monté qui pose un titre a une entrée dans une pile, dans l'ordre où ils ont été
 * montés : la dernière entrée qui a un texte l'emporte. Au démontage, l'entrée disparaît et le titre
 * précédent revient. Le router fixe le titre par défaut et le suffixe commun (`createRouter`).
 */

/** Ce qu'un composant pose sur la page. */
export interface Page {
  /**
   * Le titre de la page, tant que le composant est monté. Une chaîne est posée telle quelle ; une
   * fonction est suivie : recalculée après chaque rendu du composant, elle lit les mêmes valeurs
   * que `render` (`() => \`Compteur ${this.label.value}\``). En écriture seulement.
   *
   * Posé dans un champ ou le constructeur (ce que fait `@title`), il est repris à chaque montage.
   * Posé une fois monté (`mounted`, gestionnaire), il remplace le titre du composant jusqu'au
   * démontage. Interdit pendant `render`.
   *
   * @example
   * this.page.title = 'Boutique';
   * this.page.title = () => `Compteur ${this.label.value}`;
   */
  get title(): never;
  set title(value: TitleValue);
}

export type TitleValue = string | (() => string);

/** Une entrée de la pile : le texte courant du titre d'un composant (`null` : pas encore calculé). */
export type TitleEntry = { text: string | null };

export type TitleOptions = {
  /** Le titre quand aucun composant n'en pose (défaut : le titre du document au premier titre posé). */
  default?: string;
  /** Ajouté au titre posé par un composant : `' · Ma démo'`. */
  suffix?: string;
};

const stack: TitleEntry[] = [];
let settings: { default: string | null; suffix: string } = { default: null, suffix: '' };
/** Le titre du document avant le premier titre posé : rétabli quand la pile se vide, sans défaut. */
let original: string | null = null;

/** Interne : réglages du router (`createRouter({ title })`). Sans réglage, ceux d'avant sont oubliés. */
export function configureTitle(options: TitleOptions = {}): void {
  settings = { default: options.default ?? null, suffix: options.suffix ?? '' };
  apply();
}

/** Interne : une nouvelle entrée, au sommet de la pile. */
export function pushTitle(): TitleEntry {
  if (original === null && typeof document !== 'undefined') original = document.title;
  const entry: TitleEntry = { text: null };
  stack.push(entry);
  return entry;
}

/** Interne : change le texte d'une entrée. */
export function updateTitle(entry: TitleEntry, text: string): void {
  if (entry.text === text) return;
  entry.text = text;
  apply();
}

/** Interne : retire une entrée (démontage). */
export function removeTitle(entry: TitleEntry): void {
  const index = stack.indexOf(entry);
  if (index === -1) return;
  stack.splice(index, 1);
  apply();
}

function apply() {
  if (typeof document === 'undefined') return;
  let top: string | null = null;
  for (let i = stack.length - 1; i >= 0 && top === null; i--) top = stack[i]!.text;
  const next = top !== null ? `${top}${settings.suffix}` : (settings.default ?? original);
  if (next !== null && document.title !== next) document.title = next;
}
