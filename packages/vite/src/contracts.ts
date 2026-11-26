import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/** Virtual module that registers the app's contracts in Super's registry. */
export const CONTRACTS_MODULE = 'virtual:super/contracts';
/** Generated types file: the name → contract class dictionary, for the compiler. */
export const CONTRACTS_DECLARATION = '@core/contracts.d.ts';

export type ContractEntry = {
  /** Path relative to `src`, with `/` separators: `@core/cart.contract.ts`. */
  file: string;
  className: string;
  name: string;
};

const CLASS = /export\s+class\s+(\w+)\s+extends\s+SuperContract\b/g;
const NAME = /super\(\s*\{\s*name:\s*['"]([^'"]+)['"]/;

/** The contracts declared in a module: `export class X extends SuperContract`, named by `super({ name })`. */
export function contractsIn(file: string, code: string): ContractEntry[] {
  const matches = [...code.matchAll(CLASS)];
  return matches.map((match, i) => {
    const body = code.slice(match.index, matches[i + 1]?.index ?? code.length);
    const name = NAME.exec(body)?.[1];
    if (!name) {
      throw new Error(`[super] src/${file}: ${match[1]} must name itself in its constructor, with super({ name: '…' })`);
    }
    return { file, className: match[1]!, name };
  });
}

/** A contract file: `cart/contract.ts` (one folder per contract), or `cart.contract.ts`. */
export const isContractFile = (path: string) => /(^|[\\/])contract\.ts$|\.contract\.ts$/.test(path);

/** All the contracts in `src/@core/`, sorted by name. A duplicate name is an error. */
export function scanContracts(root: string): ContractEntry[] {
  const dir = join(root, '@core');
  let files: string[];
  try {
    files = readdirSync(dir, { recursive: true, encoding: 'utf8' });
  } catch {
    return [];
  }
  const entries = files
    .filter(isContractFile)
    .flatMap((file) => {
      const path = relative(root, join(dir, file)).split(sep).join('/');
      return contractsIn(path, readFileSync(join(dir, file), 'utf8'));
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const seen = new Map<string, ContractEntry>();
  for (const entry of entries) {
    const other = seen.get(entry.name);
    if (other) {
      throw new Error(
        `[super] two contracts named "${entry.name}": ${other.className} (src/${other.file}) and ${entry.className} (src/${entry.file})`,
      );
    }
    seen.set(entry.name, entry);
  }
  return entries;
}

/** The app router: `export const Router = defineRouter(…)`, somewhere in `src`. */
export type RouterEntry = { file: string; exportName: string };

const ROUTER = /export\s+const\s+(\w+)\s*=\s*defineRouter\b/;

/** The router declared in `src` (excluding tests), if there is one. Two declarations are an error. */
export function scanRouter(root: string): RouterEntry | null {
  let files: string[];
  try {
    files = readdirSync(root, { recursive: true, encoding: 'utf8' });
  } catch {
    return null;
  }
  const found: RouterEntry[] = [];
  for (const file of files) {
    if (!/\.ts$/.test(file) || /\.(test|test-d|d)\.ts$/.test(file) || file.split(sep).includes('node_modules')) continue;
    const match = ROUTER.exec(readFileSync(join(root, file), 'utf8'));
    if (match) found.push({ file: file.split(sep).join('/'), exportName: match[1]! });
  }
  if (found.length > 1) {
    throw new Error(`[super] several routers declared with defineRouter: ${found.map((r) => `src/${r.file}`).join(', ')}`);
  }
  return found[0] ?? null;
}

/** The virtual module: each contract is registered under its name, loaded on demand. */
export function contractsModule(root: string, entries: ContractEntry[]): string {
  const lines = ["import { registerContract } from '@super-ts/core/internal';"];
  entries.forEach((entry, i) => lines.push(`import * as m${i} from ${JSON.stringify(join(root, entry.file))};`));
  entries.forEach((entry, i) => lines.push(`registerContract(${JSON.stringify(entry.name)}, () => m${i}.${entry.className});`));
  return `${lines.join('\n')}\n`;
}

/** The tag of each screen → the routes where it is displayed: `{ 'counter-screen': ['counter'] }`. */
export type ScreenRoutes = Record<string, string[]>;

const SCREENS = /\.screens\(\s*\(\)\s*=>\s*\(\{([\s\S]*?)\}\)\s*\)/;
const SCREEN_ENTRY = /(?:^|[,{\s])(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*([A-Za-z_$][\w$]*)\s*(?=,|$)/g;
const IMPORT = /import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

/** Finds the file of an import: `@components/…` and `@core/…` aliases, or relative path. */
function resolveImport(root: string, from: string, specifier: string): string | null {
  const base = /^@(components|core)\//.test(specifier)
    ? join(root, specifier)
    : specifier.startsWith('.')
      ? join(dirname(from), specifier)
      : null;
  if (!base) return null;
  const candidates = [`${base}.super`, `${base}.ts`, join(base, 'index.super'), join(base, 'index.ts'), base];
  return candidates.find((file) => existsSync(file) && !file.endsWith(sep)) ?? null;
}

/** A component class's tag in a module: `@tag = '…'` (`.super`) or `static tag = '…'` (`.ts`), after `class X extends SuperElement`. */
function tagOf(code: string, className: string): string | null {
  const start = new RegExp(`\\bclass\\s+${className}\\s+extends\\s+SuperElement\\b`).exec(code);
  if (!start) return null;
  const rest = code.slice(start.index + start[0].length);
  const next = /\bclass\s+\w+/.exec(rest);
  return /(?:@|\bstatic\s+)tag\s*=\s*(['"])([^'"]+)\1/.exec(next ? rest.slice(0, next.index) : rest)?.[2] ?? null;
}

/**
 * The screen → route link, read from `.screens(() => ({ counter: CounterScreen, … }))`: each screen
 * is found through its import, then through its tag (`@tag` or `static tag`). Redirects and the `'*'` and
 * `'!'` screens are not part of it. A screen that cannot be found is simply ignored (it will see every route).
 */
export function scanScreenRoutes(root: string, router: RouterEntry | null): ScreenRoutes {
  if (!router) return {};
  const file = join(root, router.file);
  const code = readFileSync(file, 'utf8');
  const screens = SCREENS.exec(code)?.[1];
  if (!screens) return {};
  const imports = new Map<string, { name: string; specifier: string }>();
  for (const [, names, specifier] of code.matchAll(IMPORT)) {
    for (const entry of names!.split(',')) {
      const [name, alias] = entry.trim().split(/\s+as\s+/);
      if (name) imports.set(alias ?? name, { name, specifier: specifier! });
    }
  }
  const routes: ScreenRoutes = {};
  for (const match of screens.matchAll(SCREEN_ENTRY)) {
    const route = match[1] ?? match[2] ?? match[3]!;
    const local = match[4]!;
    if (route === '*' || route === '!') continue;
    const imported = imports.get(local);
    const module = imported ? resolveImport(root, file, imported.specifier) : file;
    if (!module) continue;
    const tag = tagOf(readFileSync(module, 'utf8'), imported?.name ?? local);
    if (!tag) continue;
    (routes[tag] ??= []).push(route);
  }
  return routes;
}

/**
 * The types file, placed in `src/@core/`: paths relative to that folder. The app router, if there
 * is one, is registered in it under the name `'router'`, and each screen is linked to its route.
 */
export function contractsDeclaration(entries: ContractEntry[], router: RouterEntry | null = null, screens: ScreenRoutes = {}): string {
  if (router && entries.some((entry) => entry.name === 'router')) {
    throw new Error('[super] the contract name "router" is reserved for the app router');
  }
  const imports = entries.map(
    (entry) => `import type { ${entry.className} } from './${entry.file.replace(/^@core\//, '').replace(/\.ts$/, '')}';`,
  );
  // Same style as the repository formatter: bare key if it is an identifier, single quotes otherwise.
  const key = (name: string) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : `'${name}'`);
  const fields = entries.map((entry) => `    ${key(entry.name)}: ${entry.className};`);
  if (router) {
    imports.unshift("import type { AppRouterContractOf } from '@super-ts/dom';");
    // Formatter order: packages, then parent folders, then the current folder.
    imports.splice(1, 0, `import type { ${router.exportName} } from '../${router.file.replace(/\.ts$/, '')}';`);
    fields.push(`    router: AppRouterContractOf<typeof ${router.exportName}>;`);
  }
  const tags = Object.keys(screens).sort();
  const screenBlock = tags.length
    ? [
        '',
        "declare module '@super-ts/dom' {",
        '  interface ScreenRoutes {',
        ...tags.map((tag) => `    ${key(tag)}: ${screens[tag]!.map((route) => `'${route}'`).join(' | ')};`),
        '  }',
        '}',
      ]
    : [];
  return [
    '// Generated by the Super Vite plugin from the contracts in src/@core/ and the router: do not edit.',
    ...imports,
    '',
    "declare module '@super-ts/core' {",
    '  interface Contracts {',
    ...fields,
    '  }',
    '}',
    ...screenBlock,
    '',
    'export {};',
    '',
  ].join('\n');
}
/** A `@core/` module that implements a contract needs the registry (except the contracts themselves). */
export const needsRegistry = (relativePath: string, code: string) =>
  relativePath.startsWith('@core/') && !isContractFile(relativePath) && /\bSuperStore\b/.test(code);

/* ------------------------------------------------------------------------------------------ */
/* Hot replacement of components (dev)                                                         */
/* ------------------------------------------------------------------------------------------ */

const ELEMENT_CLASS = /\bclass\s+(\w+)\s+extends\s+SuperElement\b/g;
const PRIVATE_MEMBER = /\bthis\.#\w|^\s+(?:static\s+)?#\w/m;

/**
 * The code appended at the end of a component module, in dev: the module accepts its own replacement,
 * and the new version of the components it declares replaces the old one (see `hotReplace`).
 * `null` if the module declares no component. At the end of the module, so as not to shift the lines.
 */
export function hotModuleCode(code: string): string | null {
  const classes = [...code.matchAll(ELEMENT_CLASS)].map((match) => match[1]!);
  if (classes.length === 0) return null;
  const privateFields = PRIVATE_MEMBER.test(code);
  return [
    '',
    "import { hotReplace as __superHotReplace } from '@super-ts/dom/internal';",
    'if (import.meta.hot) {',
    '  import.meta.hot.accept();',
    `  __superHotReplace([${classes.join(', ')}], { privateFields: ${privateFields} });`,
    '}',
    '',
  ].join('\n');
}
