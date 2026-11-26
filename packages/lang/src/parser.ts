/**
 * Parser des fichiers `.super` : repère les éléments écrits comme des instructions dans du TS, et
 * analyse leurs enfants (texte, interpolations, `if` / `for` / `switch`, déclarations).
 *
 * Le TS lui-même n'est pas analysé : un petit lexer saute chaînes, gabarits, commentaires et
 * expressions régulières, et équilibre les parenthèses. Les expressions sont gardées comme des
 * plages de la source, que le générateur recopie telles quelles.
 */

export type Span = { start: number; end: number };

export type Diagnostic = Span & {
  message: string;
  /** Correction proposée : remplacer la plage par `text`. */
  fix?: Span & { text: string; title: string };
};

export type StringValue = { kind: 'string'; span: Span };
export type ExprValue = { kind: 'expr'; span: Span };

export type Attribute =
  | { kind: 'attr'; name: string; nameSpan: Span; value: StringValue | ExprValue | null; span: Span }
  | { kind: 'directive'; expr: Span; span: Span };

export type ElementNode = {
  kind: 'element';
  name: string;
  nameSpan: Span;
  /** Commence par une majuscule : une classe SuperElement. */
  component: boolean;
  /** `<:footer>…</:footer>` : un emplacement nommé, rempli dans un composant (son nom sans `:`). */
  slot?: string;
  attributes: Attribute[];
  /** `null` pour un élément fermé par `/>` (ou un élément vide HTML). */
  children: ChildNode[] | null;
  /** De `<` au `>` de la balise ouvrante. */
  openSpan: Span;
  span: Span;
};

/** `partial` : un `else if (` en cours de frappe, déjà signalé ; sa condition ne sert qu'à la complétion. */
export type IfBranch = { test: Span | null; body: ChildNode[]; span: Span; partial?: true };
export type SwitchCase = { test: Span | null; body: ChildNode[]; span: Span };

export type ChildNode =
  | { kind: 'text'; span: Span }
  | { kind: 'expr'; expr: Span; span: Span }
  | { kind: 'comment'; span: Span }
  | ElementNode
  | { kind: 'if'; branches: IfBranch[]; span: Span }
  | { kind: 'for'; head: Span; key: Span | null; body: ChildNode[]; span: Span }
  | { kind: 'switch'; discriminant: Span; cases: SwitchCase[]; span: Span }
  | { kind: 'declaration'; span: Span }
  /**
   * Un `if (`, `for (` ou `switch (` incomplet (en cours de frappe, ou texte ambigu) : déjà signalé
   * comme erreur, il garde son expression pour que l'éditeur puisse compléter dedans.
   */
  | { kind: 'partial'; keyword: 'if' | 'for' | 'switch'; expr: Span; key: Span | null; span: Span };

/**
 * Une déclaration de composant, dans le corps de sa classe :
 * - `@tag = 'confirm-dialog';` et `@title = 'Confirmation';` (ou une fonction, suivie) ;
 * - `@prop question: string;`, `@prop size?: number;`, `@prop tone: Tone = 'neutral';` ;
 * - `@emit answered: { confirmed: boolean };` ;
 * - `@contract cart;` (ou `@contract basket = 'cart';`), `@selector lines = this.cart.selectors.lines;`,
 *   `@state local = { … };`, `@form edit = { … };`, `@ref input: HTMLInputElement;` ;
 * - `@on('profile', 'save:done') onSaved({ result }) { … }` : un écouteur, sur une méthode.
 * `span` va du `@` au `;` compris (ou à la fin de la ligne sans `;`), ou au `}` de la méthode.
 */
export type SuperMember =
  | { kind: 'tag' | 'title'; span: Span; value: Span }
  | { kind: 'prop'; span: Span; name: Span; optional: boolean; type: Span; init: Span | null }
  | { kind: 'emit'; span: Span; name: Span; type: Span }
  /** `value` : la chaîne du contrat (`'cart'`), `null` pour `@contract cart;` (le nom du champ). */
  | { kind: 'contract'; span: Span; name: Span; value: Span | null }
  | { kind: 'selector' | 'state' | 'form'; span: Span; name: Span; value: Span }
  | { kind: 'ref'; span: Span; name: Span; type: Span }
  /**
   * `contract`, `event` : les chaînes (guillemets compris) ; `head` : des paramètres au type de retour
   * compris ; `body` : du `{` au `}` de la méthode.
   */
  | { kind: 'on'; span: Span; contract: Span; event: Span; async: boolean; name: Span; head: Span; body: Span };

/** Les déclarations qui remplacent une méthode de préparation (`cart = this.contract('cart')`). */
export const PREPARATION_KINDS = ['contract', 'selector', 'state', 'ref', 'form'] as const;

/** Une classe du fichier. */
export type ClassInfo = {
  /** Le nom de la classe (`null` pour une classe anonyme). */
  name: Span | null;
  abstract: boolean;
  /**
   * `extends SuperElement` : `end`, la fin du mot `SuperElement` ; `generic`, le `<…>` écrit à la
   * main. `null` : la classe n'est pas un composant.
   */
  element: { end: number; generic: Span | null } | null;
  /** Du `{` au `}` du corps. */
  body: Span;
  members: SuperMember[];
  /** `static tag` écrit à la main (le `.super` demande `@tag`). */
  staticTag: Span | null;
};

/** Le fichier : des morceaux de TS entre lesquels s'intercalent des éléments. */
export type SuperFile = {
  source: string;
  parts: Array<{ kind: 'code'; span: Span } | ElementNode>;
  /** Corps des méthodes de classe : du `{` au `}` (positions des accolades). */
  methods: Span[];
  classes: ClassInfo[];
  diagnostics: Diagnostic[];
};

const MEMBER_WORDS = new Set(['@tag', '@title', '@prop', '@emit', '@contract', '@selector', '@state', '@ref', '@form', '@on']);

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

// Après ces mots, un `/` ouvre une expression régulière (et non une division).
const REGEX_AFTER_WORD = new Set([
  'return',
  'typeof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'yield',
  'await',
  'instanceof',
]);

/** Devant ces mots, `( … ) {` ouvre un bloc, pas le corps d'une fonction. */
const CONTROL_WORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);

const isIdentStart = (c: string | undefined) => c !== undefined && /[A-Za-z_$]/.test(c);
const isIdentPart = (c: string | undefined) => c !== undefined && /[\w$]/.test(c);
const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);

/** Levée pour abandonner une tentative (texte pris pour une instruction, par exemple). */
class ParseFailure extends Error {
  /** Levée dans le corps d'une instruction déjà reconnue : ce n'est plus une ambiguïté de texte. */
  committed = false;

  readonly at: number;

  constructor(at: number, message: string) {
    super(message);
    this.at = at;
  }
}

export function parse(source: string): SuperFile {
  return new Parser(source).file();
}

class Parser {
  diagnostics: Diagnostic[] = [];
  readonly src: string;
  /** Posé par `scanTo(…, newlineEnds)` quand l'instruction s'arrête en fin de ligne, sans `;`. */
  endedAtNewline = false;

  constructor(src: string) {
    this.src = src;
  }

  // Lexer TS minimal ------------------------------------------------------------------------

  /** Saute une chaîne `'…'` ou `"…"` qui commence en `i`. Une chaîne ne passe pas la ligne. */
  skipString(i: number): number {
    const quote = this.src[i];
    for (let j = i + 1; j < this.src.length; j++) {
      const c = this.src[j];
      if (c === '\\') j++;
      else if (c === quote) return j + 1;
      else if (c === '\n') throw new ParseFailure(i, 'Chaîne non terminée');
    }
    throw new ParseFailure(i, 'Chaîne non terminée');
  }

  /** Saute un gabarit `` `…${…}…` `` qui commence en `i`. */
  skipTemplate(i: number): number {
    for (let j = i + 1; j < this.src.length; j++) {
      const c = this.src[j];
      if (c === '\\') j++;
      else if (c === '`') return j + 1;
      else if (c === '$' && this.src[j + 1] === '{') j = this.scanTo(j + 2, '}');
    }
    throw new ParseFailure(i, 'Gabarit non terminé');
  }

  skipRegex(i: number): number {
    let inClass = false;
    for (let j = i + 1; j < this.src.length; j++) {
      const c = this.src[j];
      if (c === '\\') j++;
      else if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) {
        j++;
        while (isIdentPart(this.src[j])) j++;
        return j;
      } else if (c === '\n') break;
    }
    throw new ParseFailure(i, 'Expression régulière non terminée');
  }

  /** Saute espaces et commentaires TS. */
  skipTrivia(i: number): number {
    while (i < this.src.length) {
      const c = this.src[i];
      if (isSpace(c)) i++;
      else if (c === '/' && this.src[i + 1] === '/') {
        const end = this.src.indexOf('\n', i);
        i = end === -1 ? this.src.length : end + 1;
      } else if (c === '/' && this.src[i + 1] === '*') {
        const end = this.src.indexOf('*/', i + 2);
        if (end === -1) throw new ParseFailure(i, 'Commentaire non terminé');
        i = end + 2;
      } else break;
    }
    return i;
  }

  /**
   * Parcourt une expression TS à partir de `i` jusqu'au premier `closer` hors de toute
   * parenthèse, crochet ou accolade ; renvoie sa position. Lève si un crochet ne correspond pas.
   */
  scanTo(i: number, closer: string, newlineEnds = false): number {
    const stack: string[] = [];
    let previous = '('; // Début d'expression : un `/` y ouvre une expression régulière.
    while (i < this.src.length) {
      const before = i;
      i = this.skipTrivia(i);
      // Fin de ligne hors de toute parenthèse, sans opérateur de part et d'autre : fin de l'instruction.
      if (newlineEnds && stack.length === 0 && this.src.slice(before, i).includes('\n') && previous !== '(') {
        const continues = /[.?+\-*/%&|^=,:]/.test(this.src[i] ?? '') || /[=+\-*/%&|^,.?:]/.test(previous);
        if (!continues) {
          this.endedAtNewline = true;
          return before;
        }
      }
      const c = this.src[i];
      if (c === undefined) break;
      if (stack.length === 0 && c === closer) return i;
      if (c === '"' || c === "'") {
        i = this.skipString(i);
        previous = 'a';
      } else if (c === '`') {
        i = this.skipTemplate(i);
        previous = 'a';
      } else if (c === '/') {
        if (previous === 'word-regex' || !/[\w$)\]]/.test(previous)) {
          i = this.skipRegex(i);
          previous = 'a';
        } else {
          i++;
          previous = '/';
        }
      } else if (isIdentPart(c) || c === '#' || c === '@') {
        const start = i;
        i++;
        while (isIdentPart(this.src[i])) i++;
        previous = REGEX_AFTER_WORD.has(this.src.slice(start, i)) ? 'word-regex' : 'a';
      } else if (c === '(' || c === '[' || c === '{') {
        stack.push(c === '(' ? ')' : c === '[' ? ']' : '}');
        previous = c;
        i++;
      } else if (c === ')' || c === ']' || c === '}') {
        if (stack.pop() !== c) throw new ParseFailure(i, `\`${c}\` inattendu`);
        previous = c;
        i++;
      } else {
        previous = c;
        i++;
      }
    }
    throw new ParseFailure(i, `\`${closer}\` manquant`);
  }

  // Fichier : TS avec des éléments en position d'instruction --------------------------------

  file(): SuperFile {
    const parts: SuperFile['parts'] = [];
    let codeStart = 0;
    let i = 0;
    let previous = ';'; // Dernier jeton significatif.
    let inCase = false; // Un `case` ou `default` est ouvert : son `:` précède une instruction.
    // Accolades ouvertes : corps de classe, corps de méthode, ou autre bloc.
    // `function` : le corps d'une fonction imbriquée (fléchée, `function`, méthode d'objet), où un
    // `return x;` ne concerne pas la méthode qui émet des éléments.
    const braces: Array<{ kind: 'class' | 'method' | 'function' | 'block'; start: number; info?: ClassInfo }> = [];
    const classes: ClassInfo[] = [];
    let classWord = 0; // Position du dernier mot `class`.
    const parens: string[] = []; // Le mot devant chaque `(` ouverte (`if`, `foo`…).
    let lastWord = '';
    let parenOwner = ''; // Le mot devant la dernière `(` fermée.
    let beforePrevious = ''; // Le jeton avant `previous` (pour reconnaître `=>`).
    let methodHeader = false; // `nom(…)` vient de se fermer dans un corps de classe (type de retour possible).
    const valueReturns: Array<{ at: number; method: number }> = []; // `return x;` au niveau d'une méthode.
    const methods: Span[] = [];
    let sawClass = false; // Le mot `class` attend son corps.
    let classDepth = 0; // Profondeur d'accolades où `class` a été vu (un `;` d'un type `<{ a; b }>` ne compte pas).
    try {
      while (i < this.src.length) {
        i = this.skipTrivia(i);
        const c = this.src[i];
        if (c === undefined) break;
        // Un `<` suivi d'une lettre en début de ligne ouvre toujours un élément : pendant la frappe
        // (`const user = this.` puis `<section>` à la ligne), le template reste lisible.
        const lineStart = /(^|\n)[ \t]*$/.test(this.src.slice(Math.max(0, i - 200), i));
        if (
          c === '<' &&
          isIdentStart(this.src[i + 1]) &&
          (lineStart || previous === '{' || previous === '}' || previous === ';' || (previous === ':' && inCase))
        ) {
          if (i > codeStart) parts.push({ kind: 'code', span: { start: codeStart, end: i } });
          const element = this.element(i);
          parts.push(element);
          i = codeStart = element.span.end;
          previous = '}';
          inCase = false;
          continue;
        }
        if (c === '"' || c === "'") {
          i = this.skipString(i);
          previous = 'a';
        } else if (c === '`') {
          i = this.skipTemplate(i);
          previous = 'a';
        } else if (c === '/' && (previous === 'word-regex' || !/[\w$)\]]/.test(previous))) {
          i = this.skipRegex(i);
          previous = 'a';
        } else if (isIdentPart(c) || c === '#' || c === '@') {
          const start = i;
          i++;
          while (isIdentPart(this.src[i])) i++;
          const word = this.src.slice(start, i);
          const top = braces[braces.length - 1];
          // Une déclaration de composant (`@prop nom: Type;`) au niveau du corps de la classe.
          if (MEMBER_WORDS.has(word) && top?.kind === 'class' && (lineStart || previous === '{' || previous === '}' || previous === ';')) {
            i = this.member(start, word, top.info!);
            previous = ';';
            beforePrevious = ';';
            methodHeader = false;
            continue;
          }
          // L'ancienne forme (`cart = this.contract('cart')`) : refusée dans un composant, avec sa réécriture.
          if (top?.kind === 'class' && top.info?.element && (lineStart || previous === '{' || previous === '}' || previous === ';')) {
            this.oldPreparation(start);
          }
          if (word === 'static' && top?.kind === 'class') {
            const tag = /^\s+tag\b(?=\s*=)/.exec(this.src.slice(i, i + 40));
            if (tag) top.info!.staticTag = { start, end: i + tag[0].length };
          }
          if (word === 'case' || word === 'default') inCase = true;
          if (word === 'return') {
            const owner = [...braces].reverse().find((b) => b.kind === 'method' || b.kind === 'function');
            let j = i;
            while (this.src[j] === ' ' || this.src[j] === '\t') j++;
            if (owner?.kind === 'method' && !/^[;}\r\n]?$/.test(this.src[j] ?? '')) valueReturns.push({ at: start, method: owner.start });
          }
          lastWord = word;
          beforePrevious = previous;
          if (word === 'class') {
            classWord = start;
            sawClass = true;
            classDepth = braces.length;
          }
          previous = REGEX_AFTER_WORD.has(word) ? 'word-regex' : 'a';
        } else {
          if (c === '{' || c === '}' || c === ';') inCase = false;
          if (c === '(') parens.push(previous === 'a' ? lastWord : '');
          else if (c === ')') {
            parenOwner = parens.pop() ?? '';
            if (parens.length === 0 && braces[braces.length - 1]?.kind === 'class') methodHeader = true;
          } else if ((c === ';' || c === '=') && braces[braces.length - 1]?.kind === 'class') methodHeader = false;
          if (c === '{') {
            // `class A extends B<{ … }> {` : seul le `{` qui suit un nom, `>` ou `)` ouvre le corps.
            const parent = braces[braces.length - 1]?.kind;
            const nested = (previous === ')' && !CONTROL_WORDS.has(parenOwner)) || (previous === '>' && beforePrevious === '=');
            // Corps de méthode : `nom(…) {`, ou `nom(…): Type {` (type de retour).
            const kind =
              sawClass && /[a>)\]]/.test(previous)
                ? 'class'
                : parent === 'class' && (previous === ')' || methodHeader)
                  ? 'method'
                  : nested
                    ? 'function'
                    : 'block';
            methodHeader = false;
            if (kind === 'class') {
              sawClass = false;
              const info = this.classInfo(classWord, i);
              classes.push(info);
              braces.push({ kind, start: i, info });
            } else braces.push({ kind, start: i });
          } else if (c === '}') {
            const open = braces.pop();
            if (open?.kind === 'method') methods.push({ start: open.start, end: i });
            if (open?.info) open.info.body.end = i;
          } else if (c === ';' && braces.length === classDepth) sawClass = false;
          beforePrevious = previous;
          previous = c;
          i++;
        }
      }
    } catch (error) {
      if (!(error instanceof ParseFailure)) throw error;
      this.error(error.at, error.at + 1, error.message);
      return { source: this.src, parts, methods, classes, diagnostics: this.diagnostics };
    }
    if (codeStart < this.src.length) parts.push({ kind: 'code', span: { start: codeStart, end: this.src.length } });
    // Une méthode qui émet des éléments renvoie ce qu'elle émet : un `return x;` y serait ignoré.
    for (const r of valueReturns) {
      const method = methods.find((m) => m.start === r.method);
      const emits = method && parts.some((p) => p.kind === 'element' && method.start < p.span.start && p.span.end <= method.end);
      if (emits)
        this.error(r.at, r.at + 6, 'Une méthode qui émet des éléments renvoie ce qu’elle émet : ici, `return` s’écrit sans valeur');
    }
    this.checkClasses(classes);
    this.checkConstructors(classes, methods);
    return { source: this.src, parts, methods, classes, diagnostics: this.diagnostics };
  }

  // Classes et déclarations de composant ------------------------------------------------------

  /** La classe dont le mot `class` est en `start` et le corps s'ouvre en `open`. */
  classInfo(start: number, open: number): ClassInfo {
    const header = this.src.slice(start, open);
    const name = /^class\s+([A-Za-z_$][\w$]*)/d.exec(header);
    const element = /\bextends\s+SuperElement\b(\s*<)?/d.exec(header);
    const elementEnd = element ? start + element.indices![0]![1] - (element[1]?.length ?? 0) : 0;
    let generic: Span | null = null;
    if (element?.[1]) {
      const from = start + element.indices![1]![1] - 1;
      generic = { start: from, end: start + header.trimEnd().length };
    }
    return {
      name: name ? { start: start + name.indices![1]![0], end: start + name.indices![1]![1] } : null,
      abstract: /\babstract\s+$/.test(this.src.slice(Math.max(0, start - 30), start)),
      element: element ? { end: elementEnd, generic } : null,
      body: { start: open, end: open },
      members: [],
      staticTag: null,
    };
  }

  /** Lit une déclaration (`@tag`, `@prop`, `@contract`, `@on`…) ; renvoie la position qui la suit. */
  member(start: number, word: string, info: ClassInfo): number {
    const kind = word.slice(1) as SuperMember['kind'];
    try {
      if (kind === 'on') return this.listener(start, info);
      let i = this.skipTrivia(start + word.length);
      if (kind === 'contract' || kind === 'selector' || kind === 'state' || kind === 'form' || kind === 'ref') {
        const name = this.memberName(i, kind);
        i = this.skipTrivia(name.end);
        if (kind === 'ref') {
          if (this.src[i] !== ':')
            throw new ParseFailure(i, 'Une référence déclare le type de son élément : `@ref input: HTMLInputElement;`');
          const typeStart = this.skipTrivia(i + 1);
          const end = this.scanTo(typeStart, ';', true);
          if (this.assignment(typeStart, end) !== null)
            throw new ParseFailure(typeStart, 'Une référence n’a pas de valeur : `@ref input: HTMLInputElement;`');
          const type = { start: typeStart, end: this.trimBack(end) };
          if (type.end <= type.start) throw new ParseFailure(typeStart, 'Type manquant');
          const after = this.src[end] === ';' ? end + 1 : end;
          info.members.push({ kind, span: { start, end: after }, name, type });
          return after;
        }
        if (this.src[i] === ':') {
          throw new ParseFailure(i, `Pas de type sur \`@${kind}\` : il vient ${kind === 'contract' ? 'du contrat' : 'de la valeur'}`);
        }
        if (kind === 'contract' && this.src[i] !== '=') {
          // `@contract cart;` : le contrat porte le nom du champ.
          let after = name.end;
          while (this.src[after] === ' ' || this.src[after] === '\t') after++;
          if (this.src[after] === ';') after++;
          else after = name.end;
          info.members.push({ kind, span: { start, end: after }, name, value: null });
          return after;
        }
        if (this.src[i] !== '=' || /[=>]/.test(this.src[i + 1] ?? ''))
          throw new ParseFailure(i, `\`@${kind}\` s’écrit \`@${kind} nom = …;\``);
        const valueStart = this.skipTrivia(i + 1);
        const end = this.scanTo(valueStart, ';', true);
        const value = { start: valueStart, end: this.trimBack(end) };
        if (value.end <= value.start)
          throw new ParseFailure(i, `Valeur manquante après \`@${kind} ${this.src.slice(name.start, name.end)} =\``);
        const after = this.src[end] === ';' ? end + 1 : end;
        info.members.push({ kind, span: { start, end: after }, name, value });
        return after;
      }
      if (kind === 'tag' || kind === 'title') {
        if (this.src[i] !== '=' || /[=>]/.test(this.src[i + 1] ?? '')) {
          throw new ParseFailure(start, `\`@${kind}\` s’écrit \`@${kind} = …;\``);
        }
        const valueStart = this.skipTrivia(i + 1);
        const end = this.scanTo(valueStart, ';', true);
        const value = { start: valueStart, end: this.trimBack(end) };
        if (value.end <= value.start) throw new ParseFailure(i, `Valeur manquante après \`@${kind} =\``);
        const after = this.src[end] === ';' ? end + 1 : end;
        info.members.push({ kind, span: { start, end: after }, value });
        return after;
      }
      if (!isIdentStart(this.src[i])) throw new ParseFailure(i, `Nom attendu après \`@${kind}\` : \`@${kind} nom: Type;\``);
      const nameStart = i;
      while (isIdentPart(this.src[i])) i++;
      const name = { start: nameStart, end: i };
      i = this.skipTrivia(i);
      let optional = false;
      if (this.src[i] === '?' && kind === 'prop') {
        optional = true;
        i = this.skipTrivia(i + 1);
      }
      if (this.src[i] !== ':') {
        throw new ParseFailure(
          i,
          kind === 'prop'
            ? 'Une prop déclare son type : `@prop nom: Type;`'
            : 'Un événement déclare ce qu’il transporte : `@emit nom: Type;` (`void` s’il ne transporte rien)',
        );
      }
      const typeStart = this.skipTrivia(i + 1);
      const end = this.scanTo(typeStart, ';', true);
      const assign = this.assignment(typeStart, end);
      const type = { start: typeStart, end: this.trimBack(assign ?? end) };
      if (type.end <= type.start) throw new ParseFailure(typeStart, 'Type manquant');
      const after = this.src[end] === ';' ? end + 1 : end;
      const span = { start, end: after };
      if (kind === 'emit') {
        if (assign !== null) throw new ParseFailure(assign, 'Un événement n’a pas de valeur par défaut');
        info.members.push({ kind, span, name, type });
        return after;
      }
      let init: Span | null = null;
      if (assign !== null) {
        if (optional) throw new ParseFailure(assign, 'Une prop qui a une valeur par défaut est déjà facultative : retire le `?`');
        init = { start: this.skipTrivia(assign + 1), end: this.trimBack(end) };
        if (init.end <= init.start) throw new ParseFailure(assign, 'Valeur par défaut manquante après `=`');
      }
      info.members.push({ kind, span, name, optional, type, init });
      return after;
    } catch (error) {
      if (!(error instanceof ParseFailure)) throw error;
      this.error(error.at, error.at + 1, error.message);
      const next = this.src.indexOf('\n', start);
      return next === -1 ? this.src.length : next;
    }
  }

  /** Le nom d'une déclaration (`cart`, ou `#cart` pour un champ privé). */
  memberName(i: number, kind: string): Span {
    const start = i;
    if (this.src[i] === '#') i++;
    if (!isIdentStart(this.src[i])) throw new ParseFailure(i, `Nom attendu après \`@${kind}\``);
    while (isIdentPart(this.src[i])) i++;
    return { start, end: i };
  }

  /** `@on('profile', 'save:done') onSaved({ result }) { … }` : la décoration et sa méthode. */
  listener(start: number, info: ClassInfo): number {
    const usage = "`@on` s’écrit `@on('contrat', 'événement')`, au-dessus d’une méthode";
    let i = this.skipTrivia(start + 3);
    if (this.src[i] !== '(') throw new ParseFailure(start, usage);
    const close = this.scanTo(i + 1, ')');
    const args = /^\s*((['"])[^'"\n]*\2)\s*,\s*((['"])[^'"\n]*\4)\s*,?\s*$/d.exec(this.src.slice(i + 1, close));
    if (!args?.indices) throw new ParseFailure(i, usage);
    const at = (group: 1 | 3) => ({ start: i + 1 + args.indices![group]![0], end: i + 1 + args.indices![group]![1] });
    const contract = at(1);
    const event = at(3);
    i = this.skipTrivia(close + 1);
    let isAsync = false;
    if (this.src.startsWith('async', i) && !isIdentPart(this.src[i + 5])) {
      isAsync = true;
      i = this.skipTrivia(i + 5);
    }
    const name = this.memberName(i, 'on');
    const headStart = this.skipTrivia(name.end);
    if (this.src[headStart] !== '(') throw new ParseFailure(headStart, `${usage} : \`onSaved(payload) { … }\``);
    const paramsEnd = this.scanTo(headStart + 1, ')');
    let open = this.skipTrivia(paramsEnd + 1);
    if (this.src[open] === ':') open = this.scanTo(open + 1, '{');
    if (this.src[open] !== '{') throw new ParseFailure(open, `${usage} : \`onSaved(payload) { … }\``);
    const close2 = this.scanTo(open + 1, '}');
    const end = close2 + 1;
    info.members.push({
      kind: 'on',
      span: { start, end },
      contract,
      event,
      async: isAsync,
      name,
      head: { start: headStart, end: this.trimBack(open) },
      body: { start: open, end },
    });
    return end;
  }

  /**
   * Un champ de composant écrit à l'ancienne (`cart = this.contract('cart');`) : une erreur, avec sa
   * réécriture en déclaration (`@contract cart;`).
   */
  oldPreparation(start: number) {
    const match = /^(#?[A-Za-z_$][\w$]*)\s*=\s*this\.(contract|selector|state|ref|form)\s*(?:<([^<>()]*)>)?\s*\(/.exec(
      this.src.slice(start, start + 300),
    );
    if (!match) return;
    const [whole, name, method, typeArg] = match as unknown as [string, string, string, string | undefined];
    let argsEnd: number;
    try {
      argsEnd = this.scanTo(start + whole.length, ')');
    } catch {
      return; // la suite est déjà incomplète : le reste de l'analyse le signalera
    }
    const args = this.src.slice(start + whole.length, argsEnd).trim();
    let end = argsEnd + 1;
    while (this.src[end] === ' ' || this.src[end] === '\t') end++;
    const rewritable = this.src[end] === ';' || this.src[end] === '\n' || this.src[end] === '\r' || this.src[end] === undefined;
    if (this.src[end] === ';') end++;
    else end = argsEnd + 1;
    let text: string | null = null;
    if (rewritable) {
      if (method === 'contract') {
        const literal = /^(['"])([^'"]+)\1$/.exec(args);
        text = literal ? (literal[2] === name ? `@contract ${name};` : `@contract ${name} = ${args};`) : null;
      } else if (method === 'ref') text = `@ref ${name}: ${typeArg?.trim() || 'Element'};`;
      else if (args !== '') text = `@${method} ${name} = ${args};`;
    }
    const message = `Dans un \`.super\`, \`this.${method}(…)\` se déclare par \`@${method}\` : \`@${method} ${name}${method === 'ref' ? ': Type' : method === 'contract' ? '' : ' = …'};\``;
    this.error(start, end, message, text ? { start, end, text, title: `Écrire \`@${method}\`` } : undefined);
  }

  /** Recule devant les blancs qui précèdent `end`. */
  trimBack(end: number): number {
    while (end > 0 && isSpace(this.src[end - 1])) end--;
    return end;
  }

  /** Le `=` d'une valeur par défaut entre `start` et `end` (hors parenthèses, `=>`, `==`…), ou `null`. */
  assignment(start: number, end: number): number | null {
    let depth = 0;
    for (let j = start; j < end; j++) {
      const c = this.src[j];
      if (c === '"' || c === "'") j = this.skipString(j) - 1;
      else if (c === '`') j = this.skipTemplate(j) - 1;
      else if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === '=' && depth === 0 && !/[=>]/.test(this.src[j + 1] ?? '') && !/[=!<>]/.test(this.src[j - 1] ?? '')) return j;
    }
    return null;
  }

  /** Un écouteur posé dans le constructeur d'un composant (`this.cart.on(…)`) : il se déclare par `@on`. */
  checkConstructors(classes: ClassInfo[], methods: Span[]) {
    for (const method of methods) {
      const owner = classes
        .filter((c) => c.body.start < method.start && method.end <= c.body.end)
        .sort((a, b) => b.body.start - a.body.start)[0];
      if (!owner?.element) continue;
      if (!/\bconstructor\s*\([^)]*\)\s*$/.test(this.src.slice(Math.max(owner.body.start, method.start - 200), method.start))) continue;
      for (const call of this.src.slice(method.start, method.end).matchAll(/\bthis\.(#?[\w$]+)\.on\s*\(/g)) {
        const at = method.start + (call.index as number);
        this.error(
          at,
          at + call[0].length,
          `Dans un \`.super\`, un écouteur se déclare sur une méthode : \`@on('${call[1]!.replace('#', '')}', 'événement') onEvent(payload) { … }\``,
        );
      }
    }
  }

  /** Les règles des composants d'un `.super` : un tag, déclaré par `@tag`, et pas de générique. */
  checkClasses(classes: ClassInfo[]) {
    for (const info of classes) {
      const at = (m: SuperMember) => [m.span.start, m.span.start + m.kind.length + 1] as const;
      if (!info.element) {
        for (const m of info.members) this.error(...at(m), `\`@${m.kind}\` ne s’écrit que dans un composant (\`extends SuperElement\`)`);
        continue;
      }
      if (info.element.generic) {
        this.error(
          info.element.generic.start,
          info.element.generic.end,
          'Dans un `.super`, les props et les événements se déclarent dans la classe : `@prop nom: Type;` et `@emit nom: Type;`',
        );
      }
      const tags = info.members.filter((m): m is Extract<SuperMember, { kind: 'tag' | 'title' }> => m.kind === 'tag');
      if (info.staticTag) {
        this.error(info.staticTag.start, info.staticTag.end, "Dans un `.super`, le tag se déclare par `@tag = '…';`", {
          ...info.staticTag,
          text: '@tag',
          title: 'Écrire `@tag`',
        });
      } else if (tags.length === 0 && !info.abstract) {
        const where = info.name ?? { start: info.body.start, end: info.body.start + 1 };
        this.error(where.start, where.end, "Un composant déclare son tag : `@tag = 'mon-composant';`");
      }
      for (const tag of tags) {
        if (!/^(['"])[a-z][\w.-]*-[\w.-]*\1$/.test(this.src.slice(tag.value.start, tag.value.end))) {
          this.error(
            tag.value.start,
            tag.value.end,
            "Le tag est une chaîne écrite telle quelle, en minuscules, avec un tiret : `@tag = 'mon-composant';`",
          );
        }
      }
      for (const kind of ['tag', 'title'] as const) {
        for (const extra of info.members.filter((m) => m.kind === kind).slice(1))
          this.error(...at(extra), `\`@${kind}\` déclaré deux fois`);
      }
      // Un contrat ne se déclare qu'une fois, et jamais le router (`this.router`).
      const contracts = new Map<string, string>();
      for (const m of info.members) {
        if (m.kind !== 'contract') continue;
        const field = this.src.slice(m.name.start, m.name.end);
        const literal = m.value ? /^(['"])([^'"]+)\1$/.exec(this.src.slice(m.value.start, m.value.end))?.[2] : field;
        const where = m.value ?? m.name;
        if (literal === undefined) {
          this.error(where.start, where.end, "Le contrat est une chaîne écrite telle quelle : `@contract basket = 'cart';`");
          continue;
        }
        if (literal === 'router') {
          this.error(where.start, where.end, 'Le router se lit par `this.router`, sans `@contract`');
          continue;
        }
        const first = contracts.get(literal);
        if (first !== undefined)
          this.error(where.start, where.end, `Le contrat \`${literal}\` est déjà déclaré par \`@contract ${first}\``);
        else contracts.set(literal, field);
      }
      for (const kind of ['prop', 'emit'] as const) {
        const seen = new Set<string>();
        for (const m of info.members) {
          if (m.kind !== kind) continue;
          const name = this.src.slice(m.name.start, m.name.end);
          if (seen.has(name)) this.error(m.name.start, m.name.end, `\`@${kind} ${name}\` déclaré deux fois`);
          seen.add(name);
        }
      }
    }
  }

  error(start: number, end: number, message: string, fix?: Diagnostic['fix']) {
    this.diagnostics.push(fix ? { start, end, message, fix } : { start, end, message });
  }

  // Éléments --------------------------------------------------------------------------------

  /** Un élément qui commence en `start` (sur le `<`). */
  element(start: number): ElementNode {
    let i = start + 1;
    const nameStart = i;
    while (/[\w$.:-]/.test(this.src[i] ?? '')) i++;
    const name = this.src.slice(nameStart, i);
    const nameSpan = { start: nameStart, end: i };
    const component = /^[A-Z]/.test(name);
    const slot = name.startsWith(':') ? name.slice(1) : undefined;
    const attributes: Attribute[] = [];

    for (;;) {
      i = this.skipTrivia(i);
      const c = this.src[i];
      if (c === undefined) throw new ParseFailure(start, `Balise <${name}> non fermée`);
      if (c === '/' && this.src[i + 1] === '>') {
        const end = i + 2;
        return { kind: 'element', name, nameSpan, component, attributes, children: null, openSpan: { start, end }, span: { start, end } };
      }
      if (c === '>') {
        i++;
        break;
      }
      if (c === '{') {
        const close = this.scanTo(i + 1, '}');
        if (component) this.error(i, close + 1, `Un composant ne prend pas encore de directive : {…} se place sur un élément HTML`);
        attributes.push({ kind: 'directive', expr: { start: i + 1, end: close }, span: { start: i, end: close + 1 } });
        i = close + 1;
        continue;
      }
      i = this.attribute(i, attributes);
    }

    const openSpan = { start, end: i };
    if (!component && VOID_ELEMENTS.has(name)) {
      return { kind: 'element', name, nameSpan, component, attributes, children: null, openSpan, span: openSpan };
    }
    const children = this.children(i, { kind: 'element', name });
    this.checkSlots(name, component, slot, attributes, nameSpan, children.nodes);
    return {
      kind: 'element',
      name,
      nameSpan,
      component,
      ...(slot !== undefined ? { slot } : {}),
      attributes,
      children: children.nodes,
      openSpan,
      span: { start, end: children.end },
    };
  }

  /**
   * Un emplacement `<:nom>` se place directement dans un composant, sans attribut, et une seule
   * fois par nom ; `<:content>` n'existe pas (les enfants directs remplissent `content`).
   */
  checkSlots(name: string, component: boolean, slot: string | undefined, attributes: Attribute[], nameSpan: Span, children: ChildNode[]) {
    if (slot !== undefined) {
      if (!/^[A-Za-z_$][\w$]*$/.test(slot)) this.error(nameSpan.start, nameSpan.end, `Nom d’emplacement invalide : <${name}>`);
      if (slot === 'content')
        this.error(
          nameSpan.start,
          nameSpan.end,
          'Pas de <:content> : les enfants écrits directement dans le composant remplissent déjà `content`',
        );
      const first = attributes[0];
      if (first)
        this.error(first.span.start, (attributes.at(-1) as Attribute).span.end, `Un emplacement <${name}> ne prend pas d’attribut`);
    }
    const seen = new Set<string>();
    for (const child of children) {
      if (child.kind !== 'element' || child.slot === undefined) continue;
      if (!component)
        this.error(
          child.nameSpan.start,
          child.nameSpan.end,
          `L’emplacement <${child.name}> se place directement dans un composant, pas dans <${name}>`,
        );
      else if (seen.has(child.slot)) this.error(child.nameSpan.start, child.nameSpan.end, `L’emplacement <${child.name}> est déjà rempli`);
      seen.add(child.slot);
    }
  }

  /** Un attribut en `i` ; renvoie la position qui le suit. */
  attribute(i: number, attributes: Attribute[]): number {
    const start = i;
    const c = this.src[i];
    if (c === '@' || c === '?' || c === '.') {
      const hint = c === '@' ? 'on:' : c === '?' ? '' : 'prop:';
      let j = i + 1;
      while (/[\w:-]/.test(this.src[j] ?? '')) j++;
      const bare = this.src.slice(i + 1, j);
      this.error(i, j, `Syntaxe de lit : écris \`${hint}${bare}={…}\``);
    }
    let j = c === '@' || c === '?' || c === '.' ? i + 1 : i;
    const nameStart = j;
    while (/[\w:-]/.test(this.src[j] ?? '')) j++;
    if (j === nameStart) throw new ParseFailure(i, `Caractère inattendu \`${c}\` dans une balise`);
    const name = this.src.slice(nameStart, j);
    const nameSpan = { start: nameStart, end: j };
    j = this.skipTrivia(j);
    if (this.src[j] !== '=') {
      attributes.push({ kind: 'attr', name, nameSpan, value: null, span: { start, end: nameSpan.end } });
      return j;
    }
    j = this.skipTrivia(j + 1);
    const v = this.src[j];
    if (v === '"' || v === "'") {
      const close = this.src.indexOf(v, j + 1);
      if (close === -1) throw new ParseFailure(j, 'Valeur d’attribut non terminée');
      attributes.push({
        kind: 'attr',
        name,
        nameSpan,
        value: { kind: 'string', span: { start: j, end: close + 1 } },
        span: { start, end: close + 1 },
      });
      return close + 1;
    }
    if (v === '{') {
      const close = this.scanTo(j + 1, '}');
      attributes.push({
        kind: 'attr',
        name,
        nameSpan,
        value: { kind: 'expr', span: { start: j + 1, end: close } },
        span: { start, end: close + 1 },
      });
      return close + 1;
    }
    throw new ParseFailure(j, `Valeur attendue pour \`${name}\` : "…" ou {…}`);
  }

  // Enfants ---------------------------------------------------------------------------------

  /**
   * Les enfants à partir de `i`, jusqu'à la fin du conteneur : `</name>` pour un élément (consommé),
   * `}` pour un bloc (non consommé), `case` / `default` / `}` pour un `case` (non consommés).
   */
  children(
    i: number,
    container: { kind: 'element'; name: string } | { kind: 'block' } | { kind: 'case' },
  ): { nodes: ChildNode[]; end: number; unclosed?: true } {
    const nodes: ChildNode[] = [];
    // Vrai au début d'un enfant de texte : c'est là qu'une instruction peut commencer.
    for (;;) {
      const c = this.src[i];
      if (c === undefined) {
        const what = container.kind === 'element' ? `Balise <${container.name}> non fermée` : 'Bloc non fermé : `}` manquant';
        throw new ParseFailure(i, what);
      }
      if (c === '<' && this.src[i + 1] === '/') {
        if (container.kind !== 'element') {
          // Un bloc pas encore fermé (en cours de frappe) : il s'arrête avant la balise fermante du parent.
          this.error(i, i + 2, '`}` manquant : le bloc se termine avant cette balise fermante');
          return { nodes, end: i, unclosed: true };
        }
        const nameStart = i + 2;
        let j = nameStart;
        while (/[\w$.:-]/.test(this.src[j] ?? '')) j++;
        const closing = this.src.slice(nameStart, j);
        j = this.skipTrivia(j);
        if (this.src[j] !== '>') throw new ParseFailure(j, '`>` attendu');
        if (closing !== container.name) this.error(i, j + 1, `</${closing}> ferme <${container.name}>`);
        return { nodes, end: j + 1 };
      }
      if (c === '}') {
        if (container.kind !== 'element') return { nodes, end: i };
        this.error(i, i + 1, "`}` dans le texte : écris {'}'}", { start: i, end: i + 1, text: "{'}'}", title: 'Entourer d’accolades' });
        i++;
        continue;
      }
      if (c === '<') {
        // `<a`, ou un emplacement nommé `<:footer`.
        if (isIdentStart(this.src[i + 1]) || (this.src[i + 1] === ':' && isIdentStart(this.src[i + 2]))) {
          const element = this.element(i);
          nodes.push(element);
          i = element.span.end;
        } else {
          this.error(i, i + 1, "`<` dans le texte : écris {'<'}", { start: i, end: i + 1, text: "{'<'}", title: 'Entourer d’accolades' });
          i++;
        }
        continue;
      }
      if (c === '{') {
        const close = this.scanTo(i + 1, '}');
        const inner = this.src.slice(i + 1, close).trim();
        if (inner.startsWith('/*') && inner.endsWith('*/')) nodes.push({ kind: 'comment', span: { start: i, end: close + 1 } });
        else if (inner === '') this.error(i, close + 1, 'Interpolation vide');
        else nodes.push({ kind: 'expr', expr: { start: i + 1, end: close }, span: { start: i, end: close + 1 } });
        i = close + 1;
        continue;
      }
      // Texte, ou instruction en début d'enfant (après les espaces).
      let j = i;
      while (isSpace(this.src[j])) j++;
      if (container.kind === 'case' && /^(case\b|default\s*:)/.test(this.src.slice(j, j + 12))) return { nodes, end: j };
      if (container.kind === 'case' && /^break\s*;/.test(this.src.slice(j, j + 12))) {
        i = this.src.indexOf(';', j) + 1;
        continue;
      }
      const statement = this.statement(j, nodes);
      if (statement !== null) {
        i = statement;
        continue;
      }
      // Texte jusqu'au prochain `<`, `{` ou `}`.
      let end = j;
      while (end < this.src.length && !'<{}'.includes(this.src[end] as string)) end++;
      if (end > i) nodes.push({ kind: 'text', span: { start: i, end } });
      if (end === i) i++;
      else i = end;
    }
  }

  /**
   * Tente de lire une instruction en `i`. Renvoie la position qui la suit, ou `null` si le texte
   * ne commence pas par une forme réservée. Une forme réservée mal formée est une erreur, avec
   * la correction « entourer d'accolades ».
   */
  statement(i: number, nodes: ChildNode[]): number | null {
    const head = this.src.slice(i, i + 40);
    const keyword = /^(if|for|switch)\s*\(/.exec(head)?.[1];
    const declaration = /^(const|let)\s+([A-Za-z_$][\w$]*\s*(:[^=;<>{}]*)?=(?![=>])|[{[])/.test(head);
    if (!keyword && !declaration) return null;

    // Une déstructuration ne compte que si elle est suivie de `=`.
    if (!keyword && /^(const|let)\s+[{[]/.test(head)) {
      try {
        const open = this.src.indexOf(head.match(/[{[]/)?.[0] as string, i);
        const close = this.scanTo(open + 1, this.src[open] === '{' ? '}' : ']');
        if (this.src[this.skipTrivia(close + 1)] !== '=') return null;
      } catch {
        return null;
      }
    }

    try {
      if (keyword === 'if') return this.ifStatement(i, nodes);
      if (keyword === 'for') return this.forStatement(i, nodes);
      if (keyword === 'switch') return this.switchStatement(i, nodes);
      // Le `;` est attendu, mais une déclaration en cours de frappe (`const user = this.`) reste une
      // déclaration : l'éditeur peut compléter, et l'erreur dit ce qui manque.
      this.endedAtNewline = false;
      let end: number;
      try {
        end = this.scanTo(i, ';', true);
      } catch (error) {
        if (!(error instanceof ParseFailure)) throw error;
        end = this.src.length;
        this.endedAtNewline = true;
      }
      // Une ligne qui commence par un élément, un bloc ou une instruction n'est plus la déclaration.
      const cut = this.declarationCut(i, end);
      if (cut !== null) {
        end = cut;
        this.endedAtNewline = true;
      }
      if (this.endedAtNewline) {
        let last = end;
        while (isSpace(this.src[last - 1])) last--;
        this.error(last - 1, last, '`;` manquant à la fin de la déclaration');
        nodes.push({ kind: 'declaration', span: { start: i, end: last } });
        return end;
      }
      nodes.push({ kind: 'declaration', span: { start: i, end: end + 1 } });
      return end + 1;
    } catch (error) {
      if (!(error instanceof ParseFailure) || error.committed) throw error;
      // Le texte jusqu'à la fin de la ligne (ou du prochain `<`, `{`, `}`) : c'est lui qu'on entoure.
      let end = i;
      while (end < this.src.length && !'<{}\n'.includes(this.src[end] as string)) end++;
      const text = this.src.slice(i, end).trimEnd();
      const what = keyword ? `\`${keyword}\`` : 'une déclaration';
      this.error(
        i,
        i + text.length,
        `Texte lu comme ${what}, qui n’est pas valide (${error.message}). Si c’est du texte, entoure-le d’accolades : {'${text.replaceAll("'", "\\'")}'}`,
        {
          start: i,
          end: i + text.length,
          text: `{'${text.replaceAll("'", "\\'")}'}`,
          title: 'Entourer d’accolades',
        },
      );
      if (keyword) {
        // L'expression après la parenthèse, sans `)` final.
        // Bornée au texte signalé (qui s'arrête avant `<`, `{`, `}` et la fin de la ligne).
        const open = this.src.indexOf('(', i) + 1;
        const line = this.src.slice(open, i + text.length).replace(/\)\s*$/, '');
        let expr = { start: open, end: open + line.length };
        // `for (const x of xs; key x.` : la clé est une expression à part, après le `;`.
        let key: Span | null = null;
        if (keyword === 'for') {
          let semicolon = -1;
          try {
            semicolon = this.scanTo(open, ';');
          } catch {}
          if (semicolon !== -1 && semicolon < expr.end) {
            const keyStart = this.skipTrivia(semicolon + 1);
            if (/^key\b/.test(this.src.slice(keyStart, expr.end)))
              key = { start: Math.min(this.skipTrivia(keyStart + 3), expr.end), end: expr.end };
            expr = { start: open, end: semicolon };
          }
        }
        nodes.push({ kind: 'partial', keyword: keyword as 'if' | 'for' | 'switch', expr, key, span: { start: i, end: i + text.length } });
      } else nodes.push({ kind: 'text', span: { start: i, end: i + text.length } });
      return i + Math.max(text.length, 1);
    }
  }

  /** Position du premier saut de ligne entre `start` et `end` suivi d'un élément ou d'une instruction. */
  declarationCut(start: number, end: number): number | null {
    for (let n = this.src.indexOf('\n', start); n !== -1 && n < end; n = this.src.indexOf('\n', n + 1)) {
      const next = this.src.slice(n + 1, n + 41).trimStart();
      if (/^([<{}]|(if|for|switch)\s*\(|(const|let)\s)/.test(next)) return n;
    }
    return null;
  }

  /** `{ … }` en `i` (après espaces) : renvoie le corps et la position après `}`. */
  block(i: number): { body: ChildNode[]; end: number } {
    const open = this.skipTrivia(i);
    if (this.src[open] !== '{') throw new ParseFailure(open, '`{` attendu');
    try {
      const { nodes, end, unclosed } = this.children(open + 1, { kind: 'block' });
      return { body: nodes, end: unclosed ? end : end + 1 };
    } catch (error) {
      if (error instanceof ParseFailure) error.committed = true;
      throw error;
    }
  }

  /** `(…)` dont le `(` est le premier après `i` : renvoie l'intérieur et la position après `)`. */
  parens(i: number): { inner: Span; end: number } {
    const open = this.src.indexOf('(', i);
    const close = this.scanTo(open + 1, ')');
    return { inner: { start: open + 1, end: close }, end: close + 1 };
  }

  ifStatement(start: number, nodes: ChildNode[]): number {
    const branches: IfBranch[] = [];
    let i = start;
    const first = this.parens(i);
    let test: Span | null = first.inner;
    i = first.end;
    for (;;) {
      const { body, end } = this.block(i);
      branches.push({ test, body, span: { start, end } });
      i = end;
      const next = this.skipTrivia(i);
      if (!/^else\b/.test(this.src.slice(next, next + 5))) break;
      const afterElse = this.skipTrivia(next + 4);
      const elseIf = /^if\s*\(/.test(this.src.slice(afterElse, afterElse + 10));
      try {
        if (elseIf) {
          const parens = this.parens(afterElse);
          // Le bloc est lu ici pour qu'un `else if (x)` sans `{` soit, lui aussi, en cours de frappe.
          if (this.src[this.skipTrivia(parens.end)] !== '{') throw new ParseFailure(this.skipTrivia(parens.end), '`{` attendu');
          test = parens.inner;
          i = parens.end;
        } else {
          test = null;
          const last = this.block(afterElse);
          branches.push({ test, body: last.body, span: { start: next, end: last.end } });
          i = last.end;
          break;
        }
      } catch (error) {
        if (!(error instanceof ParseFailure) || error.committed) throw error;
        // `} else if (this.` en cours de frappe : les branches lues restent, la suite de la ligne est
        // signalée et sa condition gardée pour la complétion.
        let end = afterElse;
        while (end < this.src.length && !'<{}\n'.includes(this.src[end] as string)) end++;
        while (isSpace(this.src[end - 1]) && end > afterElse) end--;
        this.error(next, Math.max(end, next + 4), `\`${elseIf ? 'else if' : 'else'}\` incomplet (${error.message})`);
        if (elseIf) {
          const open = this.src.indexOf('(', afterElse) + 1;
          const expr = this.src.slice(open, end).replace(/\)\s*$/, '');
          branches.push({ test: { start: open, end: open + expr.length }, body: [], span: { start: next, end }, partial: true });
        }
        i = Math.max(end, next + 4);
        break;
      }
    }
    nodes.push({ kind: 'if', branches, span: { start, end: i } });
    return i;
  }

  forStatement(start: number, nodes: ChildNode[]): number {
    const { inner, end: afterParens } = this.parens(start);
    // `const x of xs; key x.id` : le `;` de premier niveau sépare la clé.
    let headEnd = inner.end;
    let key: Span | null = null;
    try {
      const semicolon = this.scanTo(inner.start, ';');
      if (semicolon < inner.end) {
        headEnd = semicolon;
        const keyStart = this.skipTrivia(semicolon + 1);
        if (!/^key\b/.test(this.src.slice(keyStart, keyStart + 4))) {
          const failure = new ParseFailure(keyStart, '`key` attendu après `;`');
          failure.committed = true;
          throw failure;
        }
        key = { start: this.skipTrivia(keyStart + 3), end: inner.end };
      }
    } catch (error) {
      if (!(error instanceof ParseFailure) || error.committed) throw error;
      // Pas de `;` de premier niveau entre les parenthèses : pas de clé.
    }
    const head = { start: inner.start, end: headEnd };
    if (!/^\s*(const|let)\s+[\s\S]+\sof\s/.test(this.src.slice(head.start, head.end))) {
      throw new ParseFailure(head.start, 'seul `for (const x of xs)` est accepté');
    }
    const { body, end } = this.block(afterParens);
    nodes.push({ kind: 'for', head, key, body, span: { start, end } });
    return end;
  }

  switchStatement(start: number, nodes: ChildNode[]): number {
    const { inner, end: afterParens } = this.parens(start);
    let i = this.skipTrivia(afterParens);
    if (this.src[i] !== '{') throw new ParseFailure(i, '`{` attendu');
    i++;
    const cases: SwitchCase[] = [];
    for (;;) {
      i = this.skipTrivia(i);
      const c = this.src[i];
      if (c === '}') break;
      if (c === undefined) throw new ParseFailure(i, '`}` manquant');
      const caseStart = i;
      let test: Span | null;
      if (/^case\b/.test(this.src.slice(i, i + 5))) {
        const colon = this.scanTo(i + 4, ':');
        test = { start: this.skipTrivia(i + 4), end: colon };
        i = colon + 1;
      } else if (/^default\s*:/.test(this.src.slice(i, i + 12))) {
        test = null;
        i = this.src.indexOf(':', i) + 1;
      } else {
        throw new ParseFailure(i, '`case` ou `default` attendu');
      }
      const { nodes: body, end, unclosed } = this.children(i, { kind: 'case' });
      cases.push({ test, body, span: { start: caseStart, end } });
      i = end;
      if (unclosed) {
        nodes.push({ kind: 'switch', discriminant: inner, cases, span: { start, end: i } });
        return i;
      }
    }
    nodes.push({ kind: 'switch', discriminant: inner, cases, span: { start, end: i + 1 } });
    return i + 1;
  }
}
