import { posix } from 'node:path';

/**
 * Règles d'architecture imposées par Super dans le `src` d'une app :
 * - un contrat ou un store (`SuperContract`, `SuperStore`) ne se définit que sous `@core/` ;
 * - un composant (`SuperElement`) ne se définit que sous `@components/` ;
 * - un composant n'importe de `@core/` que des types : il parle aux stores par leur contrat (`@contract cart;` dans un `.super`) ;
 * - `@core/` ne dépend pas du DOM : il n'importe rien de `@super-ts/dom` (hors types).
 * Le préfixe `@` marque les dossiers qui appartiennent à Super. Tout le reste du `src`
 * (ports, adapters, routes, bootstrap…) est user-land et libre.
 */
export const RULES = [
  { from: '@super-ts/core', names: ['SuperContract', 'SuperStore'], dir: '@core', what: 'Les contrats et les stores' },
  { from: '@super-ts/dom', names: ['SuperElement'], dir: '@components', what: 'Les composants' },
] as const;

const IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"](@super-ts\/[\w-]+)['"]/g;

/** Noms importés (hors `import type`) depuis un module donné. */
function importedNames(code: string, from: string): string[] {
  const names: string[] = [];
  for (const [, typeOnly, specifiers, source] of code.matchAll(IMPORT)) {
    if (typeOnly || source !== from) continue;
    for (const raw of specifiers!.split(',')) {
      const specifier = raw.trim();
      if (!specifier || specifier.startsWith('type ')) continue;
      names.push(specifier.split(/\s+as\s+/)[0]!.trim());
    }
  }
  return names;
}

/**
 * Retourne le message d'erreur si le module viole une règle, `null` sinon.
 * `relativePath` est relatif au `src` de l'app, avec des `/`.
 */
export function checkModule(relativePath: string, code: string): string | null {
  for (const rule of RULES) {
    const used = importedNames(code, rule.from).filter((name) => (rule.names as readonly string[]).includes(name));
    if (used.length === 0 || relativePath.startsWith(`${rule.dir}/`)) continue;
    return (
      `[super] src/${relativePath} importe ${used.join(', ')} depuis ${rule.from}. ` +
      `${rule.what} ne se définissent que sous src/${rule.dir}/ : ce module n'est pas chargé.`
    );
  }
  return null;
}

/** Un import de `@super-ts/dom` qui n'est ni `import type`, ni un import nommé : défaut ou `* as`. */
const DOM_OTHER_IMPORT = /import\s+(?!type\s)(?![^'";]*\{)([^'";]+?)\s+from\s*['"]@super-ts\/dom['"]/g;

/**
 * Le cœur de l'app (contrats et stores) ne dépend pas du DOM : un module de `@core/` n'importe
 * rien de `@super-ts/dom`, sauf des types. Retourne le message d'erreur, ou `null`.
 */
export function checkCoreImports(relativePath: string, code: string): string | null {
  if (!relativePath.startsWith('@core/')) return null;
  const used = [...importedNames(code, '@super-ts/dom'), ...[...code.matchAll(DOM_OTHER_IMPORT)].map((m) => m[1]!.trim())];
  if (used.length === 0) return null;
  return (
    `[super] src/${relativePath} importe ${used.join(', ')} depuis @super-ts/dom. ` +
    "Les contrats et les stores ne dépendent pas du DOM : ce module n'est pas chargé."
  );
}

/** Imports vers le `src` : relatifs (`../@core/x`) ou par alias (`@core/x`, `@components/x`). */
const SRC_IMPORT = /import\s+(type\s+)?([^'";]+?)\s+from\s*['"]((?:\.{1,2}|@core|@components)\/[^'"]+)['"]/g;

/** Les dossiers Super s'importent aussi par alias, depuis n'importe où : `@core/cart/contract`. */
export const ALIASES = ['@core', '@components'] as const;

/**
 * Un composant ne connaît un store que par son contrat, demandé par son nom (`@contract cart;`, ou `this.contract('cart')` dans un `.ts`) :
 * de `@core/`, il n'importe que des types. Retourne le message d'erreur, ou `null`.
 */
export function checkComponentImports(relativePath: string, code: string): string | null {
  if (!relativePath.startsWith('@components/')) return null;

  for (const [, typeOnly, clause, specifier] of code.matchAll(SRC_IMPORT)) {
    if (typeOnly) continue;
    const target = specifier!.startsWith('.') ? posix.normalize(posix.join(posix.dirname(relativePath), specifier!)) : specifier!; // un alias désigne déjà un chemin depuis src
    if (!target.startsWith('@core/')) continue;

    const named = /\{([^}]*)\}/.exec(clause!);
    const outside = clause!
      .replace(/\{[^}]*\}/, '')
      .replace(/,/g, ' ')
      .trim();
    const values = (named?.[1] ?? '')
      .split(',')
      .map((raw) => raw.trim())
      .filter((raw) => raw && !raw.startsWith('type '))
      .map((raw) => raw.split(/\s+as\s+/)[0]!.trim());
    const used = outside ? [outside, ...values] : values;
    if (used.length === 0) continue;
    return (
      `[super] src/${relativePath} importe ${used.join(', ')} depuis ${specifier}. ` +
      "Un composant n'importe de src/@core/ que des types : il parle aux stores par leur contrat (@contract cart;). " +
      "Ce module n'est pas chargé."
    );
  }
  return null;
}

/** Les tests ne sont pas chargés par l'app : ils peuvent définir des doublures où ils veulent. */
export const isChecked = (relativePath: string) => /\.(m?[jt]s)$/.test(relativePath) && !/\.test(-d)?\.m?[jt]s$/.test(relativePath);
