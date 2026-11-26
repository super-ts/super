/**
 * TS virtuel d'un fichier `.super` : le TS du fichier recopié tel quel, chaque élément remplacé
 * par des appels typés à plat (voir `check.ts`), et une table de correspondance des positions
 * pour rapporter les erreurs du compilateur dans le `.super`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Attribute,
  type ChildNode,
  type ClassInfo,
  type ElementNode,
  parse,
  type Span,
  type SuperFile,
  type SuperMember,
} from './parser.ts';

/**
 * Une plage du TS virtuel et la plage de la source dont elle vient. `verify: false` : utile à
 * l'éditeur (complétion, survol) mais ses erreurs ne sont pas rapportées (code incomplet).
 */
export type Mapping = { source: Span; generated: Span; verify?: false; complete?: false };

export type VirtualCode = {
  code: string;
  mappings: Mapping[];
  file: SuperFile;
};

/**
 * Les déclarations de `check.ts`, ajoutées à la fin du TS virtuel dans un `declare namespace __s` :
 * le TS virtuel n'importe rien, il se vérifie avec le tsconfig du projet tel quel (CLI comme IDE).
 */
const CHECK_NAMESPACE = `\ndeclare namespace __s {\n${readFileSync(join(import.meta.dirname, 'check.ts'), 'utf8')
  .replace(/^\/\*\*[\s\S]*?\*\/\n/, '')
  .replaceAll('export declare function', 'export function')
  .replaceAll('export declare const', 'export const')}}\n`;

/**
 * `assist` : pour l'éditeur seulement, les instructions incomplètes (`if (this.` en cours de frappe)
 * gardent leur expression, pour la complétion. Ce TS-là peut être invalide : `super-tsc` et les
 * fichiers écrits sur disque s'en passent (une erreur de syntaxe empêcherait `tsc` de vérifier
 * les types de tout le projet).
 */
export function toVirtual(source: string, { assist = false } = {}): VirtualCode {
  const file = parse(source);
  const out = new Writer(source);
  // Une méthode qui émet des éléments renvoie ce qu'elle émet (`Children`) : on l'écrit avant son `}`,
  // pour que `{this.#row(item)}` ou `footer={this.#footer()}` aient le bon type.
  const emitting = file.methods.filter((m) =>
    file.parts.some((p) => p.kind === 'element' && m.start < p.span.start && p.span.end <= m.end),
  );
  const edits: Edit[] = [
    ...emitting.map((m) => ({ start: m.end, end: m.end, write: (w: Writer) => w.raw(' return __s.CHILDREN; ') })),
    ...file.classes.flatMap((info) => classEdits(source, info)),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
  for (const part of file.parts) {
    if (part.kind !== 'code') {
      new ElementWriter(out, assist).element(part);
      continue;
    }
    let at = part.span.start;
    for (const edit of edits.filter((e) => e.start >= part.span.start && e.start < part.span.end)) {
      out.copy({ start: at, end: edit.start });
      edit.write(out);
      at = edit.end;
    }
    out.copy({ start: at, end: part.span.end });
  }
  out.raw(CHECK_NAMESPACE);
  return { code: out.code, mappings: out.mappings, file };
}

/** Un morceau de la source remplacé (ou une insertion, `start === end`) dans le TS virtuel. */
type Edit = Span & { write(out: Writer): void };

const STATIC_TAG = /\bstatic\s+tag\s*=\s*(['"])([^'"]+)\1/;

/**
 * Ce que le TS virtuel écrit pour un composant :
 * - ses types, après `SuperElement` : `SuperElement<{ route: __s.RouteOfTag<'counter-screen'> } &
 *   { props: { id: string }; emits: { … } }>`. Le lien tag → route est généré par le plugin Vite à
 *   partir de `.screens(…)` ; un composant qui n'est pas un écran voit toutes les routes ;
 * - ses déclarations : `@tag` devient `static tag`, `@prop nom: T` une propriété en lecture seule
 *   (`this.nom`), `@title` une affectation à `this.page.title`, `@emit` disparaît (il est dans les types).
 */
function classEdits(source: string, info: ClassInfo): Edit[] {
  if (!info.element) return [];
  const edits: Edit[] = [];
  const tagMember = info.members.find((m): m is Extract<SuperMember, { kind: 'tag' | 'title' }> => m.kind === 'tag');
  const tag = tagMember
    ? /^(['"])([^'"]+)\1$/.exec(source.slice(tagMember.value.start, tagMember.value.end))?.[2]
    : STATIC_TAG.exec(source.slice(info.body.start, info.body.end))?.[2];
  const route = tag ? `{ route: __s.RouteOfTag<'${tag}'> }` : null;
  const props = info.members.filter((m) => m.kind === 'prop');
  const emits = info.members.filter((m) => m.kind === 'emit');
  const { generic, end } = info.element;
  if (generic) {
    if (route) edits.push({ start: generic.start + 1, end: generic.start + 1, write: (out) => out.raw(`${route} & `) });
  } else if (route || props.length > 0 || emits.length > 0) {
    edits.push({
      start: end,
      end,
      write: (out) => {
        out.raw('<');
        if (route) out.raw(route);
        if (props.length > 0 || emits.length > 0) {
          if (route) out.raw(' & ');
          out.raw('{ ');
          if (props.length > 0) {
            out.raw('props: { ');
            for (const p of props) {
              out.copy(p.name);
              out.raw(p.optional || p.init ? '?: ' : ': ');
              out.copy(p.type);
              out.raw('; ');
            }
            out.raw('}; ');
          }
          if (emits.length > 0) {
            out.raw('emits: { ');
            for (const e of emits) {
              out.copy(e.name);
              out.raw(': ');
              out.copy(e.type);
              out.raw('; ');
            }
            out.raw('}; ');
          }
          out.raw('}');
        }
        out.raw('>');
      },
    });
  }
  const named = props;
  for (const m of info.members) {
    edits.push({
      ...m.span,
      write: (out) => {
        switch (m.kind) {
          case 'tag':
            out.raw('static tag = ');
            out.copy(m.value);
            out.raw(';');
            return;
          case 'title':
            out.raw('protected readonly __superTitle = (this.page.title = (');
            out.copy(m.value);
            out.raw('));');
            return;
          case 'prop':
            out.raw(m.init ? 'readonly ' : 'declare readonly ');
            out.copy(m.name);
            out.raw(m.optional ? '?: ' : ': ');
            out.copy(m.type);
            if (m.init) {
              out.raw(' = (');
              out.copy(m.init);
              out.raw(')');
            }
            out.raw(';');
            // Une fois par classe, avec la première prop : les noms ne doivent pas être ceux d'un élément HTML.
            if (m === named[0]) {
              // Dans une méthode (jamais appelée) : un champ ou un bloc statique lirait `__s` avant sa déclaration.
              out.raw(' protected __superNames() { ');
              for (const p of named) {
                out.raw('__s.ownName(');
                out.quoted(p.name);
                out.raw('); ');
              }
              out.raw('}');
            }
            return;
          case 'emit':
            return;
          case 'contract':
            out.raw('readonly ');
            out.copy(m.name);
            out.raw(' = this.contract(');
            if (m.value) out.copy(m.value);
            else out.map(m.name, () => out.raw(`'${source.slice(m.name.start, m.name.end).replace('#', '')}'`));
            out.raw(');');
            return;
          case 'selector':
          case 'state':
          case 'form':
            out.raw('readonly ');
            out.copy(m.name);
            out.raw(` = this.${m.kind}(`);
            out.copy(m.value);
            out.raw(');');
            return;
          case 'ref':
            out.raw('readonly ');
            out.copy(m.name);
            out.raw(' = this.ref<');
            out.copy(m.type);
            out.raw('>();');
            return;
          case 'on': {
            // La méthode devient la fonction passée à `on` : ses paramètres sont typés par l'événement.
            out.raw('protected readonly ');
            out.copy(m.name);
            out.raw(' = ');
            if (source.slice(m.contract.start + 1, m.contract.end - 1) === 'router') out.map(m.contract, () => out.raw('this.router'));
            else {
              out.raw('this.contract(');
              out.copy(m.contract);
              out.raw(')');
            }
            out.raw('.on(');
            out.copy(m.event);
            out.raw(m.async ? ', async ' : ', ');
            out.copy(m.head);
            out.raw(' => ');
            out.copy(m.body);
            out.raw(');');
            return;
          }
        }
      },
    });
  }
  return edits;
}

/**
 * Le contenu d'un composant : ses enfants directs (sans les blancs ni les commentaires), et ses
 * emplacements nommés `<:nom>`.
 */
export function contentOf(source: string, node: ElementNode): { children: ChildNode[]; slots: ElementNode[] } {
  const children: ChildNode[] = [];
  const slots: ElementNode[] = [];
  for (const child of node.children ?? []) {
    if (child.kind === 'element' && child.slot !== undefined) slots.push(child);
    else if (child.kind === 'comment' || (child.kind === 'text' && source.slice(child.span.start, child.span.end).trim() === '')) continue;
    else children.push(child);
  }
  return { children, slots };
}

/** Position dans la source d'une position du TS virtuel (la plage la plus étroite qui la contient). */
export function toSource(virtual: VirtualCode, offset: number): Span | null {
  let best: Mapping | null = null;
  for (const m of virtual.mappings) {
    if (offset < m.generated.start || offset > m.generated.end) continue;
    if (!best || m.generated.end - m.generated.start < best.generated.end - best.generated.start) best = m;
  }
  if (!best) return null;
  const { source, generated } = best;
  // Plages de même longueur : correspondance caractère par caractère.
  if (source.end - source.start === generated.end - generated.start) {
    const at = source.start + (offset - generated.start);
    return { start: at, end: at };
  }
  return source;
}

class Writer {
  code = '';
  mappings: Mapping[] = [];
  readonly src: string;

  constructor(src: string) {
    this.src = src;
  }

  raw(text: string) {
    this.code += text;
  }

  /** Recopie une plage de la source, avec sa correspondance. */
  copy(span: Span, verify = true) {
    this.map(span, () => this.raw(this.src.slice(span.start, span.end)));
    if (!verify) this.mappings[this.mappings.length - 1] = { ...(this.mappings.at(-1) as Mapping), verify: false };
  }

  /** Un nom de balise ou d'attribut : la complétion y vient du service des balises, pas de TS. */
  name(span: Span) {
    this.copy(span);
    this.mappings[this.mappings.length - 1] = { ...(this.mappings.at(-1) as Mapping), complete: false };
  }

  /** `'nom'` : la chaîne entière (guillemets compris) renvoie au nom, pour y rattacher l'erreur. */
  quoted(span: Span) {
    this.map(span, () => {
      this.raw("'");
      this.name(span);
      this.raw("'");
    });
  }

  /** Associe tout ce que `write` écrit à la plage `source`. */
  map(source: Span, write: () => void) {
    const start = this.code.length;
    write();
    this.mappings.push({ source, generated: { start, end: this.code.length } });
  }
}

class ElementWriter {
  #next = 0;
  readonly out: Writer;
  readonly assist: boolean;

  constructor(out: Writer, assist: boolean) {
    this.out = out;
    this.assist = assist;
  }

  element(node: ElementNode) {
    if (node.component) this.out.map(node.span, () => this.component(node));
    else this.intrinsic(node);
  }

  intrinsic(node: ElementNode) {
    const { out } = this;
    // Une variable seulement si un attribut s'en sert (pas de variable inutilisée).
    const el = node.attributes.length > 0 ? `__e${this.#next++}` : null;
    // La balise ouvrante seulement : les enfants ont leurs propres correspondances (une plage qui
    // couvrirait tout l'élément y rattacherait aussi les erreurs du code incomplet d'un enfant).
    out.map(node.openSpan, () => {
      out.raw(el ? `{ const ${el} = __s.open(` : `{ __s.open(`);
      out.quoted(node.nameSpan);
      out.raw('); ');
      if (el) for (const attribute of node.attributes) this.attribute(el, attribute);
    });
    for (const child of node.children ?? []) this.child(child);
    out.raw('}');
  }

  attribute(el: string, attribute: Attribute) {
    const { out } = this;
    if (attribute.kind === 'directive') {
      out.map(attribute.span, () => {
        out.raw(`__s.use(${el}, `);
        out.copy(attribute.expr);
        out.raw('); ');
      });
      return;
    }
    const { name, nameSpan, value } = attribute;
    if (name === 'ref' && value?.kind === 'expr') {
      out.map(attribute.span, () => {
        out.raw(`__s.use(${el}, `);
        out.copy(value.span);
        out.raw('); ');
      });
      return;
    }
    const [fn, bare] = name.startsWith('on:') ? ['on', name.slice(3)] : name.startsWith('prop:') ? ['prop', name.slice(5)] : ['attr', name];
    const bareSpan = { start: nameSpan.end - bare.length, end: nameSpan.end };
    out.map(attribute.span, () => {
      out.raw(`__s.${fn}(${el}, `);
      out.quoted(bareSpan);
      out.raw(', ');
      if (value === null) out.raw('true');
      else out.copy(value.span);
      out.raw('); ');
    });
  }

  component(node: ElementNode) {
    const { out } = this;
    const props = node.attributes.filter((a) => a.kind === 'attr' && !a.name.startsWith('on:'));
    const events = node.attributes.filter((a) => a.kind === 'attr' && a.name.startsWith('on:'));
    const { children, slots } = contentOf(out.src, node);
    out.raw('{ ');
    // Les enfants et les emplacements d'abord, à plat (le rétrécissement des types s'y applique),
    // puis l'appel `create` qui reçoit les props `content` et `nom` de chaque emplacement.
    for (const child of children) this.child(child);
    for (const slot of slots) for (const child of slot.children ?? []) this.child(child);
    out.name(node.nameSpan);
    out.raw('.create(');
    if (props.length > 0 || events.length > 0 || children.length > 0 || slots.length > 0) {
      out.map(node.openSpan, () => {
        out.raw('{ ');
        for (const a of props) this.property(a, a.kind === 'attr' ? a.nameSpan : a.span);
        // Rattachées aux enfants (ou au nom de l'emplacement) : « children n'existe pas dans Props »
        // y est signalé.
        const first = children[0];
        if (first)
          out.map({ start: first.span.start, end: (children.at(-1) as ChildNode).span.end }, () => out.raw('content: __s.CHILDREN, '));
        for (const slot of slots) {
          out.name({ start: slot.nameSpan.start + 1, end: slot.nameSpan.end });
          out.raw(': __s.CHILDREN, ');
        }
        out.raw('}');
      });
    }
    if (events.length > 0) {
      out.raw(', { on: { ');
      for (const a of events) {
        if (a.kind !== 'attr') continue;
        this.property(a, { start: a.nameSpan.start + 3, end: a.nameSpan.end });
      }
      out.raw('} }');
    }
    out.raw('); }');
  }

  /** `nom: valeur, ` dans l'objet des props ou des écouteurs d'un composant. */
  property(attribute: Attribute, keySpan: Span) {
    if (attribute.kind !== 'attr') return;
    const { out } = this;
    // Clé nue si c'est un identifiant : les messages de TS la citent telle quelle.
    const quote = /^[A-Za-z_$][\w$]*$/.test(out.src.slice(keySpan.start, keySpan.end)) ? '' : "'";
    out.map(attribute.span, () => {
      out.raw(quote);
      out.name(keySpan);
      out.raw(`${quote}: `);
      if (attribute.value === null) out.raw('true');
      else out.copy(attribute.value.span);
      out.raw(', ');
    });
  }

  child(node: ChildNode) {
    const { out } = this;
    switch (node.kind) {
      case 'text':
      case 'comment':
        return;
      case 'partial':
        // Pour la complétion seulement : l'instruction incomplète est déjà signalée par le parser.
        if (!this.assist) return;
        out.map(node.span, () => {
          out.raw(`${node.keyword} (`);
          out.copy(node.expr, false);
          out.raw(') {');
          if (node.key) {
            out.raw(' __s.key(');
            out.copy(node.key, false);
            out.raw('); ');
          }
          out.raw('}');
        });
        out.mappings[out.mappings.length - 1] = { ...(out.mappings.at(-1) as Mapping), verify: false };
        out.raw(' ');
        return;
      case 'expr':
        out.map(node.span, () => {
          out.raw('__s.text(');
          out.copy(node.expr);
          out.raw('); ');
        });
        return;
      case 'element':
        // Un emplacement hors d'un composant (déjà signalé) : ses enfants seulement.
        if (node.slot !== undefined) for (const child of node.children ?? []) this.child(child);
        else this.element(node);
        out.raw(' ');
        return;
      case 'declaration':
        out.copy(node.span);
        // `;` ajouté si la source l'a oublié (déclaration en cours de frappe, déjà signalée).
        out.raw(out.src[node.span.end - 1] === ';' ? ' ' : '; ');
        return;
      case 'if':
        node.branches.forEach((branch, index) => {
          if (index > 0) out.raw(' else ');
          if (branch.partial) {
            // Comme une instruction incomplète : pour la complétion seulement.
            if (branch.test && this.assist) {
              out.raw('if (');
              out.copy(branch.test, false);
              out.raw(') ');
            }
            out.raw('{}');
            return;
          }
          if (branch.test) {
            out.raw('if (');
            out.copy(branch.test);
            out.raw(') ');
          }
          this.block(branch.body);
        });
        out.raw(' ');
        return;
      case 'for':
        out.raw('for (');
        out.copy(node.head);
        out.raw(') { ');
        if (node.key) {
          out.raw('__s.key(');
          out.copy(node.key);
          out.raw('); ');
        }
        for (const child of node.body) this.child(child);
        out.raw('} ');
        return;
      case 'switch':
        out.raw('switch (');
        out.copy(node.discriminant);
        out.raw(') { ');
        for (const c of node.cases) {
          if (c.test) {
            out.raw('case ');
            out.copy(c.test);
            out.raw(': ');
          } else out.raw('default: ');
          out.raw('{ ');
          for (const child of c.body) this.child(child);
          out.raw('break; } ');
        }
        out.raw('} ');
        return;
    }
  }

  block(body: ChildNode[]) {
    this.out.raw('{ ');
    for (const child of body) this.child(child);
    this.out.raw('}');
  }
}
