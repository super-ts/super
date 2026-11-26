/**
 * Où est le curseur dans un template, pour la complétion : sur un nom de balise, une balise
 * fermante, ou un nom d'attribut. Lecture lexicale : elle marche aussi sur un fichier en cours de
 * frappe, que le parser n'arrive pas encore à lire en entier.
 */
import type { Span } from './parser.ts';

export type TemplateContext =
  /** `<Gre|` : nom de balise (ou de composant) ; `</|` : balise fermante, `open` est la balise à fermer. */
  | { kind: 'tag'; prefix: Span; closing: false }
  | { kind: 'tag'; prefix: Span; closing: true; open: string | null }
  /** `<:fo|` dans un composant : un emplacement nommé de `parent` (la balise ouverte qui l'entoure). */
  | { kind: 'slot'; prefix: Span; parent: string | null }
  /** `<a hr|`, `<Card on:|` : nom d'attribut, dans la balise `tag` ; `present` : attributs déjà écrits. */
  | { kind: 'attribute'; tag: string; prefix: Span; present: string[] };

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const NAME = /[\w.$-]/;

/**
 * Un `<` qui ouvre une balise : `</` (une balise fermante suit souvent du texte, `a</p>`), ou suivi
 * d'une lettre ou de rien et pas collé à un nom (`Map<string>` est du TS).
 */
function opensTag(source: string, i: number, offset: number): boolean {
  const next = source[i + 1];
  if (next === '/') return true;
  if (next === ':') return !/[\w$.)\]]/.test(source[i - 1] ?? '');
  return (i + 1 === offset || /[A-Za-z]/.test(next ?? '')) && !/[\w$.)\]]/.test(source[i - 1] ?? '');
}

/**
 * Parcourt une balise ouvrante à partir de `from` (juste après le nom) jusqu'à son `>` hors
 * accolades et guillemets. Renvoie la position du `>`, ou `null` si `limit` arrive avant, avec
 * l'état à `limit` (dans une valeur ou non).
 */
function scanTag(source: string, from: number, limit: number): { close: number | null; inValue: boolean } {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < limit; i++) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || (c === '`' && depth > 0)) quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    else if (c === '>' && depth === 0) return { close: i, inValue: false };
  }
  return { close: null, inValue: quote !== null || depth > 0 };
}

/** Les balises ouvertes (pas encore fermées) avant `end`, de la plus extérieure à la plus intérieure. */
export function openTagsBefore(source: string, end: number): string[] {
  const stack: string[] = [];
  for (let i = 0; i < end; i++) {
    if (source[i] !== '<' || !opensTag(source, i, -1)) continue;
    const closing = source[i + 1] === '/';
    let j = i + (closing ? 2 : 1);
    while (j < end && NAME.test(source[j] as string)) j++;
    const name = source.slice(i + (closing ? 2 : 1), j);
    if (!name) continue;
    if (closing) {
      const at = stack.lastIndexOf(name);
      if (at !== -1) stack.length = at;
      continue;
    }
    const { close } = scanTag(source, j, end);
    if (close === null) break; // La balise ouvrante n'est pas finie : c'est elle qu'on est en train d'écrire.
    if (source[close - 1] !== '/' && !VOID.has(name)) stack.push(name);
    i = close;
  }
  return stack;
}

export function templateContext(source: string, offset: number): TemplateContext | null {
  // Le `<` le plus proche avant le curseur dont la balise n'est pas encore refermée par `>`.
  for (let i = offset - 1; i >= Math.max(0, offset - 4000); i--) {
    if (source[i] !== '<' || !opensTag(source, i, offset)) continue;
    // `<:nom` : un emplacement nommé du composant ouvert autour.
    if (source[i + 1] === ':') {
      let end = i + 2;
      while (end < offset && NAME.test(source[end] as string)) end++;
      if (end !== offset) return null;
      return { kind: 'slot', prefix: { start: i + 2, end: offset }, parent: openTagsBefore(source, i).at(-1) ?? null };
    }
    const closing = source[i + 1] === '/';
    const nameStart = i + (closing ? 2 : 1);
    let nameEnd = nameStart;
    while (nameEnd < offset && NAME.test(source[nameEnd] as string)) nameEnd++;
    if (nameEnd === offset) {
      const prefix = { start: nameStart, end: offset };
      if (!closing) return { kind: 'tag', prefix, closing: false };
      return { kind: 'tag', prefix, closing: true, open: openTagsBefore(source, i).at(-1) ?? null };
    }
    if (closing) return null;
    const { close, inValue } = scanTag(source, nameEnd, offset);
    if (close !== null) return null; // Cette balise est déjà fermée : le curseur est après.
    if (inValue) return null; // Dans une valeur (`"…"` ou `{…}`) : c'est du texte ou du TS.
    // Le nom d'attribut en cours, précédé d'un blanc.
    let start = offset;
    while (start > nameEnd && /[\w:.-]/.test(source[start - 1] as string)) start--;
    if (!/\s/.test(source[start - 1] ?? '')) return null;
    return {
      kind: 'attribute',
      tag: source.slice(nameStart, nameEnd),
      prefix: { start, end: offset },
      present: attributesIn(source.slice(nameEnd, start)),
    };
  }
  return null;
}

/** Les noms d'attributs écrits dans un morceau de balise (valeurs retirées). */
function attributesIn(text: string): string[] {
  let bare = '';
  let depth = 0;
  let quote: string | null = null;
  for (const c of text) {
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) bare += c;
  }
  return [...bare.matchAll(/(?:^|\s)([A-Za-z][\w:.-]*)/g)].map((m) => m[1] as string);
}
