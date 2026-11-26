/**
 * Les déclarations d'un composant dans le corps de sa classe (`@tag`, `@title`, `@prop`, `@emit`) :
 * complétion après `@` (`@t` propose `tag` et `title`) et documentation au survol.
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

/** Ce que le survol et la complétion montrent de chaque déclaration (Markdown). */
export const DECLARATION_DOCS: Record<Declaration, { snippet: string; detail: string; doc: string }> = {
  tag: {
    snippet: "tag = '${1:mon-composant}';",
    detail: "@tag = 'mon-composant';",
    doc: [
      'Le **tag** du composant : le nom de l’élément personnalisé dans le DOM.',
      '',
      'Obligatoire dans un composant (sauf une classe `abstract`). Une chaîne écrite telle quelle, en minuscules, avec un tiret.',
      '',
      '```ts',
      "@tag = 'confirm-dialog';",
      '```',
    ].join('\n'),
  },
  title: {
    snippet: "title = '${1:Titre}';",
    detail: '@title = string | (() => string);',
    doc: [
      'Le **titre de la page** (`document.title`) tant que le composant est monté.',
      '',
      '- une chaîne est posée telle quelle ;',
      '- une fonction est **suivie** : recalculée après chaque rendu, avec les mêmes lectures que `render`.',
      '',
      'Le dernier composant monté qui pose un titre l’emporte ; à son démontage, le titre précédent revient. Le router ajoute le suffixe commun (`createRouter(Router, { title: { suffix } })`).',
      '',
      'Raccourci pour `this.page.title = …`, posé à la préparation et repris à chaque montage.',
      '',
      '```ts',
      "@title = 'Boutique';",
      '@title = () => `Compteur ${this.label.value}`;',
      '```',
    ].join('\n'),
  },
  prop: {
    snippet: 'prop ${1:nom}: ${2:string};',
    detail: '@prop nom: Type;',
    doc: [
      'Une **prop** reçue du parent, lue par `this.nom` : toujours la valeur courante, et un changement re-rend le composant.',
      '',
      '- `@prop nom: T;` : obligatoire ;',
      '- `@prop nom?: T;` : facultative (`T | undefined`) ;',
      '- `@prop nom: T = valeur;` : facultative, avec une valeur par défaut calculée une fois par instance.',
      '',
      'Le parent la passe en attribut : `<Composant nom={…} />`. Le nom ne peut pas être celui d’une propriété des éléments HTML (`id`, `title`, `hidden`…). Le contenu écrit entre les balises remplit la prop `content` (`@prop content: Children;`).',
      '',
      '```ts',
      '@prop question: string;',
      "@prop tone: 'neutral' | 'danger' = 'neutral';",
      '```',
    ].join('\n'),
  },
  emit: {
    snippet: 'emit ${1:nom}: ${2:void};',
    detail: '@emit nom: Payload;',
    doc: [
      'Un **événement** que le composant émet vers son parent, avec ce qu’il transporte (`void` s’il ne transporte rien).',
      '',
      "Émis par `this.emit('nom', payload)`, écouté par le parent avec `on:nom={…}`.",
      '',
      '```ts',
      '@emit answered: { confirmed: boolean };',
      "this.emit('answered', { confirmed: true });",
      '```',
    ].join('\n'),
  },
  contract: {
    snippet: 'contract ${1:nom};',
    detail: "@contract cart;  |  @contract basket = 'cart';",
    doc: [
      'Le **store** fourni par l’app pour ce contrat, vu à travers son contrat : `this.cart.selectors`, `this.cart.send(…)`, `this.cart.on(…)`.',
      '',
      '- `@contract cart;` : le contrat qui porte le nom du champ ;',
      "- `@contract basket = 'cart';` : un autre nom de champ.",
      '',
      'Un contrat ne se déclare qu’une fois par composant. Le router se lit par `this.router`, sans `@contract`.',
      '',
      '```ts',
      '@contract cart;',
      "this.cart.send('add', { sku });",
      '```',
    ].join('\n'),
  },
  selector: {
    snippet: 'selector ${1:nom} = ${2};',
    detail: '@selector nom = sélecteur | () => sélecteur(…);',
    doc: [
      'Une **valeur lue d’un store**, lue par `this.nom.value` dans `render`. Le composant se re-rend quand elle change.',
      '',
      'Un sélecteur sans paramètre, ou une fonction qui renvoie la valeur d’un sélecteur telle quelle (recalculée à chaque rendu, donc avec les props courantes). Une condition ou un calcul se font dans `render`.',
      '',
      '```ts',
      '@selector lines = this.cart.selectors.lines;',
      '@selector count = () => this.counter.selectors.count(this.counterId);',
      '```',
    ].join('\n'),
  },
  state: {
    snippet: 'state ${1:local} = { $2 };',
    detail: '@state nom = { … };',
    doc: [
      'L’**état local** du composant : privé à l’instance, pour les données d’interface (panneau ouvert, message, saisie en cours).',
      '',
      'Lu par `this.nom.get()`, changé par `this.nom.set(patch)` (re-rend le composant). Le type vient de la valeur : élargis avec `as` (`null as string | null`).',
      '',
      '```ts',
      "@state local = { dialog: null as 'confirm-clear' | null };",
      "this.local.set({ dialog: 'confirm-clear' });",
      '```',
    ].join('\n'),
  },
  ref: {
    snippet: 'ref ${1:nom}: ${2:HTMLElement};',
    detail: '@ref nom: TypeDElement;',
    doc: [
      'Une **référence** vers un élément du template, posée par `ref={this.nom}` et lue par `this.nom.value` (`undefined` avant le rendu).',
      '',
      '```ts',
      '@ref input: HTMLInputElement;',
      '<input ref={this.input} />',
      '```',
    ].join('\n'),
  },
  form: {
    snippet: "form ${1:edit} = {\n\tinitial: { $2 },\n\tsubmit: { to: this.$3, command: '$4' },\n};",
    detail: '@form nom = { initial, rules?, submit, … };',
    doc: [
      'Un **formulaire** : valeurs, règles, vérifications asynchrones, et une soumission qui est une commande d’un store (`submit.to`, un `@contract`).',
      '',
      "Le template s’y relie par `<form {this.edit.bind()}>` et `{this.edit.field('nom')}`.",
      '',
      '```ts',
      '@contract profile;',
      "@form edit = { initial: { name: '' }, submit: { to: this.profile, command: 'save' } };",
      '```',
    ].join('\n'),
  },
  on: {
    snippet: "on('${1:contrat}', '${2:événement}')\n${3:onEvent}(${4:payload}) {\n\t$0\n}",
    detail: "@on('contrat', 'événement') méthode(payload) { … }",
    doc: [
      'Un **écouteur** d’un événement du store (ou du cycle de vie d’une commande : `save:done`, `save:failed`), actif tant que le composant est monté.',
      '',
      "Le contrat n’a pas besoin d’être déclaré par `@contract`. Le paramètre de la méthode est typé par l’événement. `@on('router', 'navigated')` écoute le router.",
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

/** Le composant dont `offset` est dans le corps, hors de ses méthodes (là où s'écrit une déclaration). */
function componentAt(source: string, offset: number): ClassInfo | null {
  const file = parse(source);
  const inMethod = file.methods.some((m) => m.start < offset && offset <= m.end);
  if (inMethod) return null;
  // Corps encore ouvert (fichier en cours de frappe) : il va jusqu'à la fin.
  const end = (info: ClassInfo) => (info.body.end > info.body.start ? info.body.end : source.length);
  const candidates = file.classes.filter((c) => c.element && c.body.start < offset && offset <= end(c));
  return candidates.sort((a, b) => b.body.start - a.body.start)[0] ?? null;
}

/**
 * Les noms des contrats de l'app, tels que les accepte `this.contract(…)` (le router en est exclu),
 * lus sur `SuperElement` en portée dans le TS virtuel.
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

/** `error-log` → `errorLog` : un nom de champ pour un contrat dont le nom n'est pas un identifiant. */
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
        // `@contract |` : les contrats de l'app, sauf ceux que le composant déclare déjà.
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
                detail: 'contrat',
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
        // `@tag` et `@title` ne se déclarent qu'une fois.
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
