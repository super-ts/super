/**
 * Formatting of a `.super` file: the TS with Biome (with the repository's rules), the templates with
 * this module.
 *
 * Each top-level element is replaced by a placeholder statement while
 * Biome formats the TS; Biome gives it its place and indentation, then the template is printed there.
 *
 * The render never changes: a line is only broken where there is already whitespace (which counts
 * as one space, line break or not) or at the edge of an element, a block or a
 * statement (where whitespace renders nothing).
 */
import { type Attribute, type ChildNode, type ElementNode, parse, type Span } from './parser.ts';

export type FormatOptions = {
  /** Formats TS (Biome, in practice). */
  formatTs: (code: string) => string;
  lineWidth?: number;
  indent?: string;
};

const placeholder = (n: number) => `__super_element_${n}__;`;
const PLACEHOLDER = /__super_element_(\d+)__;/g;
const MEMBER_NAME = '_';
const NAMED_MEMBER = /(@(?:tag|title)) _ =/g;

/** The formatted file, or `null` if it has syntax errors (a broken file is not formatted). */
export function formatSuper(source: string, { formatTs, lineWidth = 140, indent = '  ' }: FormatOptions): string | null {
  const file = parse(source);
  if (file.diagnostics.length > 0) return null;
  const elements = file.parts.filter((p): p is ElementNode => p.kind === 'element');
  // `@tag = …` and `@title = …` are not TS: while Biome formats, they take a name
  // (`@tag _ = …`, a decorated field), removed afterwards.
  const named = file.classes.flatMap((c) =>
    c.members.filter((m) => m.kind === 'tag' || m.kind === 'title').map((m) => m.span.start + m.kind.length + 1),
  );
  const code = (at: number, end: number) => {
    let out = '';
    for (const point of named.filter((p) => p >= at && p < end)) {
      out += `${source.slice(at, point)} ${MEMBER_NAME}`;
      at = point;
    }
    return out + source.slice(at, end);
  };
  let ts = '';
  let n = 0;
  for (const part of file.parts) ts += part.kind === 'code' ? code(part.span.start, part.span.end) : placeholder(n++);
  const formatted = formatTs(ts).replace(NAMED_MEMBER, '$1 =');
  const printer = new Printer(source, lineWidth, indent);
  return formatted.replace(PLACEHOLDER, (match, index: string, offset: number) => {
    const lineStart = formatted.lastIndexOf('\n', offset - 1) + 1;
    const column = offset - lineStart;
    const element = elements[Number(index)];
    if (!element) return match;
    return printer.element(element, column).join('\n');
  });
}

/** A piece of a run of inline children, and whether it is separated from the previous one by whitespace. */
type Atom = { lines: string[]; spaceBefore: boolean; blankBefore: boolean; element: boolean; word?: true; slot?: true };

const isStatement = (node: ChildNode) =>
  node.kind === 'if' || node.kind === 'for' || node.kind === 'switch' || node.kind === 'declaration' || node.kind === 'partial';

class Printer {
  readonly src: string;
  readonly width: number;
  readonly unit: string;

  constructor(src: string, width: number, unit: string) {
    this.src = src;
    this.width = width;
    this.unit = unit;
  }

  text(span: Span) {
    return this.src.slice(span.start, span.end);
  }

  /**
   * An expression as written; its following lines are shifted to follow `column` (the
   * column where it now starts), keeping their relative indentation.
   */
  expression(span: Span, column: number): string {
    const raw = this.text(span).trim();
    const lines = raw.split('\n');
    if (lines.length === 1) return raw;
    const rest = lines.slice(1);
    const common = Math.min(...rest.filter((l) => l.trim()).map((l) => (l.match(/^ */) as RegExpMatchArray)[0].length));
    const pad = ' '.repeat(column + this.unit.length);
    return [lines[0], ...rest.map((l) => (l.trim() ? pad + l.slice(common) : ''))].join('\n');
  }

  attribute(attribute: Attribute, column: number): string {
    if (attribute.kind === 'directive') return `{${this.expression(attribute.expr, column)}}`;
    const { name, value } = attribute;
    if (value === null) return name;
    if (value.kind === 'string') return `${name}=${this.text(value.span)}`;
    return `${name}={${this.expression(value.span, column)}}`;
  }

  /** An element on a single line, or `null` if it cannot be (statement, line too long, line break). */
  flat(node: ElementNode, column: number): string | null {
    // A component that receives children, and a slot `<:name>`, always on several lines:
    // what goes into which slot reads at a glance.
    if (node.slot !== undefined || (node.component && this.hasContent(node))) return null;
    const attributes = node.attributes.map((a) => ` ${this.attribute(a, column)}`).join('');
    let line: string;
    if (node.children === null) line = `<${node.name}${attributes} />`;
    else {
      if (node.children.some(isStatement)) return null;
      const inner = this.flatRun(node.children);
      if (inner === null) return null;
      line = `<${node.name}${attributes}>${inner}</${node.name}>`;
    }
    return line.includes('\n') || column + line.length > this.width ? null : line;
  }

  /** Children other than whitespace and comments. */
  hasContent(node: ElementNode): boolean {
    return (node.children ?? []).some((c) => c.kind !== 'comment' && !(c.kind === 'text' && this.text(c.span).trim() === ''));
  }

  /** Inline children on a single line (whitespace reduced to one space, edges removed). */
  flatRun(children: ChildNode[]): string | null {
    let out = '';
    for (const child of children) {
      if (child.kind === 'text') out += this.text(child.span).replace(/\s+/g, ' ');
      else if (child.kind === 'expr') out += `{${this.text(child.expr).trim()}}`;
      else if (child.kind === 'comment') out += this.text(child.span);
      else if (child.kind === 'element') {
        const flat = this.flat(child, 0);
        if (flat === null) return null;
        out += flat;
      } else return null;
    }
    return out.trim();
  }

  /** An element from `column`: the first line without indentation, the following ones with it. */
  element(node: ElementNode, column: number): string[] {
    const flat = this.flat(node, column);
    if (flat !== null) return [flat];
    const pad = ' '.repeat(column);
    const inner = column + this.unit.length;
    // The opening tag on one line if it fits, otherwise one attribute per line.
    const attributes = node.attributes.map((a) => ` ${this.attribute(a, column)}`).join('');
    const close = node.children === null ? ' />' : '>';
    const opening = `<${node.name}${attributes}${close}`;
    const lines =
      !opening.includes('\n') && column + opening.length <= this.width
        ? [opening]
        : [
            `<${node.name}`,
            ...node.attributes.map((a) => ' '.repeat(inner) + this.attribute(a, inner)),
            pad + (node.children === null ? '/>' : '>'),
          ];
    if (node.children === null) return lines;
    const body = this.children(node.children, inner);
    if (body.length === 0) return [...lines.slice(0, -1), `${lines.at(-1)}</${node.name}>`];
    return [...lines, ...body, `${pad}</${node.name}>`];
  }

  /** The children of an element or a block, one line per entry, with their indentation. */
  children(children: ChildNode[], column: number): string[] {
    const lines: string[] = [];
    let run: ChildNode[] = [];
    let blank = false;
    const flush = () => {
      // Blank line before the run: between it and the previous child, or at the start of its own text.
      const first = run[0];
      const leading = first?.kind === 'text' && /^[ \t]*\n[ \t]*\n/.test(this.text(first.span));
      if (run.length > 0) lines.push(...this.run(run, column, (blank || leading) && lines.length > 0));
      run = [];
    };
    for (const child of children) {
      if (!isStatement(child)) {
        if (run.length === 0) blank = this.blankBefore(children, child);
        run.push(child);
        continue;
      }
      flush();
      if (this.blankBefore(children, child) && lines.length > 0) lines.push('');
      lines.push(...this.statement(child, column));
    }
    flush();
    return lines;
  }

  /** Does a blank line precede `child` in the source (in the whitespace between it and the previous child)? */
  blankBefore(siblings: ChildNode[], child: ChildNode): boolean {
    const previous = siblings[siblings.indexOf(child) - 1];
    if (!previous) return false;
    const between = (previous.kind === 'text' ? this.text(previous.span) : '') + this.src.slice(previous.span.end, child.span.start);
    return /\n[ \t]*\n[ \t]*$/.test((between.match(/\s*$/) as RegExpMatchArray)[0]);
  }

  /** A run of inline children, filled word by word; an element separated by whitespace goes on a new line. */
  run(children: ChildNode[], column: number, blankFirst: boolean): string[] {
    const pad = ' '.repeat(column);
    const flat = this.flatRun(children);
    if (flat !== null && flat !== '' && !flat.includes('\n') && column + flat.length <= this.width)
      return blankFirst ? ['', pad + flat] : [pad + flat];

    const atoms: Atom[] = [];
    let space = false;
    let blank = false;
    for (const child of children) {
      if (child.kind === 'text') {
        const text = this.text(child.span);
        const words = text.split(/\s+/).filter(Boolean);
        if (words.length === 0) {
          space = true;
          blank ||= /\n[ \t]*\n/.test(text);
          continue;
        }
        if (/^\s/.test(text)) space = true;
        if (/^\s*\n[ \t]*\n/.test(text)) blank = true;
        words.forEach((word, i) => {
          atoms.push({ lines: [word], spaceBefore: i === 0 ? space : true, blankBefore: i === 0 && blank, element: false, word: true });
        });
        space = /\s$/.test(text);
        blank = /\n[ \t]*\n[ \t]*$/.test(text);
        continue;
      }
      if (child.kind === 'expr' || child.kind === 'comment') {
        const raw = child.kind === 'expr' ? `{${this.expression(child.expr, column)}}` : this.text(child.span);
        atoms.push({ lines: raw.split('\n'), spaceBefore: space, blankBefore: blank, element: false });
      } else if (child.kind === 'element') {
        // A slot `<:name>` is not rendered at this place (it goes into a prop): a line can be broken
        // before and after it without changing the render, unless it is glued to text.
        const slot = child.slot !== undefined;
        const previous = atoms.at(-1);
        const glued = slot && previous !== undefined && !previous.element && !space;
        atoms.push({
          lines: this.element(child, column),
          spaceBefore: space || (slot && !glued) || previous?.slot === true,
          blankBefore: blank,
          element: true,
          ...(slot ? { slot: true as const } : {}),
        });
      }
      space = false;
      blank = false;
    }

    // The leading blank line is that of `blankFirst`, not a second one.
    if (atoms[0]) atoms[0].blankBefore = false;
    // Running text: elements are placed in it like words (`<code>`, `<strong>`). Without text: one element per line.
    const prose = atoms.some((a) => a.word);
    const lines: string[] = blankFirst ? [''] : [];
    let current: string | null = null;
    let previous: Atom | null = null;
    const newLine = (atom: Atom) => {
      if (current !== null) lines.push(current);
      if (atom.blankBefore && lines.length > 0) lines.push('');
      current = pad;
    };
    for (const atom of atoms) {
      const [first, ...rest] = atom.lines as [string, ...string[]];
      // A new line: the very start, or whitespace that allows it (element, too long, blank line).
      const breakable = current === null || atom.spaceBefore;
      const tooLong = current !== null && (current as string).length + 1 + first.length > this.width;
      const ownLine = (!prose && (atom.element || previous?.element === true)) || atom.slot === true || previous?.slot === true;
      const wantsLine = current === null || atom.blankBefore || ownLine || rest.length > 0 || (previous?.lines.length ?? 0) > 1 || tooLong;
      if (breakable && wantsLine) newLine(atom);
      else if (atom.spaceBefore) current += ' ';
      current = (current === pad ? pad : (current as string)) + first;
      if (rest.length > 0) {
        lines.push(current as string);
        const last = rest.pop() as string;
        lines.push(...rest.map((l) => (l.startsWith(pad) || l === '' ? l : pad + l)));
        current = last.startsWith(pad) ? last : pad + last;
      }
      previous = atom;
    }
    if (current !== null) lines.push(current);
    return lines;
  }

  statement(node: ChildNode, column: number): string[] {
    const pad = ' '.repeat(column);
    const inner = column + this.unit.length;
    switch (node.kind) {
      case 'declaration':
        return this.expression(node.span, column)
          .split('\n')
          .map((l, i) => (i === 0 ? pad + l : l));
      case 'if': {
        const lines: string[] = [];
        node.branches.forEach((branch, i) => {
          const head = branch.test ? `if (${this.expression(branch.test, column)}) {` : '{';
          if (i === 0) lines.push(pad + head);
          else lines[lines.length - 1] += ` else ${head}`;
          lines.push(...this.children(branch.body, inner), `${pad}}`);
        });
        return lines;
      }
      case 'for': {
        const key = node.key ? `; key ${this.expression(node.key, column)}` : '';
        return [`${pad}for (${this.expression(node.head, column)}${key}) {`, ...this.children(node.body, inner), `${pad}}`];
      }
      case 'switch': {
        const lines = [`${pad}switch (${this.expression(node.discriminant, column)}) {`];
        for (const c of node.cases) {
          const label = c.test ? `case ${this.expression(c.test, inner)}:` : 'default:';
          const body = this.children(c.body, inner + this.unit.length);
          const single = body.length === 1 && ' '.repeat(inner).length + label.length + 1 + (body[0] as string).trim().length <= this.width;
          if (single) lines.push(`${' '.repeat(inner)}${label} ${(body[0] as string).trim()}`);
          else lines.push(' '.repeat(inner) + label, ...body);
        }
        lines.push(`${pad}}`);
        return lines;
      }
      default:
        return [];
    }
  }
}
