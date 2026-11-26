/**
 * Where the cursor is in a template, for completion: on a tag name, a closing
 * tag, or an attribute name. A lexical reading: it also works on a file being
 * typed, which the parser cannot read in full yet.
 */
import type { Span } from './parser.ts';

export type TemplateContext =
  /** `<Gre|`: tag (or component) name; `</|`: closing tag, `open` is the tag to close. */
  | { kind: 'tag'; prefix: Span; closing: false }
  | { kind: 'tag'; prefix: Span; closing: true; open: string | null }
  /** `<:fo|` in a component: a named slot of `parent` (the open tag around it). */
  | { kind: 'slot'; prefix: Span; parent: string | null }
  /** `<a hr|`, `<Card on:|`: attribute name, in the tag `tag`; `present`: attributes already written. */
  | { kind: 'attribute'; tag: string; prefix: Span; present: string[] };

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const NAME = /[\w.$-]/;

/**
 * A `<` that opens a tag: `</` (a closing tag often follows text, `a</p>`), or followed
 * by a letter or by nothing and not glued to a name (`Map<string>` is TS).
 */
function opensTag(source: string, i: number, offset: number): boolean {
  const next = source[i + 1];
  if (next === '/') return true;
  if (next === ':') return !/[\w$.)\]]/.test(source[i - 1] ?? '');
  return (i + 1 === offset || /[A-Za-z]/.test(next ?? '')) && !/[\w$.)\]]/.test(source[i - 1] ?? '');
}

/**
 * Walks an opening tag from `from` (just after the name) up to its `>` outside
 * braces and quotes. Returns the position of the `>`, or `null` if `limit` comes first, with
 * the state at `limit` (inside a value or not).
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

/** The open tags (not closed yet) before `end`, from the outermost to the innermost. */
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
    if (close === null) break; // The opening tag is not finished: it is the one being written.
    if (source[close - 1] !== '/' && !VOID.has(name)) stack.push(name);
    i = close;
  }
  return stack;
}

export function templateContext(source: string, offset: number): TemplateContext | null {
  // The nearest `<` before the cursor whose tag is not closed by `>` yet.
  for (let i = offset - 1; i >= Math.max(0, offset - 4000); i--) {
    if (source[i] !== '<' || !opensTag(source, i, offset)) continue;
    // `<:name`: a named slot of the open component around it.
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
    if (close !== null) return null; // This tag is already closed: the cursor is after it.
    if (inValue) return null; // Inside a value (`"…"` or `{…}`): it is text or TS.
    // The attribute name being typed, preceded by whitespace.
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

/** The attribute names written in a piece of tag (values removed). */
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
