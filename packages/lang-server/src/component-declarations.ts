/**
 * A component's declarations in its class body (`@tag`, `@title`, `@prop`, `@emit`):
 * completion after `@` (`@t` offers `tag` and `title`) and documentation on hover.
 */
import type { LanguageServicePlugin } from '@volar/language-service';
import ts from 'typescript';
import type { CompletionItem } from 'vscode-languageserver-protocol';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { type ClassInfo, parse, type SuperMember } from '../../lang/src/parser.ts';
import { SOURCE_LANGUAGE } from './language-plugin.ts';
import { type Checked, checkedFile } from './template-completion.ts';

type Declaration = SuperMember['kind'];

/** What hover and completion show for each declaration (Markdown). */
export const DECLARATION_DOCS: Record<Declaration, { snippet: string; detail: string; doc: string }> = {
  tag: {
    snippet: "tag = '${1:my-component}';",
    detail: "@tag = 'my-component';",
    doc: [
      "The component's **tag**: the name of the custom element in the DOM.",
      '',
      'Required in a component (except an `abstract` class). A string written as is, in lower case, with a hyphen.',
      '',
      '```ts',
      "@tag = 'confirm-dialog';",
      '```',
    ].join('\n'),
  },
  title: {
    snippet: "title = '${1:Title}';",
    detail: '@title = string | (() => string);',
    doc: [
      'The **page title** (`document.title`) while the component is mounted.',
      '',
      '- a string is set as is;',
      '- a function is **tracked**: recomputed after each render, with the same reads as `render`.',
      '',
      'The last mounted component that sets a title wins; when it unmounts, the previous title comes back. The router adds the common suffix (`createRouter(Router, { title: { suffix } })`).',
      '',
      'Shorthand for `this.page.title = …`, set during preparation and reapplied on every mount.',
      '',
      '```ts',
      "@title = 'Shop';",
      '@title = () => `Counter ${this.label.value}`;',
      '```',
    ].join('\n'),
  },
  prop: {
    snippet: 'prop ${1:name}: ${2:string};',
    detail: '@prop name: Type;',
    doc: [
      'A **prop** received from the parent, read through `this.name`: always the current value, and a change re-renders the component.',
      '',
      '- `@prop name: T;`: required;',
      '- `@prop name?: T;`: optional (`T | undefined`);',
      '- `@prop name: T = value;`: optional, with a default value computed once per instance.',
      '',
      'The parent passes it as an attribute: `<Component name={…} />`. The name cannot be that of an HTML element property (`id`, `title`, `hidden`…). The content written between the tags fills the `content` prop (`@prop content: Children;`).',
      '',
      '```ts',
      '@prop question: string;',
      "@prop tone: 'neutral' | 'danger' = 'neutral';",
      '```',
    ].join('\n'),
  },
  emit: {
    snippet: 'emit ${1:name}: ${2:void};',
    detail: '@emit name: Payload;',
    doc: [
      'An **event** the component emits to its parent, with what it carries (`void` if it carries nothing).',
      '',
      "Emitted by `this.emit('name', payload)`, listened to by the parent with `on:name={…}`.",
      '',
      '```ts',
      '@emit answered: { confirmed: boolean };',
      "this.emit('answered', { confirmed: true });",
      '```',
    ].join('\n'),
  },
  contract: {
    snippet: 'contract ${1:name};',
    detail: "@contract cart;  |  @contract basket = 'cart';",
    doc: [
      'The **store** provided by the app for this contract, seen through its contract: `this.cart.selectors`, `this.cart.send(…)`, `this.cart.on(…)`.',
      '',
      '- `@contract cart;`: the contract named after the field;',
      "- `@contract basket = 'cart';`: a different field name.",
      '',
      'A contract is declared only once per component. The router is read through `this.router`, without `@contract`.',
      '',
      '```ts',
      '@contract cart;',
      "this.cart.send('add', { sku });",
      '```',
    ].join('\n'),
  },
  selector: {
    snippet: 'selector ${1:name} = ${2};',
    detail: '@selector name = selector | () => selector(…);',
    doc: [
      'A **value read from a store**, read through `this.name.value` in `render`. The component re-renders when it changes.',
      '',
      "A selector without parameters, or a function that returns a selector's value as is (recomputed on every render, so with the current props). A condition or a computation goes in `render`.",
      '',
      '```ts',
      '@selector lines = this.cart.selectors.lines;',
      '@selector count = () => this.counter.selectors.count(this.counterId);',
      '```',
    ].join('\n'),
  },
  state: {
    snippet: 'state ${1:local} = { $2 };',
    detail: '@state name = { … };',
    doc: [
      "The component's **local state**: private to the instance, for UI data (open panel, message, input in progress).",
      '',
      'Read through `this.name.get()`, changed through `this.name.set(patch)` (re-renders the component). The type comes from the value: widen it with `as` (`null as string | null`).',
      '',
      '```ts',
      "@state local = { dialog: null as 'confirm-clear' | null };",
      "this.local.set({ dialog: 'confirm-clear' });",
      '```',
    ].join('\n'),
  },
  ref: {
    snippet: 'ref ${1:name}: ${2:HTMLElement};',
    detail: '@ref name: ElementType;',
    doc: [
      'A **reference** to an element of the template, set by `ref={this.name}` and read through `this.name.value` (`undefined` before the render).',
      '',
      '```ts',
      '@ref input: HTMLInputElement;',
      '<input ref={this.input} />',
      '```',
    ].join('\n'),
  },
  form: {
    snippet: "form ${1:edit} = {\n\tinitial: { $2 },\n\tsubmit: { to: this.$3, command: '$4' },\n};",
    detail: '@form name = { initial, rules?, submit, … };',
    doc: [
      'A **form**: values, rules, asynchronous checks, and a submission that is a store command (`submit.to`, a `@contract`).',
      '',
      "The template binds to it through `<form {this.edit.bind()}>` and `{this.edit.field('name')}`.",
      '',
      '```ts',
      '@contract profile;',
      "@form edit = { initial: { name: '' }, submit: { to: this.profile, command: 'save' } };",
      '```',
    ].join('\n'),
  },
  on: {
    snippet: "on('${1:contract}', '${2:event}')\n${3:onEvent}(${4:payload}) {\n\t$0\n}",
    detail: "@on('contract', 'event') method(payload) { … }",
    doc: [
      'A **listener** for a store event (or a command lifecycle event: `save:done`, `save:failed`), active while the component is mounted.',
      '',
      "The contract does not need to be declared with `@contract`. The method's parameter is typed by the event. `@on('router', 'navigated')` listens to the router.",
      '',
      '```ts',
      "@on('profile', 'save:done')",
      'onSaved({ result }) {',
      '  this.local.set({ saved: result.id });',
      '}',
      '```',
    ].join('\n'),
  },
};

const ORDER: Declaration[] = ['tag', 'title', 'prop', 'emit', 'contract', 'selector', 'state', 'ref', 'form', 'on'];
const KIND_KEYWORD = 14;
const SNIPPET = 2;

/** The component whose body contains `offset`, outside its methods (where a declaration is written). */
function componentAt(source: string, offset: number): ClassInfo | null {
  const file = parse(source);
  const inMethod = file.methods.some((m) => m.start < offset && offset <= m.end);
  if (inMethod) return null;
  // Body still open (file being typed): it runs to the end.
  const end = (info: ClassInfo) => (info.body.end > info.body.start ? info.body.end : source.length);
  const candidates = file.classes.filter((c) => c.element && c.body.start < offset && offset <= end(c));
  return candidates.sort((a, b) => b.body.start - a.body.start)[0] ?? null;
}

/**
 * The names of the app's contracts, as accepted by `this.contract(…)` (the router is excluded),
 * read from `SuperElement` in scope in the virtual TypeScript.
 */
function contractNames({ checker, file }: Checked): string[] {
  const element = checker.getSymbolsInScope(file, ts.SymbolFlags.Alias | ts.SymbolFlags.Class).find((s) => s.name === 'SuperElement');
  if (!element) return [];
  const target = element.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(element) : element;
  const method = checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(target)).find((p) => p.name === 'contract');
  const signature = method && checker.getTypeOfSymbolAtLocation(method, file).getCallSignatures()[0];
  const constraint = signature?.typeParameters?.[0]?.getConstraint();
  if (!constraint) return [];
  const members = constraint.isUnion() ? constraint.types : [constraint];
  return members
    .filter((t): t is ts.StringLiteralType => t.isStringLiteral())
    .map((t) => t.value)
    .sort();
}

/** `error-log` → `errorLog`: a field name for a contract whose name is not an identifier. */
const fieldName = (contract: string) => contract.replace(/[^\w$]+(\w)/g, (_, c: string) => c.toUpperCase()).replace(/^[^A-Za-z_$]/, '_');

export const componentDeclarationsService: LanguageServicePlugin = {
  name: 'super-component-declarations',
  capabilities: { completionProvider: { triggerCharacters: ['@', ' '] }, hoverProvider: true },
  create(context) {
    return {
      provideCompletionItems(document: TextDocument, position) {
        if (document.languageId !== SOURCE_LANGUAGE) return;
        const source = document.getText();
        const offset = document.offsetAt(position);
        const line = source.slice(source.lastIndexOf('\n', offset - 1) + 1, offset);
        // `@contract |`: the app's contracts, except those the component already declares.
        const contract = /^\s*@contract\s+([A-Za-z_$][\w$]*)?$/.exec(line);
        if (contract) {
          const info = componentAt(source, offset);
          const sourceUri = context.decodeEmbeddedDocumentUri(URI.parse(document.uri))?.[0];
          const checked = sourceUri ? checkedFile(context.inject<any>('typescript/languageService'), sourceUri.fsPath) : null;
          if (!info || !checked) return;
          const declared = new Set(
            info.members.flatMap((m) =>
              m.kind !== 'contract'
                ? []
                : [m.value ? source.slice(m.value.start + 1, m.value.end - 1) : source.slice(m.name.start, m.name.end)],
            ),
          );
          const prefix = contract[1] ?? '';
          const range = { start: document.positionAt(offset - prefix.length), end: position };
          const items: CompletionItem[] = contractNames(checked)
            .filter((name) => !declared.has(name))
            .map((name) => {
              const field = fieldName(name);
              return {
                label: name,
                kind: 9, // module
                detail: 'contract',
                filterText: field,
                textEdit: { range, newText: field === name ? `${name};` : `${field} = '${name}';` },
              };
            });
          return { isIncomplete: false, items };
        }
        const typed = /^\s*@([A-Za-z]*)$/.exec(line);
        if (!typed) return;
        const info = componentAt(source, offset);
        if (!info) return;
        const prefix = typed[1] ?? '';
        const range = { start: document.positionAt(offset - prefix.length), end: position };
        // `@tag` and `@title` are declared only once.
        const declared = new Set(info.members.map((m) => m.kind));
        const items: CompletionItem[] = ORDER.filter((kind) => kind.startsWith(prefix))
          .filter((kind) => !((kind === 'tag' || kind === 'title') && declared.has(kind)))
          .map((kind, index) => ({
            label: kind,
            kind: KIND_KEYWORD,
            detail: DECLARATION_DOCS[kind].detail,
            documentation: { kind: 'markdown', value: DECLARATION_DOCS[kind].doc },
            sortText: `0${index}`,
            insertTextFormat: SNIPPET,
            textEdit: { range, newText: DECLARATION_DOCS[kind].snippet },
          }));
        return { isIncomplete: false, items };
      },

      provideHover(document: TextDocument, position) {
        if (document.languageId !== SOURCE_LANGUAGE) return;
        const source = document.getText();
        const offset = document.offsetAt(position);
        const info = componentAt(source, offset);
        const member = info?.members.find((m) => m.span.start <= offset && offset <= m.span.start + m.kind.length + 1);
        if (!member) return;
        return {
          contents: {
            kind: 'markdown',
            value: `\`\`\`ts\n${DECLARATION_DOCS[member.kind].detail}\n\`\`\`\n\n${DECLARATION_DOCS[member.kind].doc}`,
          },
          range: { start: document.positionAt(member.span.start), end: document.positionAt(member.span.start + member.kind.length + 1) },
        };
      },
    };
  },
};
