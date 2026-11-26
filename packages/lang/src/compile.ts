/**
 * Compiles a `.super` file to executable TS: each element becomes a lit template
 * (`html\`…\``), the control flow of children becomes real control flow that pushes
 * templates into a list, and each method that emits elements returns that list.
 *
 * The generated code keeps the line numbers of the source (a replaced element keeps its line
 * breaks): a runtime error points to the right line of the `.super` file, without a mapping table.
 */
import { type Attribute, type ChildNode, type Diagnostic, type ElementNode, parse, type Span, type SuperMember } from './parser.ts';
import type { Copied } from './source-map.ts';
import { contentOf } from './virtual.ts';

/** `copied`: the ranges of the generated code that copy the source, for the source map. */
export type Compiled = { code: string; copied: Copied[]; diagnostics: Diagnostic[] };

// Markers placed before each text copied from the source (`\uE000start,length\uE001`), removed
// at the end while noting where they were: that is what gives the source map.
const MARK_OPEN = '\uE000';
const MARK_CLOSE = '\uE001';
const MARK = /\uE000(\d+),(\d+)\uE001/g;
const marked = (source: string, start: number, end: number) =>
  `${MARK_OPEN}${start},${end - start}${MARK_CLOSE}${source.slice(start, end)}`;

/** Removes the markers; returns the code and the copied ranges. */
function unmark(code: string): { code: string; copied: Copied[] } {
  const copied: Copied[] = [];
  let out = '';
  let last = 0;
  for (const match of code.matchAll(MARK)) {
    out += code.slice(last, match.index);
    copied.push({ generated: out.length, source: Number(match[1]), length: Number(match[2]) });
    last = (match.index as number) + match[0].length;
  }
  return { code: out + code.slice(last), copied };
}

/** HTML boolean attributes: `disabled={busy}` adds or removes the attribute. */
const BOOLEAN_ATTRIBUTES = new Set([
  'allowfullscreen',
  'async',
  'autofocus',
  'autoplay',
  'checked',
  'controls',
  'default',
  'defer',
  'disabled',
  'formnovalidate',
  'hidden',
  'inert',
  'ismap',
  'itemscope',
  'loop',
  'multiple',
  'muted',
  'nomodule',
  'novalidate',
  'open',
  'playsinline',
  'readonly',
  'required',
  'reversed',
  'selected',
]);

/** Imported on the first line of the module, so that no line shifts. */
const RUNTIME_IMPORT = "import { html as __html, nothing as __nothing, repeat as __repeat } from '@super-ts/dom';";

export function compile(source: string): Compiled {
  const file = parse(source);
  if (file.diagnostics.length > 0) return { code: '', copied: [], diagnostics: file.diagnostics };
  const diagnostics: Diagnostic[] = [];
  const edits: Array<Span & { text: string }> = [];
  const emitting = new Set<Span>();

  let previous: ElementNode | null = null;
  for (const part of file.parts) {
    if (part.kind === 'code') continue;
    const method = file.methods.filter((m) => m.start < part.span.start && part.span.end <= m.end).sort((a, b) => b.start - a.start)[0];
    // Two elements of the method separated only by whitespace: one space between them, as in HTML.
    const spaced = previous !== null && /^\s+$/.test(source.slice(previous.span.end, part.span.start));
    previous = part;
    if (!method) {
      diagnostics.push({
        ...part.openSpan,
        message: 'An element is written in a class method (`render()` or a method that emits elements)',
      });
      continue;
    }
    emitting.add(method);
    const expression = new TemplateWriter(source).element(part);
    const push = `${spaced ? "__out.push(' '); " : ''}__out.push(${expression});`;
    edits.push({ ...part.span, text: keepLines(push, source.slice(part.span.start, part.span.end)) });
  }
  if (diagnostics.length > 0) return { code: '', copied: [], diagnostics };

  // The declarations of a component (`@tag`, `@title`, `@prop`, `@emit`): ordinary class code.
  for (const info of file.classes) {
    if (!info.element) continue;
    for (const member of info.members) {
      edits.push({ ...member.span, text: keepLines(memberCode(source, member), source.slice(member.span.start, member.span.end)) });
    }
  }

  // A method that emits elements returns the list of what it emitted. The body is wrapped
  // in an arrow function (same `this`): an early `return;` keeps what has already been emitted.
  for (const method of emitting) {
    edits.push({ start: method.start + 1, end: method.start + 1, text: ' const __out: unknown[] = []; (() => {' });
    edits.push({ start: method.end, end: method.end, text: '})(); return __out; ' });
  }

  // The code outside elements is copied verbatim (with a marker), the elements are replaced.
  let code = `${RUNTIME_IMPORT} `;
  let at = 0;
  for (const edit of edits.sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (edit.start > at) code += marked(source, at, edit.start);
    code += edit.text;
    at = Math.max(at, edit.end);
  }
  if (at < source.length) code += marked(source, at, source.length);
  return { ...unmark(code), diagnostics: [] };
}

/**
 * The code of a component declaration:
 * - `@tag = 'x';` → `static tag = 'x';`;
 * - `@title = v;` → a field that sets `this.page.title` at construction (reapplied on each mount);
 * - `@prop name: T;` → a getter that reads `this.props.name` (always the current value); with a
 *   default value, computed once per instance, in a field;
 * - `@emit`: nothing (it only exists in the types);
 * - `@contract`, `@selector`, `@state`, `@form`, `@ref`: the field that used to be written by hand
 *   (`cart = this.contract('cart')`);
 * - `@on('profile', 'save:done') onSaved(p) { … }`: `onSaved = this.contract('profile').on('save:done', (p) => { … })`.
 */
function memberCode(source: string, member: SuperMember): string {
  switch (member.kind) {
    case 'tag':
      return `static tag = ${marked(source, member.value.start, member.value.end)};`;
    case 'title':
      return `__superTitle = (this.page.title = (${marked(source, member.value.start, member.value.end)}));`;
    case 'prop': {
      const name = source.slice(member.name.start, member.name.end);
      if (!member.init) return `get ${name}() { return this.props.${name}; }`;
      const fallback = `__superDefault_${name}`;
      return (
        `${fallback} = (${marked(source, member.init.start, member.init.end)}); ` +
        `get ${name}() { const value = this.props.${name}; return value === undefined ? this.${fallback} : value; }`
      );
    }
    case 'emit':
      return '';
    case 'contract': {
      const name = source.slice(member.name.start, member.name.end);
      const contract = member.value ? marked(source, member.value.start, member.value.end) : `'${name.replace('#', '')}'`;
      return `${name} = this.contract(${contract});`;
    }
    case 'selector':
    case 'state':
    case 'form':
      return `${source.slice(member.name.start, member.name.end)} = this.${member.kind}(${marked(source, member.value.start, member.value.end)});`;
    case 'ref':
      return `${source.slice(member.name.start, member.name.end)} = this.ref();`;
    case 'on': {
      // A field that sets the listener at preparation (reapplied on each mount); the method becomes
      // an arrow function (same `this`), its lines stay in place.
      const contract = source.slice(member.contract.start + 1, member.contract.end - 1);
      const target = contract === 'router' ? 'this.router' : `this.contract(${marked(source, member.contract.start, member.contract.end)})`;
      const breaks = '\n'.repeat(source.slice(member.span.start, member.name.start).split('\n').length - 1);
      return (
        `${source.slice(member.name.start, member.name.end)} = ${target}.on(${marked(source, member.event.start, member.event.end)},${breaks} ` +
        `${member.async ? 'async ' : ''}${marked(source, member.head.start, member.head.end)} => ${marked(source, member.body.start, member.body.end)});`
      );
    }
  }
}

/** Pads `text` with line breaks so that it has as many as `original`. */
function keepLines(text: string, original: string): string {
  const missing = original.split('\n').length - text.split('\n').length;
  return missing > 0 ? text + '\n'.repeat(missing) : text;
}

/** Escapes a text for the inside of a template literal `` `…` ``. */
const escapeTemplate = (text: string) => text.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');

/**
 * The text of a child according to HTML rules: each run of whitespace (line breaks
 * included) counts as one space. Whitespace at the start and end of an element or a block is
 * removed separately (see `TemplateWriter.run`).
 */
export const normalizeText = (raw: string): string => raw.replace(/\s+/g, ' ');

const isStatement = (node: ChildNode) => node.kind === 'if' || node.kind === 'for' || node.kind === 'switch' || node.kind === 'declaration';

class TemplateWriter {
  readonly src: string;

  constructor(src: string) {
    this.src = src;
  }

  /** A range of the source copied into the generated code (with its source map marker). */
  slice(span: Span) {
    return marked(this.src, span.start, span.end);
  }

  /** A range of the source, without a marker (text, fixed attribute values). */
  raw(span: Span) {
    return this.src.slice(span.start, span.end);
  }

  /** The expression that renders an element: a template, or the `create` call of a component. */
  element(node: ElementNode): string {
    return node.component ? this.component(node) : `__html\`${this.markup(node)}\``;
  }

  component(node: ElementNode): string {
    const props: string[] = [];
    const events: string[] = [];
    for (const attribute of node.attributes) {
      if (attribute.kind !== 'attr') continue;
      const value =
        attribute.value === null
          ? 'true'
          : attribute.value.kind === 'string'
            ? this.slice(attribute.value.span)
            : `(${this.slice(attribute.value.span)})`;
      if (attribute.name.startsWith('on:')) events.push(`${JSON.stringify(attribute.name.slice(3))}: ${value}`);
      else props.push(`${JSON.stringify(attribute.name)}: ${value}`);
    }
    // The children and named slots: props, rendered here, in the render of the parent (its
    // listeners and store reads remain its own), then placed by the component.
    const { children, slots } = contentOf(this.src, node);
    if (children.length > 0) props.push(`"content": ${this.block(children)}`);
    for (const slot of slots) props.push(`${JSON.stringify(slot.slot)}: ${this.block(slot.children ?? [])}`);
    const args =
      events.length > 0 ? `{ ${props.join(', ')} }, { on: { ${events.join(', ')} } }` : props.length > 0 ? `{ ${props.join(', ')} }` : '';
    return `${this.slice(node.nameSpan)}.create(${args})`;
  }

  /** The HTML of a native element, `${…}` holes included, for the inside of a template. */
  markup(node: ElementNode): string {
    let out = `<${node.name}`;
    for (const attribute of node.attributes) out += this.attribute(attribute);
    out += '>';
    if (node.children === null) return node.name.includes('-') || !isVoid(node) ? `${out}</${node.name}>` : out;
    out += this.children(node.children);
    return `${out}</${node.name}>`;
  }

  attribute(attribute: Attribute): string {
    if (attribute.kind === 'directive') return ` \${${this.slice(attribute.expr)}}`;
    const { name, value } = attribute;
    if (value === null) return ` ${name}`;
    if (value.kind === 'string') return ` ${name}=${escapeTemplate(this.raw(value.span))}`;
    const expr = this.slice(value.span);
    if (name === 'ref') return ` \${${expr}}`;
    if (name.startsWith('on:')) return ` @${name.slice(3)}=\${${expr}}`;
    if (name.startsWith('prop:')) return ` .${name.slice(5)}=\${${expr}}`;
    if (BOOLEAN_ATTRIBUTES.has(name)) return ` ?${name}=\${${expr}}`;
    // `null` or `undefined` remove the attribute.
    return ` ${name}=\${(${expr}) ?? __nothing}`;
  }

  /** Children in a template: inline, or a computed hole if there are statements. */
  children(children: ChildNode[]): string {
    if (children.some(isStatement)) return `\${${this.block(children)}}`;
    return this.run(children);
  }

  /**
   * Consecutive children without statements: whitespace at the start and end of the run (start or
   * end of an element, of a block, or next to a statement) renders nothing.
   */
  run(children: ChildNode[]): string {
    const nodes = children.filter((child) => child.kind !== 'comment');
    return nodes
      .map((child, index) => {
        if (child.kind !== 'text') return this.inline(child);
        let text = normalizeText(this.raw(child.span));
        if (index === 0) text = text.trimStart();
        if (index === nodes.length - 1) text = text.trimEnd();
        return escapeTemplate(text);
      })
      .join('');
  }

  /** A child without statements, inside a template. */
  inline(child: ChildNode): string {
    switch (child.kind) {
      case 'text':
        return escapeTemplate(normalizeText(this.raw(child.span)));
      case 'expr':
        return `\${${this.slice(child.expr)}}`;
      case 'comment':
        return '';
      case 'element':
        return child.component ? `\${${this.component(child)}}` : this.markup(child);
      default:
        throw new Error(`[super] unexpected inline child: ${child.kind}`);
    }
  }

  /** Children with statements: a function that pushes templates into a list. */
  block(children: ChildNode[]): string {
    return `(() => { const __o: unknown[] = []; ${this.statements(children)}return __o; })()`;
  }

  /** The statements that push `children` into `__o`. */
  statements(children: ChildNode[]): string {
    let out = '';
    let run: ChildNode[] = [];
    const flush = () => {
      const markup = this.run(run);
      if (markup !== '') out += `__o.push(__html\`${markup}\`); `;
      run = [];
    };
    for (const child of children) {
      if (!isStatement(child)) {
        run.push(child);
        continue;
      }
      flush();
      out += this.statement(child);
    }
    flush();
    return out;
  }

  statement(node: ChildNode): string {
    switch (node.kind) {
      case 'declaration': {
        const text = this.slice(node.span);
        return text.endsWith(';') ? `${text} ` : `${text}; `;
      }
      case 'if':
        return `${node.branches
          .map(
            (branch, index) =>
              `${index > 0 ? 'else ' : ''}${branch.test ? `if (${this.slice(branch.test)}) ` : ''}{ ${this.statements(branch.body)}}`,
          )
          .join(' ')} `;
      case 'for': {
        if (!node.key) return `for (${this.slice(node.head)}) { ${this.statements(node.body)}} `;
        // `for (const x of xs; key x.id)`: lit's `repeat`, so that the render follows moves.
        const match = /^\s*(?:const|let)\s+([\s\S]+?)\s+of\s+([\s\S]+)$/d.exec(this.raw(node.head));
        if (!match?.indices) throw new Error('[super] unreadable loop head');
        const at = (group: 1 | 2) => {
          const [start, end] = match.indices?.[group] as [number, number];
          return this.slice({ start: node.head.start + start, end: node.head.start + end });
        };
        const binding = at(1);
        const iterable = at(2);
        const key = this.slice(node.key);
        return `__o.push(__repeat(${iterable}, (${binding}) => ${key}, (${binding}) => { const __o: unknown[] = []; ${this.statements(node.body)}return __o; })); `;
      }
      case 'switch':
        return `switch (${this.slice(node.discriminant)}) { ${node.cases
          .map((c) => `${c.test ? `case ${this.slice(c.test)}` : 'default'}: { ${this.statements(c.body)}break; }`)
          .join(' ')} } `;
      default:
        throw new Error(`[super] unexpected statement: ${node.kind}`);
    }
  }
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const isVoid = (node: ElementNode) => VOID.has(node.name);
