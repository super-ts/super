/**
 * Complétion dans les balises d'un `.super` : noms de balises (HTML et composants en portée),
 * balise fermante, attributs d'une balise HTML, props et événements d'un composant.
 *
 * Le contexte du curseur est lu dans la source (`templateContext`) ; les types viennent du
 * vérificateur de TypeScript, sur le TS virtuel du fichier (composants importés, leurs `[PROPS]` et
 * `[EVENTS]` fantômes, `HTMLElementTagNameMap`, `HTMLElementEventMap`).
 */

import { dirname, relative, resolve } from 'node:path';
import type { LanguageServicePlugin } from '@volar/language-service';
import ts from 'typescript';
import type { CompletionItem, CompletionItemKind } from 'vscode-languageserver-protocol';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { templateContext } from '../../lang/src/template-context.ts';
import { projectDirOf } from '../../lang/src/virtual-files.ts';
import { SOURCE_LANGUAGE } from './language-plugin.ts';

const KIND = { class: 7, property: 10, event: 23, keyword: 14, field: 5 } as const satisfies Record<string, CompletionItemKind>;
const SNIPPET = 2;

/** Propriétés du DOM qui ne sont pas des attributs qu'on écrit dans un template. */
const NOT_ATTRIBUTES = new Set(['innerHTML', 'outerHTML', 'innerText', 'outerText', 'textContent', 'nodeValue', 'scrollTop', 'scrollLeft']);
/** Interfaces du DOM dont les propriétés correspondent à des attributs HTML. */
const ATTRIBUTE_SOURCES = /^(HTML\w*|ARIAMixin|Element|HTMLOrSVGElement|GlobalEventHandlers)$/;
const RENAMED: Record<string, string> = { className: 'class', htmlFor: 'for', httpEquiv: 'http-equiv', acceptCharset: 'accept-charset' };

/** `ariaLabel` → `aria-label`, `className` → `class`, `tabIndex` → `tabindex`. */
function attributeName(property: string): string {
  if (RENAMED[property]) return RENAMED[property];
  if (/^aria[A-Z]/.test(property)) return `aria-${property.slice(4).toLowerCase()}`;
  return property.toLowerCase();
}

export type Checked = { checker: ts.TypeChecker; file: ts.SourceFile; program: ts.Program; path: string };

/** Le vérificateur et le TS virtuel du `.super` ouvert. */
export function checkedFile(languageService: ts.LanguageService | undefined, path: string): Checked | null {
  const program = languageService?.getProgram();
  const file = program?.getSourceFiles().find((f) => f.fileName === path || f.fileName.startsWith(`${path}.`));
  return program && file ? { checker: program.getTypeChecker(), file, program, path } : null;
}

/** `…/shop/index.super` → `…/shop` ; `…/greeting.ts` → `…/greeting` (le TS virtuel d'un `.super` compris). */
const modulePath = (fileName: string) => fileName.replace(/(\.super)?(\.d)?\.[mc]?[jt]sx?$|\.super$/, '').replace(/\/index$/, '');

/** Les alias exacts du tsconfig (`@super-ts/dom` → `…/packages/dom/src/index.ts`), par chemin de module. */
function aliases(program: ts.Program): Map<string, string> {
  const options = program.getCompilerOptions();
  const base = (options.pathsBasePath as string | undefined) ?? options.baseUrl ?? program.getCurrentDirectory();
  const found = new Map<string, string>();
  for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
    if (pattern.includes('*')) continue;
    for (const target of targets) if (!found.has(modulePath(resolve(base, target)))) found.set(modulePath(resolve(base, target)), pattern);
  }
  return found;
}

/**
 * Les composants exportés par les autres fichiers, qu'on peut importer, avec leur chemin d'import :
 * relatif (sans extension, le dossier pour un `index`) pour un fichier du projet, l'alias du
 * tsconfig pour un fichier hors du projet (`RouterOutlet` → `@super-ts/dom`). Ni le TS virtuel écrit
 * sur disque (`.super/virtual/`), ni les tests, ni les classes abstraites (`SuperElement`).
 */
function importableComponents(checked: Checked): Array<{ name: string; specifier: string }> {
  const { checker, program, path } = checked;
  const project = projectDirOf(path) ?? dirname(path);
  const aliased = aliases(program);
  const found: Array<{ name: string; specifier: string }> = [];
  for (const file of program.getSourceFiles()) {
    const name = file.fileName;
    if (
      file === checked.file ||
      file.isDeclarationFile ||
      name.includes('/node_modules/') ||
      name.includes('/.super/') ||
      /\.test(-d)?\.ts$/.test(name)
    )
      continue;
    let specifier: string | undefined;
    if (name.startsWith(`${project}/`)) {
      specifier = relative(dirname(path), modulePath(name)).split('\\').join('/');
      if (!specifier.startsWith('.')) specifier = `./${specifier}`;
    } else specifier = aliased.get(modulePath(name));
    const module = specifier && checker.getSymbolAtLocation(file);
    if (!specifier || !module) continue;
    for (const symbol of checker.getExportsOfModule(module)) {
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      if (isComponent(checked, target)) found.push({ name: symbol.name, specifier });
    }
  }
  return found;
}

/**
 * L'import de `name` : ajouté à un `import { … } from 'specifier'` existant (noms triés), sinon une
 * nouvelle ligne après les imports du début du fichier.
 */
function importEdit(source: string, name: string, specifier: string): { start: number; end: number; text: string } {
  const quoted = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existing = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${quoted}['"]`).exec(source);
  if (existing) {
    const start = existing.index + existing[0].indexOf('{') + 1;
    const names = [
      ...(existing[1] as string)
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean),
      name,
    ].sort((a, b) => a.replace(/^type /, '').localeCompare(b.replace(/^type /, '')));
    return { start, end: start + (existing[1] as string).length, text: ` ${names.join(', ')} ` };
  }
  const at = importInsertion(source);
  return { start: at, end: at, text: `import { ${name} } from '${specifier}';\n` };
}

/** Où ajouter un import : après le dernier `import … ;` du début du fichier (ou tout en haut). */
function importInsertion(source: string): number {
  let at = 0;
  for (const match of source.matchAll(/^import\s[^;]*;[^\n]*\n/gm)) {
    if (source.slice(at, match.index).trim() !== '') break;
    at = (match.index as number) + match[0].length;
  }
  return at;
}

/** Une interface globale (`HTMLElementTagNameMap`…) par son nom. */
function globalType({ checker, file }: Checked, name: string): ts.Type | null {
  const symbol = checker.getSymbolsInScope(file, ts.SymbolFlags.Interface).find((s) => s.name === name);
  return symbol ? checker.getDeclaredTypeOfSymbol(symbol) : null;
}

/** Une classe de composant : porte le fantôme `[PROPS]`, et n'est pas abstraite (`SuperElement`). */
function isComponent(checked: Checked, symbol: ts.Symbol): boolean {
  if (!(symbol.flags & ts.SymbolFlags.Class)) return false;
  const declaration = symbol.declarations?.[0];
  if (declaration && ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Abstract) return false;
  return phantom(checked, symbol, 'PROPS') !== null;
}

/** Les composants en portée : classes de composant importées ou déclarées dans le fichier. */
function components(checked: Checked): Map<string, ts.Symbol> {
  const { checker, file } = checked;
  const found = new Map<string, ts.Symbol>();
  for (const symbol of checker.getSymbolsInScope(file, ts.SymbolFlags.Class | ts.SymbolFlags.Alias)) {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    if (isComponent(checked, target)) found.set(symbol.name, target);
  }
  return found;
}

/** Le type d'un fantôme (`[PROPS]`, `[EVENTS]`) d'un composant, sans `undefined`. */
function phantom({ checker, file }: Checked, component: ts.Symbol, name: 'PROPS' | 'EVENTS'): ts.Type | null {
  const instance = checker.getDeclaredTypeOfSymbol(component);
  const property = checker.getPropertiesOfType(instance).find((p) => p.escapedName.toString().startsWith(`__@${name}@`));
  return property ? checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(property, file)) : null;
}

const isOptional = (symbol: ts.Symbol) => (symbol.flags & ts.SymbolFlags.Optional) !== 0;

export const templateCompletionService: LanguageServicePlugin = {
  name: 'super-template-completion',
  capabilities: { completionProvider: { triggerCharacters: ['<', '/', ' ', ':'] } },
  create(context) {
    return {
      provideCompletionItems(document: TextDocument, position) {
        if (document.languageId !== SOURCE_LANGUAGE) return;
        const source = document.getText();
        const where = templateContext(source, document.offsetAt(position));
        if (!where) return;
        const range = { start: document.positionAt(where.prefix.start), end: document.positionAt(where.prefix.end) };
        const sourceUri = context.decodeEmbeddedDocumentUri(URI.parse(document.uri))?.[0];
        const checked = sourceUri ? checkedFile(context.inject<any>('typescript/languageService'), sourceUri.fsPath) : null;
        const item = (label: string, kind: CompletionItemKind, extra: Partial<CompletionItem> = {}): CompletionItem => ({
          label,
          kind,
          textEdit: { range, newText: label },
          ...extra,
        });

        if (where.kind === 'tag' && where.closing) {
          return {
            isIncomplete: false,
            items: where.open
              ? [item(where.open, KIND.keyword, { textEdit: { range, newText: `${where.open}>` }, detail: 'ferme la balise' })]
              : [],
          };
        }

        // `<:` : les emplacements du composant ouvert, ses props de type `Children` (sauf `content`).
        if (where.kind === 'slot') {
          const component = checked && where.parent ? components(checked).get(where.parent) : undefined;
          const props = component && checked ? phantom(checked, component, 'PROPS') : null;
          const items: CompletionItem[] = [];
          for (const prop of props && checked ? checked.checker.getPropertiesOfType(props) : []) {
            if (prop.name === 'content' || !checked) continue;
            const type = checked.checker.typeToString(
              checked.checker.getNonNullableType(checked.checker.getTypeOfSymbolAtLocation(prop, checked.file)),
            );
            if (type !== 'Children') continue;
            items.push(
              item(`:${prop.name}`, KIND.field, {
                filterText: prop.name,
                detail: isOptional(prop) ? 'emplacement (facultatif)' : 'emplacement (obligatoire)',
                textEdit: { range, newText: `${prop.name}>$0</:${prop.name}>` },
                insertTextFormat: SNIPPET,
              }),
            );
          }
          return { isIncomplete: false, items };
        }

        if (where.kind === 'tag') {
          const items: CompletionItem[] = [];
          if (checked) {
            const inScope = components(checked);
            for (const name of inScope.keys()) items.push(item(name, KIND.class, { sortText: `0${name}`, detail: 'composant' }));
            // Les composants du projet pas encore importés : l'import s'ajoute avec la complétion.
            for (const { name, specifier } of importableComponents(checked)) {
              if (inScope.has(name) || items.some((i) => i.label === name)) continue;
              const { start, end, text } = importEdit(source, name, specifier);
              items.push(
                item(name, KIND.class, {
                  sortText: `0${name}`,
                  detail: `composant, import depuis '${specifier}'`,
                  additionalTextEdits: [{ range: { start: document.positionAt(start), end: document.positionAt(end) }, newText: text }],
                }),
              );
            }
            const tags = globalType(checked, 'HTMLElementTagNameMap');
            for (const tag of tags ? checked.checker.getPropertiesOfType(tags) : [])
              items.push(item(tag.name, KIND.property, { sortText: `1${tag.name}` }));
          }
          return { isIncomplete: false, items };
        }

        // Nom d'attribut.
        if (!checked) return;
        const present = new Set(where.present);
        const items: CompletionItem[] = [];
        const add = (name: string, kind: CompletionItemKind, sort: string, value: 'expr' | 'string' | 'none', detail?: string) => {
          if (present.has(name)) return;
          const newText = value === 'expr' ? `${name}={$1}` : value === 'string' ? `${name}="$1"` : name;
          items.push(
            item(name, kind, {
              sortText: `${sort}${name}`,
              textEdit: { range, newText },
              insertTextFormat: SNIPPET,
              ...(detail ? { detail } : {}),
            }),
          );
        };

        const component = components(checked).get(where.tag);
        if (component) {
          const props = phantom(checked, component, 'PROPS');
          for (const prop of props ? checked.checker.getPropertiesOfType(props) : []) {
            const type = checked.checker.typeToString(checked.checker.getTypeOfSymbolAtLocation(prop, checked.file));
            // Les enfants s'écrivent entre les balises, pas en attribut.
            if (prop.name === 'content') continue;
            add(
              prop.name,
              KIND.field,
              isOptional(prop) ? '1' : '0',
              'expr',
              isOptional(prop) ? `${type} (facultative)` : `${type} (obligatoire)`,
            );
          }
          const events = phantom(checked, component, 'EVENTS');
          for (const event of events ? checked.checker.getPropertiesOfType(events) : [])
            add(`on:${event.name}`, KIND.event, '2', 'expr', 'événement du composant');
          return { isIncomplete: false, items };
        }

        // Balise HTML : ses attributs, `ref`, et ses événements.
        const tags = globalType(checked, 'HTMLElementTagNameMap');
        const tag = tags && checked.checker.getPropertyOfType(tags, where.tag);
        const element = tag && checked.checker.getTypeOfSymbolAtLocation(tag, checked.file);
        for (const prop of element ? checked.checker.getPropertiesOfType(element) : []) {
          if (NOT_ATTRIBUTES.has(prop.name) || prop.name.startsWith('on')) continue;
          const parent = (prop.declarations?.[0]?.parent as ts.InterfaceDeclaration | undefined)?.name?.text ?? '';
          if (!ATTRIBUTE_SOURCES.test(parent)) continue;
          const type = checked.checker.getTypeOfSymbolAtLocation(prop, checked.file);
          if (!(type.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.Union))) continue;
          // `boolean`, ou une union qui le contient (`hidden` : `boolean | "until-found"`) : attribut sans valeur.
          const boolean = [type, ...(type.isUnion() ? type.types : [])].some((t) => (t.flags & ts.TypeFlags.BooleanLike) !== 0);
          add(attributeName(prop.name), KIND.property, '0', boolean ? 'none' : 'string');
        }
        add('ref', KIND.keyword, '1', 'expr', 'référence : this.ref<…>()');
        const events = globalType(checked, 'HTMLElementEventMap');
        for (const event of events ? checked.checker.getPropertiesOfType(events) : []) add(`on:${event.name}`, KIND.event, '2', 'expr');
        return { isIncomplete: false, items };
      },
    };
  },
};
