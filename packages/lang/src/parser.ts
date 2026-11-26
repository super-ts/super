/**
 * Parser for `.super` files: finds the elements written as statements in TS, and
 * parses their children (text, interpolations, `if` / `for` / `switch`, declarations).
 *
 * The TS itself is not parsed: a small lexer skips strings, template literals, comments and
 * regular expressions, and balances brackets. Expressions are kept as ranges of the source,
 * which the generator copies verbatim.
 */

export type Span = { start: number; end: number };

export type Diagnostic = Span & {
  message: string;
  /** Suggested fix: replace the range with `text`. */
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
  /** Starts with a capital letter: a SuperElement class. */
  component: boolean;
  /** `<:footer>…</:footer>`: a named slot, filled inside a component (its name without `:`). */
  slot?: string;
  attributes: Attribute[];
  /** `null` for an element closed by `/>` (or an HTML void element). */
  children: ChildNode[] | null;
  /** From `<` to the `>` of the opening tag. */
  openSpan: Span;
  span: Span;
};

/** `partial`: an `else if (` being typed, already reported; its condition only serves completion. */
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
   * An incomplete `if (`, `for (` or `switch (` (being typed, or ambiguous text): already reported
   * as an error, it keeps its expression so that the editor can complete inside it.
   */
  | { kind: 'partial'; keyword: 'if' | 'for' | 'switch'; expr: Span; key: Span | null; span: Span };

/**
 * A component declaration, in the body of its class:
 * - `@tag = 'confirm-dialog';` and `@title = 'Confirmation';` (or a function, tracked);
 * - `@prop question: string;`, `@prop size?: number;`, `@prop tone: Tone = 'neutral';`;
 * - `@emit answered: { confirmed: boolean };`;
 * - `@contract cart;` (or `@contract basket = 'cart';`), `@selector lines = this.cart.selectors.lines;`,
 *   `@state local = { … };`, `@form edit = { … };`, `@ref input: HTMLInputElement;`;
 * - `@on('profile', 'save:done') onSaved({ result }) { … }`: a listener, on a method.
 * `span` runs from the `@` to the `;` inclusive (or to the end of the line without `;`), or to the `}` of the method.
 */
export type SuperMember =
  | { kind: 'tag' | 'title'; span: Span; value: Span }
  | { kind: 'prop'; span: Span; name: Span; optional: boolean; type: Span; init: Span | null }
  | { kind: 'emit'; span: Span; name: Span; type: Span }
  /** `value`: the contract string (`'cart'`), `null` for `@contract cart;` (the field name). */
  | { kind: 'contract'; span: Span; name: Span; value: Span | null }
  | { kind: 'selector' | 'state' | 'form'; span: Span; name: Span; value: Span }
  | { kind: 'ref'; span: Span; name: Span; type: Span }
  /**
   * `contract`, `event`: the strings (quotes included); `head`: from the parameters to the return type
   * inclusive; `body`: from the `{` to the `}` of the method.
   */
  | { kind: 'on'; span: Span; contract: Span; event: Span; async: boolean; name: Span; head: Span; body: Span };

/** The declarations that replace a preparation method (`cart = this.contract('cart')`). */
export const PREPARATION_KINDS = ['contract', 'selector', 'state', 'ref', 'form'] as const;

/** A class of the file. */
export type ClassInfo = {
  /** The class name (`null` for an anonymous class). */
  name: Span | null;
  abstract: boolean;
  /**
   * `extends SuperElement`: `end`, the end of the word `SuperElement`; `generic`, the hand-written
   * `<…>`. `null`: the class is not a component.
   */
  element: { end: number; generic: Span | null } | null;
  /** From the `{` to the `}` of the body. */
  body: Span;
  members: SuperMember[];
  /** A hand-written `static tag` (a `.super` file requires `@tag`). */
  staticTag: Span | null;
};

/** The file: chunks of TS with elements interleaved between them. */
export type SuperFile = {
  source: string;
  parts: Array<{ kind: 'code'; span: Span } | ElementNode>;
  /** Bodies of class methods: from the `{` to the `}` (positions of the braces). */
  methods: Span[];
  classes: ClassInfo[];
  diagnostics: Diagnostic[];
};

const MEMBER_WORDS = new Set(['@tag', '@title', '@prop', '@emit', '@contract', '@selector', '@state', '@ref', '@form', '@on']);

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

// After these words, a `/` opens a regular expression (not a division).
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

/** After these words, `( … ) {` opens a block, not a function body. */
const CONTROL_WORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);

const isIdentStart = (c: string | undefined) => c !== undefined && /[A-Za-z_$]/.test(c);
const isIdentPart = (c: string | undefined) => c !== undefined && /[\w$]/.test(c);
const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);

/** Thrown to abandon an attempt (text mistaken for a statement, for example). */
class ParseFailure extends Error {
  /** Thrown in the body of an already recognised statement: it is no longer a text ambiguity. */
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
  /** Set by `scanTo(…, newlineEnds)` when the statement stops at the end of a line, without `;`. */
  endedAtNewline = false;

  constructor(src: string) {
    this.src = src;
  }

  // Minimal TS lexer ------------------------------------------------------------------------

  /** Skips a `'…'` or `"…"` string starting at `i`. A string does not span lines. */
  skipString(i: number): number {
    const quote = this.src[i];
    for (let j = i + 1; j < this.src.length; j++) {
      const c = this.src[j];
      if (c === '\\') j++;
      else if (c === quote) return j + 1;
      else if (c === '\n') throw new ParseFailure(i, 'Unterminated string');
    }
    throw new ParseFailure(i, 'Unterminated string');
  }

  /** Skips a template literal `` `…${…}…` `` starting at `i`. */
  skipTemplate(i: number): number {
    for (let j = i + 1; j < this.src.length; j++) {
      const c = this.src[j];
      if (c === '\\') j++;
      else if (c === '`') return j + 1;
      else if (c === '$' && this.src[j + 1] === '{') j = this.scanTo(j + 2, '}');
    }
    throw new ParseFailure(i, 'Unterminated template literal');
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
    throw new ParseFailure(i, 'Unterminated regular expression');
  }

  /** Skips whitespace and TS comments. */
  skipTrivia(i: number): number {
    while (i < this.src.length) {
      const c = this.src[i];
      if (isSpace(c)) i++;
      else if (c === '/' && this.src[i + 1] === '/') {
        const end = this.src.indexOf('\n', i);
        i = end === -1 ? this.src.length : end + 1;
      } else if (c === '/' && this.src[i + 1] === '*') {
        const end = this.src.indexOf('*/', i + 2);
        if (end === -1) throw new ParseFailure(i, 'Unterminated comment');
        i = end + 2;
      } else break;
    }
    return i;
  }

  /**
   * Walks a TS expression from `i` up to the first `closer` outside any parenthesis,
   * bracket or brace; returns its position. Throws if a bracket does not match.
   */
  scanTo(i: number, closer: string, newlineEnds = false): number {
    const stack: string[] = [];
    let previous = '('; // Start of an expression: a `/` there opens a regular expression.
    while (i < this.src.length) {
      const before = i;
      i = this.skipTrivia(i);
      // End of line outside any parenthesis, with no operator on either side: end of the statement.
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
        if (stack.pop() !== c) throw new ParseFailure(i, `Unexpected \`${c}\``);
        previous = c;
        i++;
      } else {
        previous = c;
        i++;
      }
    }
    throw new ParseFailure(i, `Missing \`${closer}\``);
  }

  // File: TS with elements in statement position --------------------------------------------

  file(): SuperFile {
    const parts: SuperFile['parts'] = [];
    let codeStart = 0;
    let i = 0;
    let previous = ';'; // Last significant token.
    let inCase = false; // A `case` or `default` is open: its `:` precedes a statement.
    // Open braces: class body, method body, or another block.
    // `function`: the body of a nested function (arrow, `function`, object method), where a
    // `return x;` does not concern the method that emits elements.
    const braces: Array<{ kind: 'class' | 'method' | 'function' | 'block'; start: number; info?: ClassInfo }> = [];
    const classes: ClassInfo[] = [];
    let classWord = 0; // Position of the last `class` word.
    const parens: string[] = []; // The word before each open `(` (`if`, `foo`…).
    let lastWord = '';
    let parenOwner = ''; // The word before the last closed `(`.
    let beforePrevious = ''; // The token before `previous` (to recognise `=>`).
    let methodHeader = false; // `name(…)` has just closed in a class body (a return type may follow).
    const valueReturns: Array<{ at: number; method: number }> = []; // `return x;` at the level of a method.
    const methods: Span[] = [];
    let sawClass = false; // The `class` word is waiting for its body.
    let classDepth = 0; // Brace depth where `class` was seen (a `;` in a type `<{ a; b }>` does not count).
    try {
      while (i < this.src.length) {
        i = this.skipTrivia(i);
        const c = this.src[i];
        if (c === undefined) break;
        // A `<` followed by a letter at the start of a line always opens an element: while typing
        // (`const user = this.` then `<section>` on the next line), the template stays readable.
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
          // A component declaration (`@prop name: Type;`) at the level of the class body.
          if (MEMBER_WORDS.has(word) && top?.kind === 'class' && (lineStart || previous === '{' || previous === '}' || previous === ';')) {
            i = this.member(start, word, top.info!);
            previous = ';';
            beforePrevious = ';';
            methodHeader = false;
            continue;
          }
          // The old form (`cart = this.contract('cart')`): rejected in a component, with its rewrite.
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
            // `class A extends B<{ … }> {`: only the `{` that follows a name, `>` or `)` opens the body.
            const parent = braces[braces.length - 1]?.kind;
            const nested = (previous === ')' && !CONTROL_WORDS.has(parenOwner)) || (previous === '>' && beforePrevious === '=');
            // Method body: `name(…) {`, or `name(…): Type {` (return type).
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
    // A method that emits elements returns what it emits: a `return x;` there would be ignored.
    for (const r of valueReturns) {
      const method = methods.find((m) => m.start === r.method);
      const emits = method && parts.some((p) => p.kind === 'element' && method.start < p.span.start && p.span.end <= method.end);
      if (emits)
        this.error(r.at, r.at + 6, 'A method that emits elements returns what it emits: here, `return` is written without a value');
    }
    this.checkClasses(classes);
    this.checkConstructors(classes, methods);
    return { source: this.src, parts, methods, classes, diagnostics: this.diagnostics };
  }

  // Classes and component declarations ------------------------------------------------------

  /** The class whose `class` word is at `start` and whose body opens at `open`. */
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

  /** Reads a declaration (`@tag`, `@prop`, `@contract`, `@on`…); returns the position after it. */
  member(start: number, word: string, info: ClassInfo): number {
    const kind = word.slice(1) as SuperMember['kind'];
    try {
      if (kind === 'on') return this.listener(start, info);
      let i = this.skipTrivia(start + word.length);
      if (kind === 'contract' || kind === 'selector' || kind === 'state' || kind === 'form' || kind === 'ref') {
        const name = this.memberName(i, kind);
        i = this.skipTrivia(name.end);
        if (kind === 'ref') {
          if (this.src[i] !== ':') throw new ParseFailure(i, 'A ref declares the type of its element: `@ref input: HTMLInputElement;`');
          const typeStart = this.skipTrivia(i + 1);
          const end = this.scanTo(typeStart, ';', true);
          if (this.assignment(typeStart, end) !== null)
            throw new ParseFailure(typeStart, 'A ref has no value: `@ref input: HTMLInputElement;`');
          const type = { start: typeStart, end: this.trimBack(end) };
          if (type.end <= type.start) throw new ParseFailure(typeStart, 'Missing type');
          const after = this.src[end] === ';' ? end + 1 : end;
          info.members.push({ kind, span: { start, end: after }, name, type });
          return after;
        }
        if (this.src[i] === ':') {
          throw new ParseFailure(i, `No type on \`@${kind}\`: it comes from the ${kind === 'contract' ? 'contract' : 'value'}`);
        }
        if (kind === 'contract' && this.src[i] !== '=') {
          // `@contract cart;`: the contract has the name of the field.
          let after = name.end;
          while (this.src[after] === ' ' || this.src[after] === '\t') after++;
          if (this.src[after] === ';') after++;
          else after = name.end;
          info.members.push({ kind, span: { start, end: after }, name, value: null });
          return after;
        }
        if (this.src[i] !== '=' || /[=>]/.test(this.src[i + 1] ?? ''))
          throw new ParseFailure(i, `\`@${kind}\` is written \`@${kind} name = …;\``);
        const valueStart = this.skipTrivia(i + 1);
        const end = this.scanTo(valueStart, ';', true);
        const value = { start: valueStart, end: this.trimBack(end) };
        if (value.end <= value.start)
          throw new ParseFailure(i, `Missing value after \`@${kind} ${this.src.slice(name.start, name.end)} =\``);
        const after = this.src[end] === ';' ? end + 1 : end;
        info.members.push({ kind, span: { start, end: after }, name, value });
        return after;
      }
      if (kind === 'tag' || kind === 'title') {
        if (this.src[i] !== '=' || /[=>]/.test(this.src[i + 1] ?? '')) {
          throw new ParseFailure(start, `\`@${kind}\` is written \`@${kind} = …;\``);
        }
        const valueStart = this.skipTrivia(i + 1);
        const end = this.scanTo(valueStart, ';', true);
        const value = { start: valueStart, end: this.trimBack(end) };
        if (value.end <= value.start) throw new ParseFailure(i, `Missing value after \`@${kind} =\``);
        const after = this.src[end] === ';' ? end + 1 : end;
        info.members.push({ kind, span: { start, end: after }, value });
        return after;
      }
      if (!isIdentStart(this.src[i])) throw new ParseFailure(i, `Name expected after \`@${kind}\`: \`@${kind} name: Type;\``);
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
            ? 'A prop declares its type: `@prop name: Type;`'
            : 'An event declares what it carries: `@emit name: Type;` (`void` if it carries nothing)',
        );
      }
      const typeStart = this.skipTrivia(i + 1);
      const end = this.scanTo(typeStart, ';', true);
      const assign = this.assignment(typeStart, end);
      const type = { start: typeStart, end: this.trimBack(assign ?? end) };
      if (type.end <= type.start) throw new ParseFailure(typeStart, 'Missing type');
      const after = this.src[end] === ';' ? end + 1 : end;
      const span = { start, end: after };
      if (kind === 'emit') {
        if (assign !== null) throw new ParseFailure(assign, 'An event has no default value');
        info.members.push({ kind, span, name, type });
        return after;
      }
      let init: Span | null = null;
      if (assign !== null) {
        if (optional) throw new ParseFailure(assign, 'A prop with a default value is already optional: remove the `?`');
        init = { start: this.skipTrivia(assign + 1), end: this.trimBack(end) };
        if (init.end <= init.start) throw new ParseFailure(assign, 'Missing default value after `=`');
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

  /** The name of a declaration (`cart`, or `#cart` for a private field). */
  memberName(i: number, kind: string): Span {
    const start = i;
    if (this.src[i] === '#') i++;
    if (!isIdentStart(this.src[i])) throw new ParseFailure(i, `Name expected after \`@${kind}\``);
    while (isIdentPart(this.src[i])) i++;
    return { start, end: i };
  }

  /** `@on('profile', 'save:done') onSaved({ result }) { … }`: the decoration and its method. */
  listener(start: number, info: ClassInfo): number {
    const usage = "`@on` is written `@on('contract', 'event')`, above a method";
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
    if (this.src[headStart] !== '(') throw new ParseFailure(headStart, `${usage}: \`onSaved(payload) { … }\``);
    const paramsEnd = this.scanTo(headStart + 1, ')');
    let open = this.skipTrivia(paramsEnd + 1);
    if (this.src[open] === ':') open = this.scanTo(open + 1, '{');
    if (this.src[open] !== '{') throw new ParseFailure(open, `${usage}: \`onSaved(payload) { … }\``);
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
   * A component field written the old way (`cart = this.contract('cart');`): an error, with its
   * rewrite as a declaration (`@contract cart;`).
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
      return; // what follows is already incomplete: the rest of the parse will report it
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
    const message = `In a \`.super\` file, \`this.${method}(…)\` is declared with \`@${method}\`: \`@${method} ${name}${method === 'ref' ? ': Type' : method === 'contract' ? '' : ' = …'};\``;
    this.error(start, end, message, text ? { start, end, text, title: `Write \`@${method}\`` } : undefined);
  }

  /** Steps back over the whitespace that precedes `end`. */
  trimBack(end: number): number {
    while (end > 0 && isSpace(this.src[end - 1])) end--;
    return end;
  }

  /** The `=` of a default value between `start` and `end` (outside parentheses, `=>`, `==`…), or `null`. */
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

  /** A listener set in the constructor of a component (`this.cart.on(…)`): it is declared with `@on`. */
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
          `In a \`.super\` file, a listener is declared on a method: \`@on('${call[1]!.replace('#', '')}', 'event') onEvent(payload) { … }\``,
        );
      }
    }
  }

  /** The rules for components in a `.super` file: a tag, declared with `@tag`, and no generic. */
  checkClasses(classes: ClassInfo[]) {
    for (const info of classes) {
      const at = (m: SuperMember) => [m.span.start, m.span.start + m.kind.length + 1] as const;
      if (!info.element) {
        for (const m of info.members) this.error(...at(m), `\`@${m.kind}\` is only written in a component (\`extends SuperElement\`)`);
        continue;
      }
      if (info.element.generic) {
        this.error(
          info.element.generic.start,
          info.element.generic.end,
          'In a `.super` file, props and events are declared in the class: `@prop name: Type;` and `@emit name: Type;`',
        );
      }
      const tags = info.members.filter((m): m is Extract<SuperMember, { kind: 'tag' | 'title' }> => m.kind === 'tag');
      if (info.staticTag) {
        this.error(info.staticTag.start, info.staticTag.end, "In a `.super` file, the tag is declared with `@tag = '…';`", {
          ...info.staticTag,
          text: '@tag',
          title: 'Write `@tag`',
        });
      } else if (tags.length === 0 && !info.abstract) {
        const where = info.name ?? { start: info.body.start, end: info.body.start + 1 };
        this.error(where.start, where.end, "A component declares its tag: `@tag = 'my-component';`");
      }
      for (const tag of tags) {
        if (!/^(['"])[a-z][\w.-]*-[\w.-]*\1$/.test(this.src.slice(tag.value.start, tag.value.end))) {
          this.error(tag.value.start, tag.value.end, "The tag is a literal string, in lower case, with a hyphen: `@tag = 'my-component';`");
        }
      }
      for (const kind of ['tag', 'title'] as const) {
        for (const extra of info.members.filter((m) => m.kind === kind).slice(1)) this.error(...at(extra), `\`@${kind}\` declared twice`);
      }
      // A contract is declared only once, and never the router (`this.router`).
      const contracts = new Map<string, string>();
      for (const m of info.members) {
        if (m.kind !== 'contract') continue;
        const field = this.src.slice(m.name.start, m.name.end);
        const literal = m.value ? /^(['"])([^'"]+)\1$/.exec(this.src.slice(m.value.start, m.value.end))?.[2] : field;
        const where = m.value ?? m.name;
        if (literal === undefined) {
          this.error(where.start, where.end, "The contract is a literal string: `@contract basket = 'cart';`");
          continue;
        }
        if (literal === 'router') {
          this.error(where.start, where.end, 'The router is read through `this.router`, without `@contract`');
          continue;
        }
        const first = contracts.get(literal);
        if (first !== undefined)
          this.error(where.start, where.end, `The contract \`${literal}\` is already declared by \`@contract ${first}\``);
        else contracts.set(literal, field);
      }
      for (const kind of ['prop', 'emit'] as const) {
        const seen = new Set<string>();
        for (const m of info.members) {
          if (m.kind !== kind) continue;
          const name = this.src.slice(m.name.start, m.name.end);
          if (seen.has(name)) this.error(m.name.start, m.name.end, `\`@${kind} ${name}\` declared twice`);
          seen.add(name);
        }
      }
    }
  }

  error(start: number, end: number, message: string, fix?: Diagnostic['fix']) {
    this.diagnostics.push(fix ? { start, end, message, fix } : { start, end, message });
  }

  // Elements --------------------------------------------------------------------------------

  /** An element that starts at `start` (on the `<`). */
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
      if (c === undefined) throw new ParseFailure(start, `Unclosed tag <${name}>`);
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
        if (component) this.error(i, close + 1, `A component does not take directives yet: {…} goes on an HTML element`);
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
   * A slot `<:name>` goes directly inside a component, without attributes, and only once
   * per name; `<:content>` does not exist (the direct children fill `content`).
   */
  checkSlots(name: string, component: boolean, slot: string | undefined, attributes: Attribute[], nameSpan: Span, children: ChildNode[]) {
    if (slot !== undefined) {
      if (!/^[A-Za-z_$][\w$]*$/.test(slot)) this.error(nameSpan.start, nameSpan.end, `Invalid slot name: <${name}>`);
      if (slot === 'content')
        this.error(
          nameSpan.start,
          nameSpan.end,
          'No <:content>: the children written directly inside the component already fill `content`',
        );
      const first = attributes[0];
      if (first) this.error(first.span.start, (attributes.at(-1) as Attribute).span.end, `A slot <${name}> takes no attributes`);
    }
    const seen = new Set<string>();
    for (const child of children) {
      if (child.kind !== 'element' || child.slot === undefined) continue;
      if (!component)
        this.error(
          child.nameSpan.start,
          child.nameSpan.end,
          `The slot <${child.name}> goes directly inside a component, not inside <${name}>`,
        );
      else if (seen.has(child.slot)) this.error(child.nameSpan.start, child.nameSpan.end, `The slot <${child.name}> is already filled`);
      seen.add(child.slot);
    }
  }

  /** An attribute at `i`; returns the position after it. */
  attribute(i: number, attributes: Attribute[]): number {
    const start = i;
    const c = this.src[i];
    if (c === '@' || c === '?' || c === '.') {
      const hint = c === '@' ? 'on:' : c === '?' ? '' : 'prop:';
      let j = i + 1;
      while (/[\w:-]/.test(this.src[j] ?? '')) j++;
      const bare = this.src.slice(i + 1, j);
      this.error(i, j, `lit syntax: write \`${hint}${bare}={…}\``);
    }
    let j = c === '@' || c === '?' || c === '.' ? i + 1 : i;
    const nameStart = j;
    while (/[\w:-]/.test(this.src[j] ?? '')) j++;
    if (j === nameStart) throw new ParseFailure(i, `Unexpected character \`${c}\` in a tag`);
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
      if (close === -1) throw new ParseFailure(j, 'Unterminated attribute value');
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
    throw new ParseFailure(j, `Value expected for \`${name}\`: "…" or {…}`);
  }

  // Children --------------------------------------------------------------------------------

  /**
   * The children from `i` to the end of the container: `</name>` for an element (consumed),
   * `}` for a block (not consumed), `case` / `default` / `}` for a `case` (not consumed).
   */
  children(
    i: number,
    container: { kind: 'element'; name: string } | { kind: 'block' } | { kind: 'case' },
  ): { nodes: ChildNode[]; end: number; unclosed?: true } {
    const nodes: ChildNode[] = [];
    // True at the start of a text child: that is where a statement can begin.
    for (;;) {
      const c = this.src[i];
      if (c === undefined) {
        const what = container.kind === 'element' ? `Unclosed tag <${container.name}>` : 'Unclosed block: missing `}`';
        throw new ParseFailure(i, what);
      }
      if (c === '<' && this.src[i + 1] === '/') {
        if (container.kind !== 'element') {
          // A block not closed yet (being typed): it stops before the closing tag of the parent.
          this.error(i, i + 2, 'Missing `}`: the block ends before this closing tag');
          return { nodes, end: i, unclosed: true };
        }
        const nameStart = i + 2;
        let j = nameStart;
        while (/[\w$.:-]/.test(this.src[j] ?? '')) j++;
        const closing = this.src.slice(nameStart, j);
        j = this.skipTrivia(j);
        if (this.src[j] !== '>') throw new ParseFailure(j, '`>` expected');
        if (closing !== container.name) this.error(i, j + 1, `</${closing}> closes <${container.name}>`);
        return { nodes, end: j + 1 };
      }
      if (c === '}') {
        if (container.kind !== 'element') return { nodes, end: i };
        this.error(i, i + 1, "`}` in text: write {'}'}", { start: i, end: i + 1, text: "{'}'}", title: 'Wrap in braces' });
        i++;
        continue;
      }
      if (c === '<') {
        // `<a`, or a named slot `<:footer`.
        if (isIdentStart(this.src[i + 1]) || (this.src[i + 1] === ':' && isIdentStart(this.src[i + 2]))) {
          const element = this.element(i);
          nodes.push(element);
          i = element.span.end;
        } else {
          this.error(i, i + 1, "`<` in text: write {'<'}", { start: i, end: i + 1, text: "{'<'}", title: 'Wrap in braces' });
          i++;
        }
        continue;
      }
      if (c === '{') {
        const close = this.scanTo(i + 1, '}');
        const inner = this.src.slice(i + 1, close).trim();
        if (inner.startsWith('/*') && inner.endsWith('*/')) nodes.push({ kind: 'comment', span: { start: i, end: close + 1 } });
        else if (inner === '') this.error(i, close + 1, 'Empty interpolation');
        else nodes.push({ kind: 'expr', expr: { start: i + 1, end: close }, span: { start: i, end: close + 1 } });
        i = close + 1;
        continue;
      }
      // Text, or a statement at the start of a child (after whitespace).
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
      // Text up to the next `<`, `{` or `}`.
      let end = j;
      while (end < this.src.length && !'<{}'.includes(this.src[end] as string)) end++;
      if (end > i) nodes.push({ kind: 'text', span: { start: i, end } });
      if (end === i) i++;
      else i = end;
    }
  }

  /**
   * Tries to read a statement at `i`. Returns the position after it, or `null` if the text
   * does not start with a reserved form. A malformed reserved form is an error, with
   * the "wrap in braces" fix.
   */
  statement(i: number, nodes: ChildNode[]): number | null {
    const head = this.src.slice(i, i + 40);
    const keyword = /^(if|for|switch)\s*\(/.exec(head)?.[1];
    const declaration = /^(const|let)\s+([A-Za-z_$][\w$]*\s*(:[^=;<>{}]*)?=(?![=>])|[{[])/.test(head);
    if (!keyword && !declaration) return null;

    // A destructuring only counts if it is followed by `=`.
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
      // The `;` is expected, but a declaration being typed (`const user = this.`) stays a
      // declaration: the editor can complete, and the error says what is missing.
      this.endedAtNewline = false;
      let end: number;
      try {
        end = this.scanTo(i, ';', true);
      } catch (error) {
        if (!(error instanceof ParseFailure)) throw error;
        end = this.src.length;
        this.endedAtNewline = true;
      }
      // A line that starts with an element, a block or a statement is no longer the declaration.
      const cut = this.declarationCut(i, end);
      if (cut !== null) {
        end = cut;
        this.endedAtNewline = true;
      }
      if (this.endedAtNewline) {
        let last = end;
        while (isSpace(this.src[last - 1])) last--;
        this.error(last - 1, last, 'Missing `;` at the end of the declaration');
        nodes.push({ kind: 'declaration', span: { start: i, end: last } });
        return end;
      }
      nodes.push({ kind: 'declaration', span: { start: i, end: end + 1 } });
      return end + 1;
    } catch (error) {
      if (!(error instanceof ParseFailure) || error.committed) throw error;
      // The text up to the end of the line (or the next `<`, `{`, `}`): that is what gets wrapped.
      let end = i;
      while (end < this.src.length && !'<{}\n'.includes(this.src[end] as string)) end++;
      const text = this.src.slice(i, end).trimEnd();
      const what = keyword ? `\`${keyword}\`` : 'a declaration';
      this.error(
        i,
        i + text.length,
        `Text read as ${what}, which is not valid (${error.message}). If it is text, wrap it in braces: {'${text.replaceAll("'", "\\'")}'}`,
        {
          start: i,
          end: i + text.length,
          text: `{'${text.replaceAll("'", "\\'")}'}`,
          title: 'Wrap in braces',
        },
      );
      if (keyword) {
        // The expression after the parenthesis, without the final `)`.
        // Bounded by the reported text (which stops before `<`, `{`, `}` and the end of the line).
        const open = this.src.indexOf('(', i) + 1;
        const line = this.src.slice(open, i + text.length).replace(/\)\s*$/, '');
        let expr = { start: open, end: open + line.length };
        // `for (const x of xs; key x.`: the key is a separate expression, after the `;`.
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

  /** Position of the first line break between `start` and `end` followed by an element or a statement. */
  declarationCut(start: number, end: number): number | null {
    for (let n = this.src.indexOf('\n', start); n !== -1 && n < end; n = this.src.indexOf('\n', n + 1)) {
      const next = this.src.slice(n + 1, n + 41).trimStart();
      if (/^([<{}]|(if|for|switch)\s*\(|(const|let)\s)/.test(next)) return n;
    }
    return null;
  }

  /** `{ … }` at `i` (after whitespace): returns the body and the position after `}`. */
  block(i: number): { body: ChildNode[]; end: number } {
    const open = this.skipTrivia(i);
    if (this.src[open] !== '{') throw new ParseFailure(open, '`{` expected');
    try {
      const { nodes, end, unclosed } = this.children(open + 1, { kind: 'block' });
      return { body: nodes, end: unclosed ? end : end + 1 };
    } catch (error) {
      if (error instanceof ParseFailure) error.committed = true;
      throw error;
    }
  }

  /** `(…)` whose `(` is the first after `i`: returns the inside and the position after `)`. */
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
          // The block is read here so that an `else if (x)` without `{` also counts as being typed.
          if (this.src[this.skipTrivia(parens.end)] !== '{') throw new ParseFailure(this.skipTrivia(parens.end), '`{` expected');
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
        // `} else if (this.` being typed: the branches read so far stay, the rest of the line is
        // reported and its condition kept for completion.
        let end = afterElse;
        while (end < this.src.length && !'<{}\n'.includes(this.src[end] as string)) end++;
        while (isSpace(this.src[end - 1]) && end > afterElse) end--;
        this.error(next, Math.max(end, next + 4), `Incomplete \`${elseIf ? 'else if' : 'else'}\` (${error.message})`);
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
    // `const x of xs; key x.id`: the top-level `;` separates the key.
    let headEnd = inner.end;
    let key: Span | null = null;
    try {
      const semicolon = this.scanTo(inner.start, ';');
      if (semicolon < inner.end) {
        headEnd = semicolon;
        const keyStart = this.skipTrivia(semicolon + 1);
        if (!/^key\b/.test(this.src.slice(keyStart, keyStart + 4))) {
          const failure = new ParseFailure(keyStart, '`key` expected after `;`');
          failure.committed = true;
          throw failure;
        }
        key = { start: this.skipTrivia(keyStart + 3), end: inner.end };
      }
    } catch (error) {
      if (!(error instanceof ParseFailure) || error.committed) throw error;
      // No top-level `;` between the parentheses: no key.
    }
    const head = { start: inner.start, end: headEnd };
    if (!/^\s*(const|let)\s+[\s\S]+\sof\s/.test(this.src.slice(head.start, head.end))) {
      throw new ParseFailure(head.start, 'only `for (const x of xs)` is accepted');
    }
    const { body, end } = this.block(afterParens);
    nodes.push({ kind: 'for', head, key, body, span: { start, end } });
    return end;
  }

  switchStatement(start: number, nodes: ChildNode[]): number {
    const { inner, end: afterParens } = this.parens(start);
    let i = this.skipTrivia(afterParens);
    if (this.src[i] !== '{') throw new ParseFailure(i, '`{` expected');
    i++;
    const cases: SwitchCase[] = [];
    for (;;) {
      i = this.skipTrivia(i);
      const c = this.src[i];
      if (c === '}') break;
      if (c === undefined) throw new ParseFailure(i, 'Missing `}`');
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
        throw new ParseFailure(i, '`case` or `default` expected');
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
