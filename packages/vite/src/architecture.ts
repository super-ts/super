import { posix } from 'node:path';

/**
 * Architecture rules Super enforces in an app's `src`:
 * - a contract or a store (`SuperContract`, `SuperStore`) can only be defined under `@core/`;
 * - a component (`SuperElement`) can only be defined under `@components/`;
 * - a component imports only types from `@core/`: it talks to stores through their contract (`@contract cart;` in a `.super`);
 * - `@core/` does not depend on the DOM: it imports nothing from `@super-ts/dom` (except types).
 * The `@` prefix marks the folders that belong to Super. Everything else in `src`
 * (ports, adapters, routes, bootstrap…) is user-land and free.
 */
export const RULES = [
  { from: '@super-ts/core', names: ['SuperContract', 'SuperStore'], dir: '@core', what: 'Contracts and stores' },
  { from: '@super-ts/dom', names: ['SuperElement'], dir: '@components', what: 'Components' },
] as const;

const IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"](@super-ts\/[\w-]+)['"]/g;

/** Names imported (excluding `import type`) from a given module. */
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
 * Returns the error message if the module breaks a rule, `null` otherwise.
 * `relativePath` is relative to the app's `src`, with `/` separators.
 */
export function checkModule(relativePath: string, code: string): string | null {
  for (const rule of RULES) {
    const used = importedNames(code, rule.from).filter((name) => (rule.names as readonly string[]).includes(name));
    if (used.length === 0 || relativePath.startsWith(`${rule.dir}/`)) continue;
    return (
      `[super] src/${relativePath} imports ${used.join(', ')} from ${rule.from}. ` +
      `${rule.what} can only be defined under src/${rule.dir}/: this module is not loaded.`
    );
  }
  return null;
}

/** An import from `@super-ts/dom` that is neither `import type` nor a named import: default or `* as`. */
const DOM_OTHER_IMPORT = /import\s+(?!type\s)(?![^'";]*\{)([^'";]+?)\s+from\s*['"]@super-ts\/dom['"]/g;

/**
 * The app's core (contracts and stores) does not depend on the DOM: a module in `@core/` imports
 * nothing from `@super-ts/dom`, except types. Returns the error message, or `null`.
 */
export function checkCoreImports(relativePath: string, code: string): string | null {
  if (!relativePath.startsWith('@core/')) return null;
  const used = [...importedNames(code, '@super-ts/dom'), ...[...code.matchAll(DOM_OTHER_IMPORT)].map((m) => m[1]!.trim())];
  if (used.length === 0) return null;
  return (
    `[super] src/${relativePath} imports ${used.join(', ')} from @super-ts/dom. ` +
    'Contracts and stores do not depend on the DOM: this module is not loaded.'
  );
}

/** Imports into `src`: relative (`../@core/x`) or by alias (`@core/x`, `@components/x`). */
const SRC_IMPORT = /import\s+(type\s+)?([^'";]+?)\s+from\s*['"]((?:\.{1,2}|@core|@components)\/[^'"]+)['"]/g;

/** Super folders can also be imported by alias, from anywhere: `@core/cart/contract`. */
export const ALIASES = ['@core', '@components'] as const;

/**
 * A component only knows a store through its contract, requested by name (`@contract cart;`, or `this.contract('cart')` in a `.ts`):
 * from `@core/`, it imports only types. Returns the error message, or `null`.
 */
export function checkComponentImports(relativePath: string, code: string): string | null {
  if (!relativePath.startsWith('@components/')) return null;

  for (const [, typeOnly, clause, specifier] of code.matchAll(SRC_IMPORT)) {
    if (typeOnly) continue;
    const target = specifier!.startsWith('.') ? posix.normalize(posix.join(posix.dirname(relativePath), specifier!)) : specifier!; // an alias already points to a path from src
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
      `[super] src/${relativePath} imports ${used.join(', ')} from ${specifier}. ` +
      'A component imports only types from src/@core/: it talks to stores through their contract (@contract cart;). ' +
      'This module is not loaded.'
    );
  }
  return null;
}

/** Tests are not loaded by the app: they can define test doubles wherever they like. */
export const isChecked = (relativePath: string) => /\.(m?[jt]s)$/.test(relativePath) && !/\.test(-d)?\.m?[jt]s$/.test(relativePath);
