/**
 * Compilation d'un fichier `.super` en TS exécutable : chaque élément devient un gabarit lit
 * (`html\`…\``), le contrôle de flux des enfants devient du vrai contrôle de flux qui pousse des
 * gabarits dans une liste, et chaque méthode qui émet des éléments renvoie cette liste.
 *
 * Le code produit garde les numéros de ligne de la source (un élément remplacé garde ses sauts de
 * ligne) : une erreur à l'exécution pointe la bonne ligne du `.super`, sans table de correspondance.
 */
import { type Attribute, type ChildNode, type Diagnostic, type ElementNode, parse, type Span, type SuperMember } from './parser.ts';
import type { Copied } from './source-map.ts';
import { contentOf } from './virtual.ts';

/** `copied` : les plages du code produit qui recopient la source, pour la source map. */
export type Compiled = { code: string; copied: Copied[]; diagnostics: Diagnostic[] };

// Repères posés devant chaque texte recopié de la source (`\uE000début,longueur\uE001`), retirés
// à la fin en notant où ils étaient : c'est ce qui donne la source map.
const MARK_OPEN = '\uE000';
const MARK_CLOSE = '\uE001';
const MARK = /\uE000(\d+),(\d+)\uE001/g;
const marked = (source: string, start: number, end: number) =>
  `${MARK_OPEN}${start},${end - start}${MARK_CLOSE}${source.slice(start, end)}`;

/** Retire les repères ; renvoie le code et les plages recopiées. */
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

/** Attributs booléens HTML : `disabled={busy}` ajoute ou retire l'attribut. */
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

/** Importés sur la première ligne du module, pour ne décaler aucune ligne. */
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
    // Deux éléments de la méthode séparés seulement par des blancs : une espace entre eux, comme en HTML.
    const spaced = previous !== null && /^\s+$/.test(source.slice(previous.span.end, part.span.start));
    previous = part;
    if (!method) {
      diagnostics.push({
        ...part.openSpan,
        message: 'Un élément s’écrit dans une méthode de classe (`render()` ou une méthode qui émet des éléments)',
      });
      continue;
    }
    emitting.add(method);
    const expression = new TemplateWriter(source).element(part);
    const push = `${spaced ? "__out.push(' '); " : ''}__out.push(${expression});`;
    edits.push({ ...part.span, text: keepLines(push, source.slice(part.span.start, part.span.end)) });
  }
  if (diagnostics.length > 0) return { code: '', copied: [], diagnostics };

  // Les déclarations d'un composant (`@tag`, `@title`, `@prop`, `@emit`) : du code de classe ordinaire.
  for (const info of file.classes) {
    if (!info.element) continue;
    for (const member of info.members) {
      edits.push({ ...member.span, text: keepLines(memberCode(source, member), source.slice(member.span.start, member.span.end)) });
    }
  }

  // Une méthode qui émet des éléments renvoie la liste de ce qu'elle a émis. Le corps est enveloppé
  // dans une fonction fléchée (même `this`) : un `return;` anticipé garde ce qui est déjà émis.
  for (const method of emitting) {
    edits.push({ start: method.start + 1, end: method.start + 1, text: ' const __out: unknown[] = []; (() => {' });
    edits.push({ start: method.end, end: method.end, text: '})(); return __out; ' });
  }

  // Le code hors éléments est recopié tel quel (avec un repère), les éléments sont remplacés.
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
 * Le code d'une déclaration de composant :
 * - `@tag = 'x';` → `static tag = 'x';` ;
 * - `@title = v;` → un champ qui pose `this.page.title` à la construction (repris à chaque montage) ;
 * - `@prop nom: T;` → un accesseur qui lit `this.props.nom` (toujours la valeur courante) ; avec une
 *   valeur par défaut, calculée une fois par instance, dans un champ ;
 * - `@emit` : rien (il n'existe que dans les types) ;
 * - `@contract`, `@selector`, `@state`, `@form`, `@ref` : le champ qu'on écrivait à la main
 *   (`cart = this.contract('cart')`) ;
 * - `@on('profile', 'save:done') onSaved(p) { … }` : `onSaved = this.contract('profile').on('save:done', (p) => { … })`.
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
      // Un champ qui pose l'écouteur à la préparation (repris à chaque montage) ; la méthode devient
      // une fonction fléchée (même `this`), ses lignes restent à leur place.
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

/** Complète `text` de sauts de ligne pour qu'il en ait autant que `original`. */
function keepLines(text: string, original: string): string {
  const missing = original.split('\n').length - text.split('\n').length;
  return missing > 0 ? text + '\n'.repeat(missing) : text;
}

/** Échappe un texte pour l'intérieur d'un gabarit `` `…` ``. */
const escapeTemplate = (text: string) => text.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');

/**
 * Le texte d'un enfant selon les règles du HTML : chaque suite de blancs (retours à la ligne
 * compris) compte pour une espace. Les blancs au début et à la fin d'un élément ou d'un bloc sont
 * retirés à part (voir `TemplateWriter.run`).
 */
export const normalizeText = (raw: string): string => raw.replace(/\s+/g, ' ');

const isStatement = (node: ChildNode) => node.kind === 'if' || node.kind === 'for' || node.kind === 'switch' || node.kind === 'declaration';

class TemplateWriter {
  readonly src: string;

  constructor(src: string) {
    this.src = src;
  }

  /** Une plage de la source recopiée dans le code produit (avec son repère de source map). */
  slice(span: Span) {
    return marked(this.src, span.start, span.end);
  }

  /** Une plage de la source, sans repère (texte, valeurs d'attribut fixes). */
  raw(span: Span) {
    return this.src.slice(span.start, span.end);
  }

  /** L'expression qui rend un élément : un gabarit, ou l'appel `create` d'un composant. */
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
    // Les enfants et les emplacements nommés : des props, rendues ici, dans le rendu du parent (ses
    // écouteurs et ses lectures de store restent les siens), puis placées par le composant.
    const { children, slots } = contentOf(this.src, node);
    if (children.length > 0) props.push(`"content": ${this.block(children)}`);
    for (const slot of slots) props.push(`${JSON.stringify(slot.slot)}: ${this.block(slot.children ?? [])}`);
    const args =
      events.length > 0 ? `{ ${props.join(', ')} }, { on: { ${events.join(', ')} } }` : props.length > 0 ? `{ ${props.join(', ')} }` : '';
    return `${this.slice(node.nameSpan)}.create(${args})`;
  }

  /** Le HTML d'un élément natif, trous `${…}` compris, pour l'intérieur d'un gabarit. */
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
    // `null` ou `undefined` retirent l'attribut.
    return ` ${name}=\${(${expr}) ?? __nothing}`;
  }

  /** Des enfants dans un gabarit : en ligne, ou un trou calculé s'il y a des instructions. */
  children(children: ChildNode[]): string {
    if (children.some(isStatement)) return `\${${this.block(children)}}`;
    return this.run(children);
  }

  /**
   * Des enfants sans instruction, à la suite : les blancs au début et à la fin de la suite (début ou
   * fin d'un élément, d'un bloc, ou voisins d'une instruction) ne rendent rien.
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

  /** Un enfant sans instruction, à l'intérieur d'un gabarit. */
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
        throw new Error(`[super] enfant inattendu en ligne : ${child.kind}`);
    }
  }

  /** Des enfants avec instructions : une fonction qui pousse des gabarits dans une liste. */
  block(children: ChildNode[]): string {
    return `(() => { const __o: unknown[] = []; ${this.statements(children)}return __o; })()`;
  }

  /** Les instructions qui poussent `children` dans `__o`. */
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
        // `for (const x of xs; key x.id)` : `repeat` de lit, pour que le rendu suive les déplacements.
        const match = /^\s*(?:const|let)\s+([\s\S]+?)\s+of\s+([\s\S]+)$/d.exec(this.raw(node.head));
        if (!match?.indices) throw new Error('[super] tête de boucle illisible');
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
        throw new Error(`[super] instruction inattendue : ${node.kind}`);
    }
  }
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const isVoid = (node: ElementNode) => VOID.has(node.name);
